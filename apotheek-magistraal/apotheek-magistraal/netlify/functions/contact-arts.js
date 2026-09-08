import { getStore } from "@netlify/blobs";

// Hergebruikt exact hetzelfde login-systeem als de andere modules (zelfde
// apotheek-accounts, zelfde TOKEN_SECRET). Eigen store per apotheek.
const KEY_PREFIX = "contact-";

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

  const store = getStore(`contact-arts-${apotheekId}`);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    if (id) {
      const contact = await store.get(KEY_PREFIX + id, { type: "json" });
      if (!contact) return json({ error: "Niet gevonden." }, 404);
      return json(contact);
    }
    const { blobs } = await store.list({ prefix: KEY_PREFIX });
    const opgehaald = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: "json" }))
    );
    const alles = opgehaald.filter(Boolean)
      .sort((a, b) => (b.contactDatum ?? "").localeCompare(a.contactDatum ?? ""));

    return json({ lijst: alles });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ongeldige JSON in request body." }, 400);
    }
    if (!body.arts || !body.patient || !body.contactDatum || !body.verslag) {
      return json({ error: "Naam arts, naam patiënt, datum/uur en vervolgverslag zijn verplicht." }, 400);
    }
    const now = new Date().toISOString();
    const contact = {
      id: crypto.randomUUID(),
      arts: body.arts,
      patient: body.patient,
      contactDatum: body.contactDatum, // ISO datum+uur van het telefonisch contact
      onderwerp: body.onderwerp ?? "",
      verslag: body.verslag,
      notities: [],
      aangemaakt: now,
      bijgewerkt: now,
    };
    await store.setJSON(KEY_PREFIX + contact.id, contact);
    return json(contact, 201);
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
      arts: body.arts ?? existing.arts,
      patient: body.patient ?? existing.patient,
      contactDatum: body.contactDatum ?? existing.contactDatum,
      onderwerp: body.onderwerp ?? existing.onderwerp,
      verslag: body.verslag ?? existing.verslag,
      notities: body.nieuweNotitie
        ? [...(existing.notities ?? []), { id: crypto.randomUUID(), tekst: body.nieuweNotitie, datum: new Date().toISOString() }]
        : body.verwijderNotitieId
        ? (existing.notities ?? []).filter((n) => n.id !== body.verwijderNotitieId)
        : (existing.notities ?? []),
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
  path: "/api/contact-arts",
};
