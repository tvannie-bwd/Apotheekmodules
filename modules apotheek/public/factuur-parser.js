// Leest facturen van Pharma Chemicals (PDF-tekstitems) in en zet ze om naar
// grondstoflijnen. Werkt in de browser (pdf.js-items) en in Node (voor tests).
// Een "item" is { str, x, y } zoals pdf.js het geeft (x = links, y = onderaan, PDF-coördinaten).
(function (root) {
  const NUM = "\\d{1,3}(?: \\d{3})*\\.\\d{2}|\\d+\\.\\d{2}";
  const RIJ = new RegExp("^(.*?)\\s+(\\d+)\\s+(" + NUM + ")\\s+(\\d+(?:\\.\\d+)?)\\s+(" + NUM + ")\\s+(\\d+)\\s*$");
  const getal = (s) => parseFloat(String(s).replace(/ /g, ""));

  // Groepeer items tot tekstregels (van boven naar onder), items links→rechts.
  function maakRegels(items) {
    const gesorteerd = items
      .filter((i) => i.str && i.str.trim() !== "")
      .map((i) => ({ str: i.str.replace(/ /g, " "), x: i.x, y: i.y }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const regels = [];
    for (const it of gesorteerd) {
      const laatste = regels[regels.length - 1];
      if (laatste && Math.abs(laatste.y - it.y) <= 3) laatste.items.push(it);
      else regels.push({ y: it.y, items: [it] });
    }
    return regels.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join("  ").trim());
  }

  function ddmmjjjjNaarIso(s) {
    const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(s || "");
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  // "ASCORBINEZUUR (VIT.C) 1KG PCH" -> { inhoud: 1000, eenheid: "g" }
  function leesVerpakking(oms) {
    const s = oms.replace(/\bPCH\b/g, "").trim();
    // 5x5L OMDOOS -> 25 L
    const mx = /(\d+)\s?x\s?(\d+(?:[.,]\d+)?)\s?(kg|mg|ml|g|l)\b/i.exec(s);
    if (mx) {
      const e = leesEenheid(parseInt(mx[1], 10) * parseFloat(mx[2].replace(",", ".")), mx[3]);
      if (e) return e;
    }
    // tabletten / capsules / gelulen: aantal stuks
    if (/GELULEN/i.test(s)) {
      const m = /(\d{3,6})\s*(?:caps)?\s*$/i.exec(s);
      if (m) return { inhoud: Number(m[1]), eenheid: "stuks" };
    }
    const mp = /\bper\s+(\d{1,6})\s*$/i.exec(s);
    if (mp) return { inhoud: Number(mp[1]), eenheid: "stuks" };
    const mt = /(\d{2,6})\s*(?:tabs?|caps|capsules)\b/i.exec(s);
    if (mt) return { inhoud: Number(mt[1]), eenheid: "stuks" };
    let laatste = null;
    const re = /(\d+(?:[.,]\d+)?)\s?(kg|mg|ml|g|l)\b/gi;
    let m;
    while ((m = re.exec(s))) laatste = m;
    if (!laatste) return { inhoud: null, eenheid: "" };
    return leesEenheid(parseFloat(laatste[1].replace(",", ".")), laatste[2]);
  }
  function leesEenheid(n, eenheid) {
    const e = eenheid.toLowerCase();
    if (e === "kg") return { inhoud: n * 1000, eenheid: "g" };
    if (e === "l") return { inhoud: n * 1000, eenheid: "ml" };
    if (e === "g") return { inhoud: n, eenheid: "g" };
    if (e === "mg") return { inhoud: n, eenheid: "mg" };
    if (e === "ml") return { inhoud: n, eenheid: "ml" };
    return null;
  }

  function schoneNaam(oms, behoudHoofdletters) {
    let s = oms.replace(/\bPCH\b/g, "").replace(/\bTMF\b/g, "").trim();
    if (!/GELULEN/i.test(s)) {
      s = s.replace(/\s\d+\s?x\s?\d+(?:[.,]\d+)?\s?(kg|mg|ml|g|l)\b.*$/i, "")
           .replace(/\s\d+(?:[.,]\d+)?\s?(kg|mg|ml|g|l)\b\s*$/i, "").trim();
    }
    // supplementen: "... tabs bulk per 600" en "... 800 tab" horen niet in de naam
    s = s.replace(/\s+(?:tabs?|caps)?\s*bulk per \d+\s*$/i, "").replace(/\s+\d+\s*tabs?\s*$/i, "").trim();
    if (behoudHoofdletters) return s;
    s = s.toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  const HULPSTOF = /GELULEN|OMDOOS|CREME|GEL\b|CARBOMEERGEL|BEELERBASIS|VASELINE|PARAFFINE|GLYCEROL|WATER|ROZENWATER|SIROOP|ETHANOL|ISOPROPYL|WOLVET|LANOLINE|CETYLALCOHOL|CITROENZUUR|NATRIUMBENZOAAT|NATRIUMCHLORIDE|NATRIUMBICARBONAAT|MANNITOL/;
  function gokType(oms) {
    return HULPSTOF.test(oms.toUpperCase()) ? "hulpstof" : "actief";
  }

  // pages: array van arrays van items. Geeft { ok, fout, leverancier, factuur, datum, lijnen, totaalFactuur, som, klopt }
  function parseFactuur(pages) {
    const regels = [];
    for (const items of pages) regels.push(...maakRegels(items));
    const tekst = regels.join("\n");
    if (/kredietnota|creditnota/i.test(tekst)) {
      return { ok: false, fout: "Dit lijkt een kredietnota; die wordt niet ingelezen." };
    }
    if (/Magis-Pharma/i.test(tekst) && /Factuur\s+INV\//i.test(tekst)) return parseMagis(regels, tekst);
    if (/PHARMA CHEMICALS/i.test(tekst)) return parsePharmaChemicals(regels, tekst);
    return { ok: false, fout: "Onbekend factuurformaat (herkend: Pharma Chemicals en Magis-Pharma)." };
  }

  // ---- Magis-Pharma ----
  const nl = (s) => parseFloat(String(s).replace(/[. ]/g, "").replace(",", "."));
  const MAGIS = /^\[([^\]]+)\]\s+(.+?)\s+(\d[\d.]*,\d+)\s+Stuks\s+(\d[\d.]*,\d+)\s+(\d+,\d{2})\s+(?:(.*?)\s+)?(\d[\d. ]*,\d{2})\s*€\s*$/;
  function parseMagis(regels, tekst) {
    const nr = /Factuur\s+(INV\/\d{4}\/\d+)/i.exec(tekst);
    if (!nr) return { ok: false, fout: "Factuurnummer niet gevonden." };
    const dm = /(?:^|\n)\s*(\d\d)-(\d\d)-(\d{4})\s+\d\d-\d\d-\d{4}/.exec(tekst);
    if (!dm) return { ok: false, fout: "Factuurdatum niet gevonden." };
    const datum = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const lijnen = [];
    for (const regel of regels) {
      const m = MAGIS.exec(regel);
      if (!m) continue;
      const aantal = nl(m[3]), prijs = nl(m[4]), korting = nl(m[5]), totaal = nl(m[7]);
      const btwM = /(\d+)%\s*$/.exec(m[6] || "");
      const oms = m[2].replace(/\s+/g, " ").trim();
      const l = {
        cnk: m[1], omschrijving: oms, lot: "", aantal, prijs, korting, totaal, btw: btwM ? parseInt(btwM[1], 10) : 21,
      };
      const v = leesVerpakking(oms);
      l.verpakkingsinhoud = v.inhoud;
      l.eenheid = v.eenheid;
      l.naam = schoneNaam(oms, true);
      // geschenken (100% korting) en lijnen zonder bedrag worden overgeslagen; 6%-producten zijn geen grondstoffen
      l.gratis = korting >= 100 || totaal === 0;
      l.type = l.btw === 6 ? "supplement" : HULPSTOF.test(oms.toUpperCase()) ? "hulpstof" : "actief";
      lijnen.push(l);
    }
    const bruikbaar = lijnen.filter((l) => !l.gratis);
    const tm = /Excl\. btw\s+(\d[\d. ]*,\d{2})\s*€/.exec(tekst);
    const totaalFactuur = tm ? nl(tm[1]) : null;
    const som = Math.round(lijnen.reduce((a, l) => a + l.totaal, 0) * 100) / 100;
    const klopt = totaalFactuur !== null && Math.abs(som - totaalFactuur) < 0.011;
    const rekenFout = bruikbaar.some((l) => Math.abs(l.aantal * l.prijs * (1 - l.korting / 100) - l.totaal) > 0.03 * Math.max(1, l.aantal));
    if (bruikbaar.length === 0) return { ok: false, fout: "Geen productlijnen gevonden." };
    return {
      ok: true, leverancier: "Magis-Pharma", factuur: nr[1].replace(/\//g, "-"), datum,
      lijnen: bruikbaar, totaalFactuur, som, klopt: klopt && !rekenFout,
    };
  }

  function parsePharmaChemicals(regels, tekst) {
    const nr = /Factuur nr\s+(\d+)/i.exec(tekst);
    if (!nr) return { ok: false, fout: "Factuurnummer niet gevonden." };
    const dm = /(?:^|\n)\s*\d+\s+(\d\d\/\d\d\/\d{4})\s+\d\d\/\d\d\/\d{4}/.exec(tekst);
    const datum = dm ? ddmmjjjjNaarIso(dm[1]) : null;
    if (!datum) return { ok: false, fout: "Factuurdatum niet gevonden." };

    const lijnen = [];
    let vorigeIsLijn = false;
    for (const regel of regels) {
      const m = RIJ.exec(regel);
      if (m) {
        const voor = m[1];
        const pm = /^(?:(\S{1,3})\s+)?(\d{7})\s+(.+)$/.exec(voor);
        if (pm) {
          let rest = pm[3].replace(/\s+/g, " ").trim();
          let aantal = parseInt(m[2], 10);
          const prijs0 = getal(m[3]), korting0 = getal(m[4]), totaal0 = getal(m[5]);
          const klopt = (q) => Math.abs(q * prijs0 * (1 - korting0 / 100) - totaal0) <= 0.03 * Math.max(1, q);
          // Een tweecijferige hoeveelheid kan door pdf.js in twee stukken komen ("1" + "0"):
          // klopt de rekensom niet, plak dan het laatste cijfer van de lotkolom erbij.
          if (!klopt(aantal)) {
            const mm = /^(.*\s)(\d)$/.exec(rest);
            if (mm && klopt(parseInt(mm[2] + String(m[2]), 10))) {
              aantal = parseInt(mm[2] + String(m[2]), 10);
              rest = mm[1].trim();
            }
          }
          const tokens = rest.split(/\s+/);
          let lot = "";
          let oms = rest;
          const lastTok = tokens[tokens.length - 1];
          if (tokens.length >= 2 && /\d/.test(lastTok) && !/^\d+(KG|G|MG|ML|L)$/i.test(lastTok) && lastTok !== "PCH") {
            lot = lastTok;
            oms = tokens.slice(0, -1).join(" ");
          }
          const prijs = getal(m[3]);
          const korting = getal(m[4]);
          lijnen.push({
            cnk: pm[2], omschrijving: oms, lot, aantal,
            prijs, korting, totaal: getal(m[5]), btw: parseInt(m[6], 10),
          });
          vorigeIsLijn = true;
          continue;
        }
      }
      // doorlopende omschrijving ("6   PCH") op de regel eronder
      if (vorigeIsLijn) {
        const cont = regel.replace(/^\d{1,3}\s+/, "").trim();
        if (/^[A-Z]{2,5}$/.test(cont)) {
          lijnen[lijnen.length - 1].omschrijving += " " + cont;
        }
      }
      vorigeIsLijn = false;
    }

    for (const l of lijnen) {
      const v = leesVerpakking(l.omschrijving);
      l.verpakkingsinhoud = v.inhoud;
      l.eenheid = v.eenheid;
      l.naam = schoneNaam(l.omschrijving);
      l.type = gokType(l.omschrijving);
    }

    const tm = /Totaal BTWE\s+(\d{1,3}(?: \d{3})*\.\d{2}|\d+\.\d{2})/.exec(tekst.replace(/\n/g, "  "));
    const totaalFactuur = tm ? getal(tm[1]) : null;
    const som = Math.round(lijnen.reduce((a, l) => a + l.totaal, 0) * 100) / 100;
    const klopt = totaalFactuur !== null && Math.abs(som - totaalFactuur) < 0.011;
    if (lijnen.length === 0) return { ok: false, fout: "Geen productlijnen gevonden." };
    return { ok: true, leverancier: "Pharma Chemicals", factuur: nr[1], datum, lijnen, totaalFactuur, som, klopt };
  }

  const api = { parseFactuur, parseMagis, leesVerpakking, schoneNaam, gokType, maakRegels };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FactuurParser = api;
})(typeof window !== "undefined" ? window : globalThis);
