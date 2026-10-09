import { getStore } from "@netlify/blobs";

// Hergebruikt hetzelfde login-systeem als de andere modules. Eigen store
// per apotheek voor de vaste recepten (huisbereidingen).
const KEY_PREFIX = "recept-";
const GRONDSTOF_PREFIX = "grondstof-";
const FACTUUR_PREFIX = "factuur-";

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

function getalOf(v, standaard = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : standaard;
}

function normaliseerIngredient(i) {
  return {
    naam: i.naam ?? "",
    aankoopprijs: getalOf(i.aankoopprijs),
    verpakkingsinhoud: getalOf(i.verpakkingsinhoud, 1),
    eenheid: i.eenheid ?? "",
    btw: getalOf(i.btw),
    korting: getalOf(i.korting),
    hoeveelheid: getalOf(i.hoeveelheid),
    cnk: i.cnk ? String(i.cnk) : "",
  };
}

function normaliseerExtraKost(k) {
  return { naam: k.naam ?? "", bedrag: getalOf(k.bedrag) };
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

  const store = getStore(`huisbereidingen-${apotheekId}`);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  // ---- Grondstofprijzen uit facturen (?resource=grondstoffen) ----
  if (url.searchParams.get("resource") === "grondstoffen") {
    const cnkParam = url.searchParams.get("cnk");

    if (req.method === "GET") {
      const { blobs } = await store.list({ prefix: GRONDSTOF_PREFIX });
      const lijst = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }))))
        .filter(Boolean)
        .sort((a, b) => (a.naam ?? "").localeCompare(b.naam ?? "", "nl", { sensitivity: "base" }));
      const fact = await store.list({ prefix: FACTUUR_PREFIX });
      const facturen = fact.blobs.map((b) => b.key.slice(FACTUUR_PREFIX.length));
      return json({ lijst, facturen });
    }

    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "Ongeldige JSON in request body." }, 400); }
      const f = body.factuur;
      if (!f || !f.nr || !/^\d{4}-\d{2}-\d{2}$/.test(f.datum || "") || !Array.isArray(f.lijnen)) {
        return json({ error: "Factuurnummer, datum en lijnen zijn verplicht." }, 400);
      }
      if (await store.get(FACTUUR_PREFIX + f.nr, { type: "json" })) {
        return json({ error: `Factuur ${f.nr} is al ingelezen.` }, 409);
      }
      let nieuw = 0, bijgewerkt = 0, ongewijzigd = 0;
      for (const l of f.lijnen) {
        if (!l.cnk || !(getalOf(l.prijs) > 0)) continue;
        const key = GRONDSTOF_PREFIX + String(l.cnk);
        const bestaand = await store.get(key, { type: "json" });
        const punt = { datum: f.datum, factuur: String(f.nr), prijs: getalOf(l.prijs), korting: getalOf(l.korting) };
        const historiek = [...(bestaand?.historiek ?? []), punt]
          .sort((a, b) => b.datum.localeCompare(a.datum))
          .filter((h, i, arr) => arr.findIndex((x) => x.factuur === h.factuur) === i)
          .slice(0, 12);
        const isNieuwste = !bestaand || f.datum >= bestaand.datum;
        const basis = bestaand ?? {};
        const record = {
          ...basis,
          cnk: String(l.cnk),
          naam: isNieuwste || !bestaand ? (l.naam || basis.naam || "") : basis.naam,
          omschrijving: isNieuwste ? (l.omschrijving || basis.omschrijving || "") : basis.omschrijving,
          verpakkingsinhoud: isNieuwste ? getalOf(l.verpakkingsinhoud, 1) : basis.verpakkingsinhoud,
          eenheid: isNieuwste ? (l.eenheid ?? "") : basis.eenheid,
          prijs: isNieuwste ? punt.prijs : basis.prijs,
          korting: isNieuwste ? punt.korting : basis.korting,
          datum: isNieuwste ? f.datum : basis.datum,
          factuur: isNieuwste ? String(f.nr) : basis.factuur,
          lot: isNieuwste ? (l.lot ?? "") : basis.lot,
          // type blijft wat de gebruiker eerder koos; enkel bij een nieuw product de gok uit de factuur
          type: bestaand?.type ?? (l.type === "hulpstof" ? "hulpstof" : "actief"),
          historiek,
        };
        await store.setJSON(key, record);
        if (!bestaand) nieuw++; else if (isNieuwste && (basis.prijs !== record.prijs || basis.korting !== record.korting)) bijgewerkt++; else ongewijzigd++;
      }
      await store.setJSON(FACTUUR_PREFIX + f.nr, { nr: String(f.nr), datum: f.datum, aantalLijnen: f.lijnen.length, ingelezen: new Date().toISOString() });
      return json({ factuur: String(f.nr), nieuw, bijgewerkt, ongewijzigd }, 201);
    }

    if (req.method === "PUT") {
      if (!cnkParam) return json({ error: "Parameter 'cnk' is verplicht." }, 400);
      const bestaand = await store.get(GRONDSTOF_PREFIX + cnkParam, { type: "json" });
      if (!bestaand) return json({ error: "Niet gevonden." }, 404);
      let body;
      try { body = await req.json(); } catch { return json({ error: "Ongeldige JSON in request body." }, 400); }
      const record = {
        ...bestaand,
        type: ["actief", "hulpstof"].includes(body.type) ? body.type : bestaand.type,
        naam: typeof body.naam === "string" && body.naam.trim() ? body.naam.trim() : bestaand.naam,
      };
      await store.setJSON(GRONDSTOF_PREFIX + cnkParam, record);
      return json(record);
    }

    if (req.method === "DELETE") {
      if (!cnkParam) return json({ error: "Parameter 'cnk' is verplicht." }, 400);
      await store.delete(GRONDSTOF_PREFIX + cnkParam);
      return json({ cnk: cnkParam, deleted: true });
    }
    return json({ error: "Methode niet toegestaan." }, 405);
  }

  if (req.method === "GET") {
    if (id) {
      const recept = await store.get(KEY_PREFIX + id, { type: "json" });
      if (!recept) return json({ error: "Niet gevonden." }, 404);
      return json(recept);
    }
    const { blobs } = await store.list({ prefix: KEY_PREFIX });
    const opgehaald = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: "json" }))
    );
    const lijst = opgehaald.filter(Boolean)
      .sort((a, b) => (a.naam ?? "").localeCompare(b.naam ?? ""));

    return json({ lijst });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ongeldige JSON in request body." }, 400);
    }
    if (!body.naam || !Array.isArray(body.ingredienten) || body.ingredienten.length === 0) {
      return json({ error: "Naam en minstens één ingrediënt zijn verplicht." }, 400);
    }
    const now = new Date().toISOString();
    const recept = {
      id: crypto.randomUUID(),
      naam: body.naam,
      soort: body.soort === "capsules" ? "capsules" : "normaal",
      aantalGelules: body.soort === "capsules" ? getalOf(body.aantalGelules) : 0,
      eenheidLabel: body.eenheidLabel ?? "",
      aantalVerkoopeenheden: getalOf(body.aantalVerkoopeenheden, 1),
      verkoopprijs: getalOf(body.verkoopprijs),
      aantalVerkocht: getalOf(body.aantalVerkocht),
      ingredienten: body.ingredienten.map(normaliseerIngredient),
      extraKosten: Array.isArray(body.extraKosten) ? body.extraKosten.map(normaliseerExtraKost) : [],
      aangemaakt: now,
      bijgewerkt: now,
    };
    await store.setJSON(KEY_PREFIX + recept.id, recept);
    return json(recept, 201);
  }

  if (req.method === "PUT") {
    if (!id) return json({ error: "Parameter 'id' is verplicht." }, 400);
    const existing = await store.get(KEY_PREFIX + id, { type: "json" });
    if (!existing) return json({ error: "Niet gevonden." }, 404);
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ongeldige JSON in request body." }, 400);
    }
    const updated = {
      ...existing,
      naam: body.naam ?? existing.naam,
      soort: body.soort !== undefined ? (body.soort === "capsules" ? "capsules" : "normaal") : (existing.soort ?? "normaal"),
      aantalGelules: body.soort !== undefined ? (body.soort === "capsules" ? getalOf(body.aantalGelules) : 0) : (existing.aantalGelules ?? 0),
      eenheidLabel: body.eenheidLabel ?? existing.eenheidLabel,
      aantalVerkoopeenheden: body.aantalVerkoopeenheden !== undefined ? getalOf(body.aantalVerkoopeenheden, 1) : existing.aantalVerkoopeenheden,
      verkoopprijs: body.verkoopprijs !== undefined ? getalOf(body.verkoopprijs) : existing.verkoopprijs,
      aantalVerkocht: body.aantalVerkocht !== undefined ? getalOf(body.aantalVerkocht) : existing.aantalVerkocht,
      ingredienten: Array.isArray(body.ingredienten)
        ? body.ingredienten.map(normaliseerIngredient)
        : existing.ingredienten,
      extraKosten: Array.isArray(body.extraKosten)
        ? body.extraKosten.map(normaliseerExtraKost)
        : existing.extraKosten,
      bijgewerkt: new Date().toISOString(),
    };
    await store.setJSON(KEY_PREFIX + id, updated);
    return json(updated);
  }

  if (req.method === "DELETE") {
    if (!id) return json({ error: "Parameter 'id' is verplicht." }, 400);
    await store.delete(KEY_PREFIX + id);
    return json({ id, deleted: true });
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
  path: "/api/huisbereidingen",
};
