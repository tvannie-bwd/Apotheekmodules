// Herclassificatie-regel: producten waarvan de omschrijving "VERP" bevat
// (verpakkingsmateriaal) krijgen voorraadplaats "verpakkingsmaterialen",
// ongeacht hun CNK-nummer of hun oorspronkelijke voorraadplaats in de
// bron-CSV. Alle andere producten behouden gewoon de voorraadplaats zoals
// die in de CSV-export staat.

export const VERPAKKING_LOCATIE = "verpakkingsmaterialen";

function shouldReclassify(record) {
  const o = (record.omschrijving || "").toUpperCase();
  return o.includes("VERP");
}

export function reclassifyRecords(records) {
  let moved = 0;
  const result = records.map((r) => {
    if (shouldReclassify(r) && r.voorraadplaats !== VERPAKKING_LOCATIE) {
      moved++;
      return { ...r, voorraadplaats: VERPAKKING_LOCATIE };
    }
    return r;
  });
  return { records: result, moved };
}
