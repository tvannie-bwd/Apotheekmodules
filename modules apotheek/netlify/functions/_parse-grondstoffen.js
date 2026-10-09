// Parser voor de "Grondstoffen - controle en analyseregister" CSV-export.
// Elke record staat verspreid over meerdere regels: data-regel, blanco,
// tweede data-regel, blanco, Conform-blok.

function toIso(d) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((d || "").trim());
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function toks(line) {
  return (line || "")
    .split(";")
    .map((t) => t.trim().replace(/^"+|"+$/g, ""))
    .filter((t) => t !== "");
}

export function parseGrondstoffenCsv(text) {
  const lines = text.split(/\r\n|\r|\n/);

  const data1Idx = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+;/.test(lines[i])) data1Idx.push(i);
  }

  const records = [];
  for (const d of data1Idx) {
    const t1 = toks(lines[d]);
    const t2 = toks(lines[d + 2]);
    const t3 = toks(lines[d + 5]);

    const analyseNr = t1[0] || "";
    const vervaldatumRaw = t1[1] || "";
    let rest = t1.slice(2);

    let omschrijving = "";
    let labo = "";
    if (rest.length && rest[0].toUpperCase().includes("NUL")) {
      rest = rest.slice(1);
    } else {
      omschrijving = rest[0] || "";
      labo = rest[1] || "";
      rest = rest.slice(2);
    }
    const lotnummer = rest[0] || "";
    const analyseRef = rest[1] || "";

    const datumRaw = t2[0] || "";
    let rem2 = t2.slice(1);
    let flag = "";
    if (rem2.length && (rem2[rem2.length - 1] === "Y" || rem2[rem2.length - 1] === "N")) {
      flag = rem2[rem2.length - 1];
      rem2 = rem2.slice(0, -1);
    }
    const certVerslag = rem2.join(" / ");

    const conform = t3[0] || "";

    if (!analyseNr) continue;

    records.push({
      analyseNr,
      vervaldatum: toIso(vervaldatumRaw),
      omschrijving,
      labo,
      lotnummer,
      analyseRef,
      datum: toIso(datumRaw),
      certVerslag,
      flag,
      conform,
    });
  }
  return records;
}
