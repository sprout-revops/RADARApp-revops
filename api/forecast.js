// Live forecast feed for the Sales Dashboard MO. FORECAST column.
// Reads the published Google Sheet (Sales Rep | Month | Forecast Value) and returns
// { "<year>_<canonicalRep>_<month>": value, _saved_at }. The sheet is the source of truth;
// served here so the dashboard never depends on the (private) sales-dashboard repo.
const SHEET_BASE = ('https://docs.google.com/spreadsheets/d/e/'
  + '2PACX-1vQ8mhtR0d1Nw7kohUBatjQQHorI5DVT58v0pgkrfzDz8Y9CDdbO4y4JE13kzEc1416Q9Ch2eKGR3fqt/pub?output=csv');
// Both tabs share the same layout (Sales Rep | Month | Forecast Value). New Business is the
// default tab; Upsell is gid=1005447696. Rep sets are disjoint, so merging never collides.
const SHEET_TABS = [SHEET_BASE, SHEET_BASE + '&gid=1005447696'];

const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7,
  august:8, september:9, october:10, november:11, december:12 };

const CANON = ['Katryn Saldajeno','Miriam Pulido','Lana Pineda','Crystel Ambrocio','Ferdie Salvosa',
  'Reine Suarez','Rona Pablo','Jethro Jamelo','Gel Riboroso','Nicco Tioseco','Osheri Fima',
  'Riezhel Punzalan','Rizzalyn Berce','Akisha Abella','Brian Azarcon','Rachelle Serneo',
  'Mat Galuego','Ric Rigodon','Chress Espineda','Kurt Ang','Javier Lopez'];
const ALIAS = {
  'katryn angela saldajeno':'Katryn Saldajeno','crystel jane insigne-ambrocio':'Crystel Ambrocio',
  'crystel jane insigne ambrocio':'Crystel Ambrocio','crystel ambrosio':'Crystel Ambrocio',
  'jose fernando salvosa':'Ferdie Salvosa','rona mae pablo':'Rona Pablo',
  'jethro jesse james jamelo':'Jethro Jamelo','angeline riboroso':'Gel Riboroso',
  'niccolo tioseco':'Nicco Tioseco','rizzalyn morada - berce':'Rizzalyn Berce',
  'rizzalyn morada berce':'Rizzalyn Berce','rizzalyn morada':'Rizzalyn Berce',
  'brian dominic azarcon':'Brian Azarcon','ricardo rigodon':'Ric Rigodon',
  'akisha a':'Akisha Abella','marie christine espineda':'Chress Espineda',
  'ric rogodon':'Ric Rigodon',
};
function canon(s) {
  if (!s) return null;
  const k = String(s).trim().toLowerCase().replace(/\s*-\s*/g, ' ');
  if (ALIAS[k]) return ALIAS[k];
  for (const full of CANON) {
    if (full.toLowerCase() === k) return full;
    const p = k.split(/\s+/), fp = full.toLowerCase().split(/\s+/);
    if (p.length >= 2 && p[0] === fp[0] && p[1] === fp[1]) return full;
  }
  return null;
}

// Minimal CSV line splitter that respects double-quoted fields (which may contain commas).
function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseMonth(s) {
  s = String(s || '').trim();
  let m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);          // "January 2026"
  if (m) return { mon: MONTHS[m[1].toLowerCase()], year: +m[2] };
  m = s.match(/^(\d{4})-(\d{2})/);                       // "2026-01-01"
  if (m) return { mon: +m[2], year: +m[1] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);         // "1/1/2026"
  if (m) return { mon: +m[1], year: +m[3] };
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const out = {};
    for (const url of SHEET_TABS) {
      const r = await fetch(url);   // global fetch follows the 307 redirect
      if (!r.ok) return res.status(502).json({ error: 'Sheet fetch failed: ' + r.status });
      const text = await r.text();
      const lines = text.split(/\r?\n/).filter(l => l.length);
      for (let i = 1; i < lines.length; i++) {          // skip header
        const cells = splitCsvLine(lines[i]);
        const rep = canon(cells[0]);
        const mm = parseMonth(cells[1]);
        const val = parseFloat(String(cells[2] || '').replace(/[^0-9.\-]/g, ''));
        if (!rep || !mm || !mm.mon || isNaN(val)) continue;
        out[`${mm.year}_${rep}_${mm.mon}`] = val;
      }
    }
    out._saved_at = Date.now();
    out._source = 'gsheet-live';
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
