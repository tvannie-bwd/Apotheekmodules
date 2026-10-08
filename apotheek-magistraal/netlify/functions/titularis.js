import { getStore } from "@netlify/blobs";

// Extra beveiligingslaag bovenop de gewone apotheek-login: een aparte code
// die enkel de titularis kent. Vereist eerst een geldig apotheek-token
// (net als de andere modules), en controleert daarnaast deze eigen code.
const CODE_KEY = "titularis-code";

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

async function sha256Hex(tekst) {
  const data = new TextEncoder().encode(tekst);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  const store = getStore(`titularis-${apotheekId}`);

  if (req.method === "GET") {
    const bestaand = await store.get(CODE_KEY, { type: "json" });
    return json({ ingesteld: !!bestaand });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ongeldige JSON in request body." }, 400);
    }

    if (body.actie === "instellen") {
      if (!body.code || String(body.code).length !== 4) {
        return json({ error: "Code moet exact 4 cijfers zijn." }, 400);
      }
      const bestaand = await store.get(CODE_KEY, { type: "json" });
      if (bestaand) {
        return json({ error: "Er is al een titularis-code ingesteld. Gebruik 'Code wijzigen' om die aan te passen." }, 409);
      }
      const codeHash = await sha256Hex(String(body.code));
      await store.setJSON(CODE_KEY, { codeHash, aangemaakt: new Date().toISOString() });
      return json({ ok: true }, 201);
    }

    if (body.actie === "wijzigen") {
      const bestaand = await store.get(CODE_KEY, { type: "json" });
      if (!bestaand) {
        return json({ error: "Er is nog geen titularis-code ingesteld." }, 404);
      }
      const huidigeHash = await sha256Hex(String(body.huidigeCode ?? ""));
      if (huidigeHash !== bestaand.codeHash) {
        return json({ error: "Huidige code is fout." }, 401);
      }
      if (!body.nieuweCode || String(body.nieuweCode).length !== 4) {
        return json({ error: "Nieuwe code moet exact 4 cijfers zijn." }, 400);
      }
      const nieuweHash = await sha256Hex(String(body.nieuweCode));
      await store.setJSON(CODE_KEY, { codeHash: nieuweHash, aangemaakt: bestaand.aangemaakt, bijgewerkt: new Date().toISOString() });
      return json({ ok: true });
    }

    if (body.actie === "verifieren") {
      const bestaand = await store.get(CODE_KEY, { type: "json" });
      if (!bestaand) {
        return json({ error: "Er is nog geen titularis-code ingesteld." }, 404);
      }
      const ingevoerdeHash = await sha256Hex(String(body.code ?? ""));
      if (ingevoerdeHash !== bestaand.codeHash) {
        return json({ error: "Foute code." }, 401);
      }
      return json({ ok: true });
    }

    return json({ error: "Onbekende actie." }, 400);
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
  path: "/api/titularis",
};
