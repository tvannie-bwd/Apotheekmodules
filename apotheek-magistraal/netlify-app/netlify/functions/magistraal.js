import { getStore } from "@netlify/blobs";

// Eén store voor deze module, met twee "types" bereidingen:
// - "patient": magistrale bereiding voor een specifieke patiënt
// - "voorraad": bereiding die terug aangemaakt moet worden voor de voorraad
const STORE_NAME = "magistraal";
const KEY_PREFIX = "bereiding-";

export default async (req) => {
  const store = getStore(STORE_NAME);
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    if (id) {
      const bereiding = await store.get(KEY_PREFIX + id, { type: "json" });
      if (!bereiding) return json({ error: "Niet gevonden." }, 404);
      return json(bereiding);
    }
    const { blobs } = await store.list({ prefix: KEY_PREFIX });
    const alles = await Promise.all(
      blobs.map((b) => store.get(b.key, { type: "json" }))
    );
    const sorteerOpenstaand = (a, b) => (a.datumAfhaling ?? "").localeCompare(b.datumAfhaling ?? "");
    const sorteerGeschiedenis = (a, b) => (b.klaarOp ?? "").localeCompare(a.klaarOp ?? "");

    const patientOpenstaand = alles.filter((b) => b.type === "patient" && !b.klaar).sort(sorteerOpenstaand);
    const patientGeschiedenis = alles.filter((b) => b.type === "patient" && b.klaar).sort(sorteerGeschiedenis);
    const voorraadOpenstaand = alles.filter((b) => b.type === "voorraad" && !b.klaar).sort(sorteerOpenstaand);
    const voorraadGeschiedenis = alles.filter((b) => b.type === "voorraad" && b.klaar).sort(sorteerGeschiedenis);

    return json({ patientOpenstaand, patientGeschiedenis, voorraadOpenstaand, voorraadGeschiedenis });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Ongeldige JSON in request body." }, 400);
    }
    if (body.type !== "patient" && body.type !== "voorraad") {
      return json({ error: "Veld 'type' moet 'patient' of 'voorraad' zijn." }, 400);
    }
    if (body.type === "patient" && !body.patient) {
      return json({ error: "Naam patiënt is verplicht." }, 400);
    }
    if (body.type === "voorraad" && !body.bereidingNaam) {
      return json({ error: "Naam van de bereiding is verplicht." }, 400);
    }
    if (!body.datumAfhaling) {
      return json({ error: "Datum van afhaling is verplicht." }, 400);
    }
    const now = new Date().toISOString();
    const bereiding = {
      id: crypto.randomUUID(),
      type: body.type,
      patient: body.type === "patient" ? body.patient : null,
      bereidingNaam: body.type === "voorraad" ? body.bereidingNaam : null,
      notitie: body.notitie ?? "",
      datumAfhaling: body.datumAfhaling,
      klaar: false,
      klaarOp: null,
      aangemaakt: now,
      bijgewerkt: now,
    };
    await store.setJSON(KEY_PREFIX + bereiding.id, bereiding);
    return json(bereiding, 201);
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
      bereidingNaam: body.bereidingNaam ?? existing.bereidingNaam,
      notitie: body.notitie ?? existing.notitie,
      datumAfhaling: body.datumAfhaling ?? existing.datumAfhaling,
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
    headers: { "Content-Type": "application/json" },
  });
}

export const config = {
  path: "/api/magistraal",
};
