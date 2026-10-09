import { getStore } from "@netlify/blobs";

// Hergebruikt hetzelfde login-systeem als de andere modules. Eigen store
// per apotheek: dagboeken (KEY_PREFIX "dagboek-") + één vaste key
// "tarieven" met de RIZIV-naslagtabel (aanpasbaar).
const KEY_PREFIX = "dagboek-";
const TARIEVEN_KEY = "tarieven";

// Standaardtarieven o.b.v. de "virtuele portefeuille" (RIZIV), stand
// 1 januari 2026. Blijft aanpasbaar per apotheek via de tarieven-editor,
// voor als deze bedragen wijzigen.
const STANDAARD_TARIEVEN = [
  { stomaType: "colostoma", categorie: "basis", fase: "eerste3maanden", rizivCode: "655336", bedrag: 944.72 },
  { stomaType: "colostoma", categorie: "basis", fase: "vanaf4demaand", rizivCode: "655351", bedrag: 769.53 },
  { stomaType: "ileostoma", categorie: "basis", fase: "eerste3maanden", rizivCode: "655373", bedrag: 825.97 },
  { stomaType: "ileostoma", categorie: "basis", fase: "vanaf4demaand", rizivCode: "655432", bedrag: 650.78 },
  { stomaType: "urostoma", categorie: "basis", fase: "eerste3maanden", rizivCode: "655454", bedrag: 917.81 },
  { stomaType: "urostoma", categorie: "basis", fase: "vanaf4demaand", rizivCode: "655476", bedrag: 742.62 },
  { stomaType: "colostoma", categorie: "convexconcaaf", fase: "eerste3maanden", rizivCode: "655491", bedrag: 1169.70 },
  { stomaType: "colostoma", categorie: "convexconcaaf", fase: "vanaf4demaand", rizivCode: "655550", bedrag: 994.49 },
  { stomaType: "ileostoma", categorie: "convexconcaaf", fase: "eerste3maanden", rizivCode: "655572", bedrag: 1050.95 },
  { stomaType: "ileostoma", categorie: "convexconcaaf", fase: "vanaf4demaand", rizivCode: "655594", bedrag: 875.76 },
  { stomaType: "urostoma", categorie: "convexconcaaf", fase: "eerste3maanden", rizivCode: "655631", bedrag: 1142.77 },
  { stomaType: "urostoma", categorie: "convexconcaaf", fase: "vanaf4demaand", rizivCode: "655653", bedrag: 967.58 },
  { stomaType: "colostoma", categorie: "uitzonderlijk", fase: "vanaf4demaand", rizivCode: "655675", bedrag: 1076.50 },
  { stomaType: "ileostoma", categorie: "uitzonderlijk", fase: "vanaf4demaand", rizivCode: "655896", bedrag: 957.76 },
  { stomaType: "urostoma", categorie: "uitzonderlijk", fase: "vanaf4demaand", rizivCode: "655911", bedrag: 1049.59 },
  { stomaType: "colostoma", categorie: "uitzonderlijk_convex", fase: "vanaf4demaand", rizivCode: "655933", bedrag: 1301.47 },
  { stomaType: "ileostoma", categorie: "uitzonderlijk_convex", fase: "vanaf4demaand", rizivCode: "655955", bedrag: 1182.74 },
  { stomaType: "urostoma", categorie: "uitzonderlijk_convex", fase: "vanaf4demaand", rizivCode: "655970", bedrag: 1274.56 },
];

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

function normaliseerAflevering(a) {
  return {
    id: a.id || crypto.randomUUID(),
    datum: a.datum ?? "",
    product: a.product ?? "",
    cnk: a.cnk ?? "",
    bedrag: getalOf(a.bedrag),
  };
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

  const store = getStore(`bandagisterie-${apotheekId}`);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const resource = url.searchParams.get("resource"); // "tarieven" of niets (dagboeken)

  // ---------------- Tarieventabel ----------------
  if (resource === "tarieven") {
    if (req.method === "GET") {
      const tarieven = (await store.get(TARIEVEN_KEY, { type: "json" })) || STANDAARD_TARIEVEN;
      return json({ tarieven });
    }
    if (req.method === "PUT") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Ongeldige JSON in request body." }, 400);
      }
      if (!Array.isArray(body.tarieven)) return json({ error: "Ongeldige tarievenlijst." }, 400);
      const genormaliseerd = body.tarieven.map((t) => ({
        stomaType: t.stomaType ?? "",
        categorie: t.categorie ?? "",
        fase: t.fase ?? "",
        rizivCode: t.rizivCode ?? "",
        bedrag: getalOf(t.bedrag),
      }));
      await store.setJSON(TARIEVEN_KEY, genormaliseerd);
      return json({ ok: true, tarieven: genormaliseerd });
    }
    return json({ error: "Methode niet toegestaan." }, 405);
  }

  // ---------------- Dagboeken ----------------
  if (req.method === "GET") {
    if (id) {
      const dagboek = await store.get(KEY_PREFIX + id, { type: "json" });
      if (!dagboek) return json({ error: "Niet gevonden." }, 404);
      return json(dagboek);
    }
    const { blobs } = await store.list({ prefix: KEY_PREFIX });
    const opgehaald = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    const alles = opgehaald.filter(Boolean);

    const openstaand = alles
      .filter((d) => !d.klaar)
      .sort((a, b) => (a.periodeVan ?? "").localeCompare(b.periodeVan ?? ""));
    const geschiedenis = alles
      .filter((d) => d.klaar)
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
    if (!body.patient || !body.periodeVan || !body.periodeTot) {
      return json({ error: "Naam patiënt en periode (van/tot) zijn verplicht." }, 400);
    }
    const now = new Date().toISOString();
    const dagboek = {
      id: crypto.randomUUID(),
      patient: body.patient,
      insz: body.insz ?? "",
      periodeVan: body.periodeVan,
      periodeTot: body.periodeTot,
      stomaType: body.stomaType ?? "",
      categorie: body.categorie ?? "",
      fase: body.fase ?? "",
      rizivCode: body.rizivCode ?? "",
      maxBudget: getalOf(body.maxBudget),
      bijlage93: body.bijlage93 ?? "nog_niet",
      afleveringen: Array.isArray(body.afleveringen) ? body.afleveringen.map(normaliseerAflevering) : [],
      klaar: false,
      klaarOp: null,
      aangemaakt: now,
      bijgewerkt: now,
    };
    await store.setJSON(KEY_PREFIX + dagboek.id, dagboek);
    return json(dagboek, 201);
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
      patient: body.patient ?? existing.patient,
      insz: body.insz ?? existing.insz,
      periodeVan: body.periodeVan ?? existing.periodeVan,
      periodeTot: body.periodeTot ?? existing.periodeTot,
      stomaType: body.stomaType ?? existing.stomaType,
      categorie: body.categorie ?? existing.categorie,
      fase: body.fase ?? existing.fase,
      rizivCode: body.rizivCode ?? existing.rizivCode,
      maxBudget: body.maxBudget !== undefined ? getalOf(body.maxBudget) : existing.maxBudget,
      bijlage93: body.bijlage93 ?? existing.bijlage93,
      afleveringen: Array.isArray(body.afleveringen)
        ? body.afleveringen.map(normaliseerAflevering)
        : existing.afleveringen,
      klaar: body.klaar ?? existing.klaar,
      klaarOp: wordtNuKlaarGemeld ? new Date().toISOString() : wordtHeropend ? null : existing.klaarOp,
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
  path: "/api/bandagisterie",
};
