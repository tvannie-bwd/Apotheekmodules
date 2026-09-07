import { getStore } from "@netlify/blobs";

// Hergebruikt exact hetzelfde login-systeem als magistraal.js (zelfde
// apotheek-accounts, zelfde TOKEN_SECRET). Enkel de datastore is anders:
// per apotheek een eigen store "bestellingen-<apotheekId>".
const KEY_PREFIX = "bestelling-";

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

  const store = getStore(`bestellingen-${apotheekId}`);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    if (id) {
      const bestelling = await store.get(KEY_PREFIX + id, { type: "json" });
      if (!bestelling) return json({ error: "Niet gevonden." }, 404);
      return json(bestelling);
    }
    const { blobs } = await store.list({ prefix: KEY_PREFIX });
    const opgehaald = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: "json" }))
    );
    const alles = opgehaald.filter(Boolean);

    // Openstaand: oudste registratie eerst (FIFO). Boek: meest recent
    // afgevinkt eerst.
    const openstaand = alles
      .filter((b) => !b.klaar)
      .sort((a, b) => (a.aangemaakt ?? "").localeCompare(b.aangemaakt ?? ""));
    const geschiedenis = alles
      .filter((b) => b.klaar)
      .sort((a, b) => (b.klaarOp ?? "").localeCompare(a.klaarOp ?? ""));

    return json({ openstaand, geschiedenis });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ongeldige JSON in request body." }, 400);
    }
    if (!body.productnaam) {
      return json({ error: "Productnaam is verplicht." }, 400);
    }
    if (body.reden !== "ontbrekend" && body.reden !== "speciaal") {
      return json({ error: "Reden moet 'ontbrekend' of 'speciaal' zijn." }, 400);
    }
    const now = new Date().toISOString();
    const bestelling = {
      id: crypto.randomUUID(),
      productnaam: body.productnaam,
      cnk: body.cnk ?? "",
      hoeveelheid: body.hoeveelheid ?? 1,
      reden: body.reden, // "ontbrekend" of "speciaal"
      patient: body.patient ?? "",
      notitie: body.notitie ?? "",
      actie: "",
      contacteren: body.contacteren ?? false,
      gecontacteerd: false,
      klaar: false,
      klaarOp: null,
      aangemaakt: now,
      bijgewerkt: now,
    };
    await store.setJSON(KEY_PREFIX + bestelling.id, bestelling);
    return json(bestelling, 201);
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

    const wordtNuKlaarGemeld = body.klaar === true && !existing.klaar;
    const wordtHeropend = body.klaar === false && existing.klaar;

    const updated = {
      ...existing,
      productnaam: body.productnaam ?? existing.productnaam,
      cnk: body.cnk ?? existing.cnk,
      hoeveelheid: body.hoeveelheid ?? existing.hoeveelheid,
      reden: body.reden ?? existing.reden,
      patient: body.patient ?? existing.patient,
      notitie: body.notitie ?? existing.notitie,
      actie: body.actie ?? existing.actie,
      contacteren: body.contacteren ?? existing.contacteren,
      gecontacteerd: body.gecontacteerd ?? existing.gecontacteerd,
      klaar: body.klaar ?? existing.klaar,
      klaarOp: wordtNuKlaarGemeld
        ? new Date().toISOString()
        : wordtHeropend
        ? null
        : existing.klaarOp,
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
  path: "/api/bestellingen",
};
