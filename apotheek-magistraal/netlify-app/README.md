# Module 1 — Magistraal

Registratie en opvolging van magistrale bereidingen, in twee tabbladen:

- **Nieuwe bereiding** (opent standaard): patiëntgebonden bereiding — naam
  patiënt, notitie, datum + uur van afhaling.
- **Nieuwe voorraadbereiding**: bereiding die terug aangemaakt moet worden
  voor de voorraad — in plaats van een patiëntnaam geef je hier in **welke
  bereiding leeg is**, plus notitie en datum + uur van afhaling.

Elk tabblad heeft zijn eigen "Openstaand"-lijst (gesorteerd op datum van
afhaling) en eigen "Bereidingenboek" (geschiedenis van afgevinkte
bereidingen van dat type).

## Structuur

```
apotheek-magistraal/
├── netlify.toml
├── package.json
├── netlify/functions/magistraal.js   ← API (GET/POST/PUT/DELETE op /api/magistraal)
└── public/index.html                  ← twee tabbladen: Nieuwe bereiding / Nieuwe voorraadbereiding
```

## Werking

- Bij het laden van de pagina staat **"Nieuwe bereiding"** altijd als eerste
  actieve tabblad open.
- **Datum van afhaling**: standaard vandaag. **Uur van afhaling**: keuzelijst
  met enkel de uren 08 t.e.m. 18, en enkel de minuten 00 of 30 — er kan dus
  geen tijdstip buiten die grenzen ingevoerd worden.
- Naast het datumveld verschijnt live de volledige weekdag (bv.
  "vrijdag"), rechts uitgelijnd tegen het datumveld.
- **Afvinken**: vinkje aanklikken → bereiding verdwijnt uit "Openstaand" en
  komt in het bijhorende **"Bereidingenboek"** terecht, met tijdstip van
  afvinken. Een vinkje in het bereidingenboek terug uitzetten zet de
  bereiding terug naar "Openstaand".
- **Verwijderen**: enkel vanuit "Openstaand". Klik eenmaal op "Verwijderen"
  → knop wordt "Zeker? Klik opnieuw" → een tweede klik binnen 3 seconden
  verwijdert echt (geen browser-popup, dus werkt overal betrouwbaar).

## Lokaal testen

```
cd apotheek-magistraal
npm install
netlify dev
```
Open de getoonde URL (meestal `http://localhost:8888`).

## Deployen naar Netlify

```
netlify deploy --prod
```
of koppel deze map via Git aan een Netlify-site.

## Let op bij samenvoegen met andere modules

- Deze module gebruikt de Netlify Blobs-store `"magistraal"` met keys
  `bereiding-<uuid>`, elk met een `type`-veld (`"patient"` of `"voorraad"`).
  Dat botst niet met andere modules zolang zij hun eigen store-naam
  gebruiken (bv. `"temperatuurlog"`, `"todos"`).
- De functie draait op `/api/magistraal` — houd deze padnaam ook zo aan in
  de uiteindelijke samengevoegde app, of pas de `fetch`-aanroepen in
  `public/index.html` aan als je het pad wijzigt.

