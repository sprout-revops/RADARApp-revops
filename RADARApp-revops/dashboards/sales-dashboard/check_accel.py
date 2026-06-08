import json, re
from datetime import datetime

DATA_FILE = 'data/dashboard.json'
OUT_FILE  = 'accel_snapshot.json'

with open(DATA_FILE, encoding='utf-8') as f:
    data = json.load(f)

deals = data['deals']
today = datetime.utcnow()
CUR_YEAR = today.year
CUR_MON  = today.month

# Matches JS: only exclude TH Sales Pipeline
EXCLUDED_PIPELINES = ['TH Sales Pipeline']

REP_ALIASES = {
    'katryn angela saldajeno':       'Katryn Saldajeno',
    'crystel jane insigne-ambrocio': 'Crystel Ambrocio',
    'crystel jane insigne ambrocio': 'Crystel Ambrocio',
    'jose fernando salvosa':         'Ferdie Salvosa',
    'rona mae pablo':                'Rona Pablo',
    'jethro jesse james jamelo':     'Jethro Jamelo',
    'angeline riboroso':             'Gel Riboroso',
    'niccolo tioseco':               'Nicco Tioseco',
    'rizzalyn morada - berce':       'Rizzalyn Berce',
    'rizzalyn morada berce':         'Rizzalyn Berce',
    'brian dominic azarcon':         'Brian Azarcon',
    'ricardo rigodon':               'Ric Rigodon',
    'marie christine espineda':      'Chress Espineda',
}

REP_TEAMS = [
    'Katryn Saldajeno', 'Miriam Pulido', 'Lana Pineda', 'Crystel Ambrocio',
    'Ferdie Salvosa', 'Reine Suarez', 'Rona Pablo', 'Jethro Jamelo',
    'Gel Riboroso', 'Nicco Tioseco',
    'Osheri Fima', 'Riezhel Punzalan', 'Rizzalyn Berce', 'Akisha Abella', 'Brian Azarcon',
    'Mat Galuego', 'Ric Rigodon', 'Chress Espineda', 'Kurt Ang', 'Javier Lopez',
]

# Per-rep monthly MRR quota — sourced from "Targets Per Rep" sheet in Upsell Overall Targets.xlsx
REP_MONTHLY_TARGET = {
    'Katryn Saldajeno':  {1:80000,2:80000,3:100000,4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:110000,11:110000,12:100000},
    'Miriam Pulido':     {1:80000,2:80000,3:100000,4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:110000,11:110000,12:100000},
    'Lana Pineda':       {1:80000,2:80000,3:100000,4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:110000,11:110000,12:100000},
    'Crystel Ambrocio':  {1:80000,2:80000,3:100000,4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:110000,11:110000,12:100000},
    'Ferdie Salvosa':    {1:60000,2:60000,3:60000, 4:100000,5:100000,6:100000,7:100000,8:100000,9:100000,10:75000, 11:75000, 12:75000},
    'Reine Suarez':      {1:60000,2:60000,3:60000, 4:100000,5:100000,6:100000,7:100000,8:100000,9:100000,10:75000, 11:75000, 12:75000},
    'Rona Pablo':        {1:60000,2:60000,3:60000, 4:100000,5:100000,6:100000,7:100000,8:100000,9:100000,10:75000, 11:75000, 12:75000},
    'Jethro Jamelo':     {1:60000,2:60000,3:80000, 4:110000,5:110000,6:110000,7:110000,8:110000,9:110000,10:90000, 11:75000, 12:75000},
    'Gel Riboroso':      {1:60000,2:60000,3:60000, 4:100000,5:100000,6:100000,7:100000,8:100000,9:100000,10:75000, 11:75000, 12:75000},
    'Nicco Tioseco':     {1:60000,2:60000,3:60000, 4:100000,5:100000,6:100000,7:100000,8:100000,9:100000,10:75000, 11:75000, 12:75000},
    'Osheri Fima':       {1:80000,2:80000,3:100000,4:130000,5:130000,6:130000,7:130000,8:130000,9:130000,10:120000,11:120000,12:100000},
    'Riezhel Punzalan':  {1:60000,2:60000,3:80000, 4:110000,5:110000,6:110000,7:110000,8:110000,9:110000,10:90000, 11:75000, 12:75000},
    'Rizzalyn Berce':    {1:60000,2:60000,3:80000, 4:110000,5:110000,6:110000,7:110000,8:110000,9:110000,10:90000, 11:75000, 12:75000},
    'Akisha Abella':     {1:60000,2:60000,3:60000, 4:100000,5:100000,6:100000,7:100000,8:100000,9:100000,10:75000, 11:75000, 12:75000},
    'Brian Azarcon':     {1:60000,2:60000,3:80000, 4:110000,5:110000,6:110000,7:110000,8:110000,9:110000,10:90000, 11:75000, 12:75000},
    'Mat Galuego':       {1:60000,2:60000,3:80000, 4:110000,5:110000,6:110000,7:110000,8:110000,9:110000,10:90000, 11:75000, 12:75000},
    'Ric Rigodon':       {1:80000,2:80000,3:80000, 4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:100000,11:100000,12:100000},
    'Chress Espineda':   {1:80000,2:80000,3:80000, 4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:100000,11:100000,12:100000},
    'Kurt Ang':          {1:70000,2:70000,3:70000, 4:110000,5:110000,6:110000,7:110000,8:110000,9:110000,10:90000, 11:90000, 12:90000},
    'Javier Lopez':      {1:80000,2:80000,3:80000, 4:120000,5:120000,6:120000,7:120000,8:120000,9:120000,10:100000,11:100000,12:100000},
}

def rep_month_target(rep, mon):
    t = REP_MONTHLY_TARGET.get(rep, {})
    return t.get(mon, 0) if isinstance(t, dict) else 0

# Build fast lookup table (matches JS getRepCanonical logic)
_norm = {}
for k in REP_TEAMS:
    _norm[k.strip().lower()] = k
    parts = k.strip().lower().split()
    if len(parts) >= 2:
        _norm[parts[0] + ' ' + parts[1]] = k

def get_canonical(name):
    if not name:
        return None
    norm = re.sub(r'\s*-\s*', ' ', name.strip().lower())
    if norm in REP_ALIASES:
        return REP_ALIASES[norm]
    if norm in _norm:
        return _norm[norm]
    parts = norm.split()
    if len(parts) >= 2:
        k2 = parts[0] + ' ' + parts[1]
        if k2 in _norm:
            return _norm[k2]
    return None

mon_names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
snapshot = {}
hits = 0
misses = 0

print(f"Accelerator snapshot — {CUR_YEAR} Jan–{mon_names[CUR_MON]}")
print(f"{'Rep':<22} {'Target':>8}  " + "  ".join(f"{mon_names[m]:>5}" for m in range(1, CUR_MON + 1)))
print("-" * (32 + 8 * CUR_MON))

for rep in REP_TEAMS:
    cells = []
    for mon in range(1, CUR_MON + 1):
        target = rep_month_target(rep, mon)
        mon_mrr = sum(
            float(d.get('mrr') or 0)
            for d in deals
            if (d.get('client_journey_stage') == 'Customer'
                and d.get('pipeline_name') not in EXCLUDED_PIPELINES
                and get_canonical(d.get('sales_rep')) == rep
                and (d.get('close_date') or '').startswith(f'{CUR_YEAR}-{mon:02d}'))
        )
        val = 'hit' if mon_mrr >= target else 'miss'
        snapshot[f'{CUR_YEAR}_{rep}_{mon}'] = val
        cells.append('HIT ' if val == 'hit' else 'MISS')
        if val == 'hit': hits += 1
        else: misses += 1
    print(f"  {rep:<20} " + "  ".join(f"{c:>5}" for c in cells))

with open(OUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(snapshot, f, indent=2)

print(f"\nWritten {len(snapshot)} entries → {OUT_FILE}  ({hits} HIT / {misses} MISS)")
