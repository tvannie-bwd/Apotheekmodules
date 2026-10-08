import { getStore } from "@netlify/blobs";
import { parseVoorraadCsv } from "./_parse-voorraad.js";
import { parseGrondstoffenCsv } from "./_parse-grondstoffen.js";
import { reclassifyRecords } from "./_reclassify.js";

// Hergebruikt hetzelfde login-systeem als de andere modules (zelfde
// apotheek-accounts, zelfde TOKEN_SECRET). Eigen store per apotheek.
const OVERZICHT_KEY = "overzicht";
const CUTOFF_DATE = "2026-10-31";
const PLACEHOLDER_LOCATIE = "(nog toe te wijzen)";

async function hmacHex(bericht, geheim) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(geheim),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bericht));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function keyOf(r) {
  return `${r.cnk}::${r.voorraadplaats}`;
}
function normalize(s) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}
function isExcludedLocation(voorraadplaats) {
  const v = normalize(voorraadplaats);
  if (v.startsWith("VRAC DOOS")) return true;
  if (v === "VRAC FRIGO VERVALLEN") return true;
  return false;
}
function sortRecords(records) {
  return records.slice().sort((a, b) => {
    const locCmp = a.voorraadplaats.toUpperCase().localeCompare(b.voorraadplaats.toUpperCase());
    if (locCmp !== 0) return locCmp;
    return a.omschrijving.toUpperCase().localeCompare(b.omschrijving.toUpperCase());
  });
}
async function getOverzicht(store) {
  const data = await store.get(OVERZICHT_KEY, { type: "json" });
  return data || [];
}
async function saveOverzicht(store, records) {
  await store.setJSON(OVERZICHT_KEY, records);
}

export default async (req) => {
  const tokenSecret = process.env.TOKEN_SECRET;
  const meegestuurdToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

  let apotheekId;
  if (!tokenSecret) {
    apotheekId = "dev";
  } else {
    const [id, signature] = meegestuurdToken.split(".");
    if (!id || !signature) return json({ error: "Niet ingelogd of sessie verlopen." }, 401);
    const verwachteSignature = await hmacHex(id, tokenSecret);
    if (signature !== verwachteSignature) {
      return json({ error: "Niet ingelogd of sessie verlopen." }, 401);
    }
    apotheekId = id;
  }

  const store = getStore(`voorraadplaatsen-${apotheekId}`);
  const url = new URL(req.url);

  // ---------------- GET: volledig overzicht ophalen ----------------
  if (req.method === "GET") {
    const overzicht = await getOverzicht(store);
    return json({ overzicht });
  }

  // ---------------- POST: toevoegen of CSV uploaden ----------------
  if (req.method === "POST") {
    let payload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Ongeldige aanvraag." }, 400);
    }
    const actie = payload.actie || "toevoegen";

    // -- Eén product manueel toevoegen/bijwerken --
    if (actie === "toevoegen") {
      const cnk = (payload.cnk || "").trim();
      const omschrijving = (payload.omschrijving || "").trim();
      const voorraadplaats = (payload.voorraadplaats || "").trim();
      const stock = (payload.stock || "").toString().trim();
      if (!cnk || !voorraadplaats) {
        return json({ error: "CNK en voorraadplaats zijn verplicht." }, 400);
      }
      const { records: reclassified } = reclassifyRecords([{ cnk, omschrijving, voorraadplaats, stock }]);
      const record = reclassified[0];

      const existing = await getOverzicht(store);
      const byKey = new Map(existing.map((r) => [keyOf(r), r]));
      byKey.set(keyOf(record), record);
      const merged = sortRecords(Array.from(byKey.values()));
      await saveOverzicht(store, merged);
      return json({ ok: true, overzicht: merged });
    }

    // -- CSV-bestand "prijslijst per voorraadplaats" uploaden --
    if (actie === "upload-voorraad") {
      const { fileBase64 } = payload;
      if (!fileBase64) return json({ error: "Geen bestand ontvangen." }, 400);
      const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
      const text = new TextDecoder("iso-8859-1").decode(bytes);
      let parsed;
      try {
        parsed = parseVoorraadCsv(text);
      } catch (e) {
        return json({ error: "Kon het CSV-bestand niet verwerken: " + e.message }, 400);
      }
      if (!parsed.length) return json({ error: "Geen herkenbare records gevonden in dit bestand." }, 400);

      const existing = await getOverzicht(store);
      const byKey = new Map(existing.map((r) => [keyOf(r), r]));
      let added = 0, updated = 0;
      for (const rec of parsed) {
        const k = keyOf(rec);
        if (byKey.has(k)) {
          if (JSON.stringify(byKey.get(k)) !== JSON.stringify(rec)) updated++;
        } else added++;
        byKey.set(k, rec);
      }
      const { records: reclassified } = reclassifyRecords(Array.from(byKey.values()));
      const finalByKey = new Map();
      for (const r of reclassified) {
        const k = keyOf(r);
        const prev = finalByKey.get(k);
        if (!prev) finalByKey.set(k, r);
        else {
          const pv = parseInt(prev.stock, 10), nv = parseInt(r.stock, 10);
          if ((Number.isNaN(nv) ? -1 : nv) > (Number.isNaN(pv) ? -1 : pv)) finalByKey.set(k, r);
        }
      }
      const merged = sortRecords(Array.from(finalByKey.values()));
      await saveOverzicht(store, merged);
      return json({
        ok: true, totalInFile: parsed.length, added, updated,
        unchanged: parsed.length - added - updated, overzicht: merged,
      });
    }

    // -- Grondstoffenregister-CSV uploaden (vervaldata cross-referencen) --
    if (actie === "upload-grondstoffen") {
      const { fileBase64 } = payload;
      if (!fileBase64) return json({ error: "Geen bestand ontvangen." }, 400);
      const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
      const text = new TextDecoder("iso-8859-1").decode(bytes);
      let parsed;
      try {
        parsed = parseGrondstoffenCsv(text);
      } catch (e) {
        return json({ error: "Kon het CSV-bestand niet verwerken: " + e.message }, 400);
      }
      if (!parsed.length) return json({ error: "Geen herkenbare records gevonden in dit bestand." }, 400);

      const relevant = parsed.filter((r) => r.vervaldatum && r.vervaldatum > CUTOFF_DATE);
      const bestByOmschrijving = new Map();
      for (const r of relevant) {
        const key = normalize(r.omschrijving);
        const prev = bestByOmschrijving.get(key);
        if (!prev || parseInt(r.analyseNr, 10) > parseInt(prev.analyseNr, 10)) bestByOmschrijving.set(key, r);
      }

      const existing = await getOverzicht(store);
      let vervaldatumBijgewerkt = 0;
      const updatedExisting = existing.map((rec) => {
        if (isExcludedLocation(rec.voorraadplaats)) return rec;
        const match = bestByOmschrijving.get(normalize(rec.omschrijving));
        if (!match) return rec;
        if (rec.vervaldatum === match.vervaldatum) return rec;
        vervaldatumBijgewerkt++;
        return { ...rec, vervaldatum: match.vervaldatum };
      });

      const bestaandeOmschrijvingen = new Set(existing.map((r) => normalize(r.omschrijving)));
      const nieuwRecords = [];
      for (const [normOmschr, r] of bestByOmschrijving) {
        if (bestaandeOmschrijvingen.has(normOmschr)) continue;
        nieuwRecords.push({
          cnk: `GR${r.analyseNr}`, omschrijving: r.omschrijving,
          voorraadplaats: PLACEHOLDER_LOCATIE, stock: "", vervaldatum: r.vervaldatum,
        });
      }

      let merged = updatedExisting.concat(nieuwRecords);
      const { records: reclassified } = reclassifyRecords(merged);
      merged = sortRecords(reclassified);
      await saveOverzicht(store, merged);
      return json({
        ok: true, totalInFile: parsed.length, relevantInFile: relevant.length,
        vervaldatumBijgewerkt, nieuweGrondstoffen: nieuwRecords.length, overzicht: merged,
      });
    }

    return json({ error: "Onbekende actie." }, 400);
  }

  // ---------------- PUT ?id=cnk::voorraadplaats: voorraadplaats wijzigen ----------------
  if (req.method === "PUT") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id ontbreekt." }, 400);
    let payload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Ongeldige aanvraag." }, 400);
    }
    const newVoorraadplaats = (payload.newVoorraadplaats || "").trim();
    if (!newVoorraadplaats) return json({ error: "newVoorraadplaats is verplicht." }, 400);

    const existing = await getOverzicht(store);
    const current = existing.find((r) => keyOf(r) === id);
    if (!current) return json({ error: "Product niet gevonden." }, 404);

    const moved = { ...current, voorraadplaats: newVoorraadplaats };
    const { records: reclassified } = reclassifyRecords([moved]);
    const finalRecord = reclassified[0];

    const byKey = new Map(existing.map((r) => [keyOf(r), r]));
    byKey.delete(id);
    byKey.set(keyOf(finalRecord), finalRecord);
    const merged = sortRecords(Array.from(byKey.values()));
    await saveOverzicht(store, merged);
    return json({ ok: true, overzicht: merged });
  }

  // ---------------- DELETE ?id=cnk::voorraadplaats ----------------
  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id ontbreekt." }, 400);
    const existing = await getOverzicht(store);
    const remaining = existing.filter((r) => keyOf(r) !== id);
    await saveOverzicht(store, remaining);
    return json({ ok: true, overzicht: remaining });
  }

  return json({ error: "Methode niet toegestaan." }, 405);
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export const config = {
  path: "/api/voorraadplaatsen",
};
