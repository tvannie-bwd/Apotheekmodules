// Parser voor de "Prijslijst per voorraadplaats"-export.
//
// Opbouw van het bronbestand: het is opgedeeld in blokken per voorraadplaats.
// Elk blok begint met een regel die enkel de locatienaam bevat (bv.
// "VRAC 4.1;;;..."), gevolgd door een kolomkop-regel ("CnkNr;;Omschrijving;...").
// Daarna volgt per product een cyclus van 3 regels:
//   1. prijsregel (bevat o.a. de Stock-waarde op een vaste positie)
//   2. CNK-regel (CNK-nummer + omschrijving)
//   3. lege regel
// Diezelfde locatienaam kan meermaals terugkomen (paginabreuk in de export) -
// dat is geen probleem, de locatie wordt gewoon opnieuw ingesteld.
// Pagina-/rapportkoppen (APB nummer, Datum, Afdruk, apotheeknaam, Bestemming,
// Totaal, ...) worden overgeslagen en veranderen de huidige locatie niet.

const ADMIN_PREFIXES = ["APB nummer", "Prijslijst per voorraadplaats", "Bestemming :", "Totaal :", "CnkNr", "Afgedrukt"];

function isAdminLine(line) {
  if (ADMIN_PREFIXES.some((p) => line.startsWith(p))) return true;
  if (line.includes("Afdruk:")) return true;
  return false;
}

export function parseVoorraadCsv(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const records = [];
  let currentLocation = null;
  let skipNextAsAdmin = false; // regel na "Afdruk:" is de apotheeknaam, ongeacht inhoud

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (skipNextAsAdmin) {
      skipNextAsAdmin = false;
      continue;
    }
    if (line.includes("Afdruk:")) {
      skipNextAsAdmin = true;
      continue;
    }

    // Locatie-header: begint met een letter en is geen bekende rapportregel.
    if (/^[A-Za-z]/.test(line) && !isAdminLine(line)) {
      currentLocation = line.split(";")[0].trim();
      continue;
    }

    // CNK-regel: begint met een nummer (5-8 cijfers) gevolgd door ';'
    if (/^\d{5,8};/.test(line)) {
      const cnkParts = line.split(";");
      const cnk = (cnkParts[0] || "").trim();
      const omschrijving = (cnkParts[2] || "").trim();

      const priceLine = i > 0 ? lines[i - 1] : "";
      const pp = priceLine.split(";");
      const stockRaw = (pp[6] || "").trim();
      const stock = stockRaw !== "" ? stockRaw : "";

      if (cnk) {
        records.push({
          voorraadplaats: currentLocation || "",
          cnk,
          omschrijving,
          stock,
        });
      }
    }
  }

  return records;
}
