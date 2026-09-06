// Eenvoudige gedeelde login voor lokaal gebruik.
// Het echte wachtwoord staat NIET in de code, maar als environment variable
// in Netlify (Site configuration > Environment variables):
//   APOTHEEK_WACHTWOORD = het wachtwoord dat medewerkers intikken
//   APOTHEEK_TOKEN      = een lang willekeurig geheim, wordt na een geslaagde
//                         login teruggestuurd en nadien gebruikt om de
//                         data-API (magistraal.js) te beveiligen
export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Methode niet toegestaan." }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ongeldige JSON in request body." }, 400);
  }

  const verwacht = process.env.APOTHEEK_WACHTWOORD;
  const token = process.env.APOTHEEK_TOKEN;

  if (!verwacht || !token) {
    // Dev-modus: nog niet geconfigureerd, dus login even loslaten om
    // makkelijker te kunnen testen. Zodra je APOTHEEK_WACHTWOORD en
    // APOTHEEK_TOKEN instelt in Netlify, wordt de echte controle automatisch
    // actief (zie hieronder).
    return json({ token: "dev-modus", devModus: true });
  }

  if (body.wachtwoord !== verwacht) {
    return json({ error: "Fout wachtwoord." }, 401);
  }

  return json({ token });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = {
  path: "/api/login",
};
