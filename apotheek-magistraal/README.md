# Apotheek — Magistraal, Speciale bestellingen, Contact arts, Mutualiteiten & Huisbereidingen

Dit project bevat vijf modules die dezelfde login/apotheek-accounts delen:

- **Magistraal** (`public/index.html`, `netlify/functions/magistraal.js`):
  patiëntgebonden en voorraad-bereidingen, zie verder in dit document.
- **Speciale bestellingen** (`public/bestellingen.html`, `netlify/functions/bestellingen.js`,
  `netlify/functions/leveranciers.js`):
  ontbrekende en/of speciaal te bestellen producten. Bevat ook een aparte
  naslaglijst **"Vaste leveranciers"**: productnaam + bijhorende leverancier,
  doorzoekbaar, om snel op te zoeken welk product altijd via welke
  leverancier besteld wordt.
- **Contact arts** (`public/contact-arts.html`, `netlify/functions/contact-arts.js`):
  kort vervolgverslag na telefonisch contact met een arts, zodat collega's
  kunnen opvolgen.
- **Mutualiteiten** (`public/mutualiteiten.html`): statische naslagpagina met
  vergelijkingstabellen van extra terugbetalingen per Vlaamse mutualiteit.
- **Huisbereidingen** (`public/huisbereidingen.html`, `netlify/functions/huisbereidingen.js`):
  prijsberekening voor vaste huisbereidingen (recepten), gebaseerd op de
  echte rekenwijze uit de bestaande Excel-bestanden. Per ingrediënt geef je
  in: aankoopprijs van de verpakking, inhoud van die verpakking, eenheid,
  BTW% en korting% (beide individueel instelbaar per ingrediënt, want dit
  verschilt per product/leverancier), en de gebruikte hoeveelheid in de
  volledige bereiding (in dezelfde eenheid als de verpakking). Daarnaast
  geef je het aantal verkoopeenheden op dat de bereiding oplevert (bv. 50
  flessen), en eventuele extra kosten per eenheid (bv. flesje + doosje).
  De aankoopprijs (AP) per verkoopeenheid wordt automatisch berekend:
  `prijs per aankoopeenheid = aankoopprijs × (1 + btw/100) × (1 − korting/100) / verpakkingsinhoud`,
  `kost per verkoopeenheid = prijs per aankoopeenheid × hoeveelheid / aantal verkoopeenheden`,
  `AP = Σ (kost per verkoopeenheid over alle ingrediënten) + extra kosten`.
  De verkoopprijs (PP) geef je zelf in (dit wordt niet automatisch berekend
  met een marge%, exact zoals in de Excel-bestanden) — de winst per eenheid
  (`PP − AP`) en desgewenst de totale winst (bij een ingegeven aantal
  verkocht) worden automatisch getoond. Recepten blijven bewaard,
  herbruikbaar en aanpasbaar; de prijs wordt altijd live herberekend.

Alle vijf modules gebruiken **dezelfde login** (`/api/login`, `/api/register`,
dezelfde `apotheek-accounts`-store) — eenmaal aanmelden op één pagina, en de
andere vier herkennen je automatisch (want alle vijf bewaren het token onder
dezelfde sleutel in `localStorage`). Bovenaan elke pagina staan links naar de
andere modules.

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

## Login instellen — meerdere apotheken mogelijk

Deze module ondersteunt meerdere apotheken op dezelfde site, elk met hun
eigen naam, eigen 4-cijferige code, en volledig **afgescheiden data** (elke
apotheek ziet enkel haar eigen bereidingen). Nieuwe apotheken kunnen enkel
een account aanmaken met een **uitnodigingscode** die jij zelf bepaalt en
persoonlijk doorgeeft.

**Hoe het werkt voor gebruikers:**
- **Inloggen**: naam van de apotheek + code (4 cijfers via het toetsenbord
  op het scherm).
- **Nieuwe apotheek**: naam van de apotheek + code kiezen + de
  uitnodigingscode die jij hebt doorgegeven. Na een geslaagde registratie
  is de apotheek meteen aangemeld.
- Eens aangemeld op een pc/browser, blijft die aangemeld (via
  `localStorage`) tot er expliciet op "uitloggen" geklikt wordt (te vinden
  onder de titel, naast "Aangemeld als: ...").

**Instellen in Netlify (voor echt gebruik):**
1. Ga naar je site in Netlify → **Site configuration → Environment variables**.
2. Voeg twee variabelen toe:
   - `MASTER_UITNODIGINGSCODE` — het geheim dat je persoonlijk doorgeeft aan
     een nieuwe apotheek vóór ze een account aanmaken (bv. `WELKOM2026`).
   - `TOKEN_SECRET` — een lang willekeurig geheim, gegenereerd via bv.
     `openssl rand -hex 32` in een terminal. Dit wordt nooit door een mens
     ingetikt — het beveiligt de sessies van alle apotheken samen.
3. Deploy opnieuw (**Deploys → Trigger deploy**) zodat de nieuwe environment
   variables actief worden.

**Tijdens development:** zolang je `MASTER_UITNODIGINGSCODE` en
`TOKEN_SECRET` niet instelt, werkt alles in een open dev-modus: registratie
vraagt geen uitnodigingscode, en alle "apotheken" delen dezelfde
ontwikkel-store — handig om te testen zonder telkens in te loggen als een
andere apotheek. Zodra je beide variabelen instelt, wordt alles automatisch
correct afgescheiden per apotheek, zonder verdere code-aanpassing.

**Een 2e (of 3e, 4e, ...) apotheek toevoegen:** geef hen gewoon de site-URL
en de `MASTER_UITNODIGINGSCODE`. Zij kiezen zelf hun apotheeknaam en code via
"Nieuwe apotheek" — jij hoeft verder niets in te stellen, hun data wordt
automatisch in een eigen, afgescheiden store bewaard.

Zonder deze twee variabelen correct ingesteld, geeft de login een foutmelding
("Server is niet correct geconfigureerd").

**Lokaal testen (`netlify dev`)**: maak een bestand `.env` aan in deze map
(niet mee committen naar Git!) met:
```
APOTHEEK_WACHTWOORD=jouwwachtwoord
APOTHEEK_TOKEN=eenlangwilekeurigetekenreeks
```

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

- Deze module gebruikt per apotheek een eigen Netlify Blobs-store
  (`magistraal-<apotheekId>`), plus een gedeelde store `apotheek-accounts`
  voor de apotheek-accounts zelf. Dat botst niet met andere modules zolang
  zij hun eigen store-namen gebruiken (bv. `temperatuurlog-<apotheekId>`).
- De functies draaien op `/api/magistraal`, `/api/login` en `/api/register`
  — houd deze padnamen ook zo aan in de uiteindelijke samengevoegde app.
- Als je dit login-systeem later ook voor andere modules wil hergebruiken,
  kan je dezelfde `/api/login` en `/api/register` gebruiken — het token
  bevat het `apotheekId`, dus elke module kan daarmee zijn eigen
  `<modulenaam>-<apotheekId>` store aanmaken.

