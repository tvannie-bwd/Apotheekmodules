import { getStore } from "@netlify/blobs";

// Eén gedeelde store met apotheek-accounts (naam + gehashte code).
// Elke apotheek krijgt hierdoor haar eigen login en haar eigen afgescheiden
// data (zie magistraal.js, die per apotheek een aparte store gebruikt).
const ACCOUNTS_STORE = "apotheek-accounts";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan." }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ongeldige JSON in request body." }, 400);
  }

  const { uitnodigingscode, apotheeknaam, code } = body;
  if (!apotheeknaam || !code) {
    return json({ error: "Naam van de apotheek en code zijn verplicht." }, 400);
  }

  // De uitnodigingscode is een geheim dat JIJ bepaalt en doorgeeft aan een
  // nieuwe apotheek. Zolang MASTER_UITNODIGINGSCODE niet is ingesteld
  // (dev-modus), wordt deze controle overgeslagen.
  const verwachteUitnodigingscode = process.env.MASTER_UITNODIGINGSCODE;
  if (verwachteUitnodigingscode && uitnodigingscode !== verwachteUitnodigingscode) {
    return json({ error: "Ongeldige uitnodigingscode." }, 401);
  }

  const apotheekId = slugify(apotheeknaam);
  if (!apotheekId) return json({ error: "Ongeldige apotheeknaam." }, 400);

  const store = getStore(ACCOUNTS_STORE);
  const bestaand = await store.get(apotheekId, { type: "json" });
  if (bestaand) {
    return json(
      { error: "Er bestaat al een apotheek met deze naam. Gebruik 'Inloggen' in plaats van 'Nieuwe apotheek'." },
      409
    );
  }

  const codeHash = await sha256Hex(code);
  await store.setJSON(apotheekId, {
    naam: apotheeknaam,
    codeHash,
    aangemaakt: new Date().toISOString(),
  });

  const tokenSecret = process.env.TOKEN_SECRET;
  const token = tokenSecret
    ? `${apotheekId}.${await hmacHex(apotheekId, tokenSecret)}`
    : `${apotheekId}.dev`;

  return json({ token, apotheekId, apotheeknaam }, 201);
};

function slugify(naam) {
  return naam
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

async function sha256Hex(tekst) {
  const data = new TextEncoder().encode(tekst);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = {
  path: "/api/register",
};
