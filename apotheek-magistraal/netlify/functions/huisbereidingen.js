import { getStore } from "@netlify/blobs";

// Hergebruikt hetzelfde login-systeem als de andere modules. Eigen store
// per apotheek voor de vaste recepten (huisbereidingen).
const KEY_PREFIX = "recept-";

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
