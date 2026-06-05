# RADAR — RevOps Analytics, Data & Reporting

RADAR is the RevOps dashboard and documentation portal for Sprout Solutions. It helps users understand where RevOps data lives, how to connect to Databricks, what tables to use, and which approved DataPedia definitions should be followed when creating dashboards.

---

## Data Source

Databricks Unity Catalog:

```sql
USE CATALOG shared;
USE SCHEMA revops;
```

Primary tables:

| Table | Description |
|---|---|
| `shared.revops.gold_monthly_exec_summary` | Summary-level dashboard metrics |
| `shared.revops.gold_targets` | Targets and quota comparison |
| `shared.revops.gold_metrics_datapedia` | Metric dictionary / approved metric details |
| `shared.revops.datapedia_approved` | Approved metric definitions |
| `shared.revops.silver_deals` | Deal-level drilldowns |
| `shared.revops.silver_line_items` | Product and MRR breakdowns |
| `shared.revops.silver_company` | Company attributes |

### Recommended Table Usage

Use Gold tables for executive dashboard summaries. Use Silver tables only when drilldown, product-level analysis, or company-level attributes are required.

| Need | Recommended Table |
|---|---|
| Monthly KPI dashboard | `gold_monthly_exec_summary` |
| Target vs actual | `gold_targets` |
| Deal-level analysis | `silver_deals` |
| Product / MRR breakdown | `silver_line_items` |
| Company segment, industry, account attributes | `silver_company` |
| Metric definitions | `datapedia_approved` or `gold_metrics_datapedia` |

---

## Dashboard Scope

**Excluded for now:**
- TOFIL / Leads Pipeline
- TOFIL to MQL conversion

**Included metrics:**

| Metric | Date Basis | Definition |
|---|---|---|
| Marketing Qualified Leads TMRR | `projected_close_date` | Deals in Appointment Scheduled and Opportunity stages |
| Sales Qualified Leads TMRR | `projected_close_date` | Deals in Opportunity stage only |
| Won MRR | `close_date` | Closed-Won / Customer deals |
| EmFi MRR | `close_date` | Sum of `ef_mrr` |
| Closed-Won Revenue | `close_date` | Closed-Won / Customer deals |
| Average Deal Value | `close_date` | Won revenue or MRR divided by won deal count |
| Created Leads / MQL by Channel Source | `create_date` | Uses Original Traffic Source; if Offline Sources, use Original Source of Awareness |
| MQL to SQL Conversion | `create_date` | SQL count divided by MQL count |
| SQL to Won Conversion | `create_date` | Won count divided by SQL count |
| Deal Velocity | `create_date` | Average days from create to close for won deals |

**Recommended filters:**
- Date range
- Pipeline name
- Segment
- Department source clean
- Channel source
- Sales rep
- HubSpot team
- Deal type
- Stage label
- Client journey stage

---

## How to Connect to Databricks

1. Open Databricks
2. Go to **SQL Warehouses**
3. Select the assigned RevOps SQL Warehouse
4. Copy the **Server Hostname** and **HTTP Path**
5. Generate a Personal Access Token (PAT) — Databricks → top-right profile icon → Settings → Developer → Access Tokens
6. In your BI tool, choose the Databricks connector
7. Select catalog `shared` and schema `revops`
8. Start with `gold_monthly_exec_summary` for standard dashboarding
9. Use silver tables only for drilldowns

---

## How to Create a Dashboard (Step-by-Step)

> This is the process used to build the **Channels Dashboard** — a live, filterable analytics dashboard hosted on GitHub Pages with no servers or BI licensing. Follow these steps to build your own department dashboard.

### Architecture

```
Databricks SQL
      │
      │  fetch_data.py  (runs on schedule — local or GitHub Actions)
      ▼
data/dashboard.json     ← static file committed to GitHub
      │
      │  browser reads via fetch()
      ▼
dashboard.html          ← single-file app on GitHub Pages
      │
      │  JavaScript computes all KPIs, charts, tables
      ▼
User's browser          ← date + segment filters re-compute instantly
```

**Why this approach?**
- No CORS issues — browser never calls Databricks directly
- No backend to maintain — GitHub Pages is free
- Full date and segment filtering without re-querying Databricks
- One HTML file — easy to version, share, and update

---

### What You Need

| Requirement | How to get it |
|---|---|
| Python 3.8+ | python.org — add to PATH during install |
| Git | git-scm.com |
| GitHub account | github.com (free) |
| Databricks HTTP Path + PAT | See "How to Connect to Databricks" above |
| `requests` Python library | `pip install requests` |

---

### Step 1 — Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it e.g. `channels-dashboard` (lowercase, hyphens)
3. Set to **Private** (recommended for internal data)
4. Check **Add a README file**
5. Click **Create repository**

---

### Step 2 — Clone to Your Computer

```powershell
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME
```

---

### Step 3 — Set Up Folder Structure

```powershell
mkdir data
mkdir .github\workflows
```

Your folder should look like:

```
your-dashboard/
├── dashboard.html              ← entire dashboard UI + JS (one file)
├── fetch_data.py               ← queries Databricks, writes JSON
├── .env                        ← credentials (NEVER commit this)
├── .gitignore
├── refresh_and_push.bat        ← local auto-refresh script
├── data/
│   └── dashboard.json          ← auto-generated data file
└── .github/
    └── workflows/
        └── refresh.yml         ← GitHub Actions scheduled refresh
```

---

### Step 4 — Create `.gitignore`

```
.env
node_modules/
__pycache__/
*.pyc
```

---

### Step 5 — Create `.env` (Credentials)

Create a plain text file named `.env` in the project root:

```
DATABRICKS_HOST=adb-XXXXXXXXXXXXXXXX.XX.azuredatabricks.net
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/XXXXXXXXXXXXXXXXX
DATABRICKS_TOKEN=dapi...your-personal-access-token...
```

> Never commit `.env`. It is listed in `.gitignore`.

---

### Step 6 — Write `fetch_data.py`

This script queries Databricks and saves raw deal records to `data/dashboard.json`.

**Key principle:** fetch **raw rows, not aggregates** — this lets the browser filter by any date range or segment without re-querying Databricks.

```python
"""
[Team Name] Dashboard — Databricks Data Fetcher
Fetches raw deal records. Dashboard computes all KPIs client-side.
"""
import os, json, time, requests
from datetime import date

# Load .env (encoding='utf-8-sig' handles BOM added by PowerShell)
_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(_env):
    with open(_env, encoding='utf-8-sig') as _f:
        for line in _f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

HOST         = os.environ['DATABRICKS_HOST'].strip().lstrip('https://')
HTTP_PATH    = os.environ['DATABRICKS_HTTP_PATH'].strip()
TOKEN        = os.environ['DATABRICKS_TOKEN'].strip()
WAREHOUSE_ID = HTTP_PATH.split('/')[-1]

HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}
API_URL = f'https://{HOST}/api/2.0/sql/statements'
TODAY   = date.today()

print(f"Fetching data (last 3 years to {TODAY})...")


def db_query(label, sql):
    print(f"  Running: {label}...", end=' ', flush=True)
    r = requests.post(API_URL, headers=HEADERS, json={
        'warehouse_id':    WAREHOUSE_ID,
        'statement':       sql,
        'wait_timeout':    '50s',   # must be 5s–50s
        'on_wait_timeout': 'CONTINUE',
        'format':          'JSON_ARRAY'
    }, timeout=180)
    if not r.ok:
        raise Exception(f"HTTP {r.status_code}: {r.text[:500]}")
    body = r.json()
    polls = 0
    while body.get('status', {}).get('state') in ['PENDING', 'RUNNING']:
        time.sleep(3); polls += 1
        body = requests.get(f"{API_URL}/{body['statement_id']}", headers=HEADERS, timeout=30).json()
    if body.get('status', {}).get('state') == 'FAILED':
        raise Exception(body.get('status', {}).get('error', {}).get('message', 'Unknown error'))
    cols = [c['name'] for c in body.get('manifest', {}).get('schema', {}).get('columns', [])]
    rows = [dict(zip(cols, row)) for row in body.get('result', {}).get('data_array', [])]
    print(f"{len(rows)} rows ({polls} polls)")
    return rows


# Edit this query to match your pipeline and columns
RAW_SQL = """
SELECT
  deal_id,
  deal_name,
  deal_type,
  create_date,
  close_date,
  projected_close_date,
  client_journey_stage,
  stage_label,
  qualified_lead,
  mrr,
  ef_mrr,
  otp_only,
  implem_fee,
  mrr_lt_12,
  deal_velocity_days,
  sales_rep,
  partner_on_record,
  CASE WHEN department_source_clean = 'MICRO' THEN 'SME'
       ELSE department_source_clean END AS segment,
  original_channel_source
FROM shared.revops.silver_deals
WHERE pipeline_name = 'YOUR PIPELINE NAME'
  AND deal_type NOT IN ('Renewal', 'renewal', 'Upsell - Renewal')
  AND LOWER(deal_name) NOT LIKE '%renewal%'
  AND (
    create_date             >= ADD_MONTHS(CURRENT_DATE, -36)
    OR close_date           >= ADD_MONTHS(CURRENT_DATE, -36)
    OR projected_close_date >= ADD_MONTHS(CURRENT_DATE, -36)
  )
ORDER BY create_date DESC
"""

records = db_query('All Records', RAW_SQL)

os.makedirs('data', exist_ok=True)
with open('data/dashboard.json', 'w') as f:
    json.dump({
        'refreshed_at': TODAY.isoformat() + 'T' + time.strftime('%H:%M:%S') + 'Z',
        'pipeline':     'YOUR PIPELINE NAME',
        'deals':        records,
    }, f)

size_kb = os.path.getsize('data/dashboard.json') // 1024
print(f"Done! Saved {len(records)} records to data/dashboard.json ({size_kb} KB)")
```

**Test it:**
```powershell
pip install requests
python fetch_data.py
```

Expected output:
```
Fetching data (last 3 years to 2026-05-11)...
  Running: All Records... 619 rows (0 polls)
Done! Saved 619 records to data/dashboard.json (358 KB)
```

---

### Step 7 — Build `dashboard.html`

The entire dashboard is one HTML file. It reads `data/dashboard.json` and computes everything in JavaScript — no backend, no build step.

**Sections to customise for your team:**

| Section | What to change |
|---|---|
| `<title>` | Your team / dashboard name |
| `PIPELINE_DEFAULT` JS constant | Your pipeline name |
| KPI card HTML blocks | Your metric names and icons |
| `computeFromDeals()` JS function | Your KPI formulas and business rules |
| Table `<thead>` columns | Your column names |
| `renderWon()` etc. | Map JSON fields to table cells |
| `SAMPLE` data object | Realistic dummy values shown before first fetch |

**Business rule for date columns** (same as DataPedia):

| Metric type | Date column |
|---|---|
| QL / SQL / Funnel counts | `create_date` |
| Won / Lost / Revenue | `close_date` |
| Pipeline MRR | `projected_close_date` |

> **Tip:** Copy the Channels Dashboard `dashboard.html` as your starting template. The framework (dark theme, KPI cards, charts, tabs, sort/search, CSV export, status badge, loading overlay) can be reused as-is — only customise the metric names and formulas.

**How client-side KPI computation works:**

```javascript
// JS fetches the raw deals array once on load
const json = await fetch('./data/dashboard.json');
S.allDeals = json.deals;   // store all 619 rows

// When user changes date filter and clicks Apply:
function applyClientFilters() {
  readFilters();                                          // read f-start, f-end, f-segment
  applyComputed(computeFromDeals(S.allDeals, S.filters)); // recompute everything instantly
}

// computeFromDeals() separates deals by date column:
const byCreate = deals.filter(d => inRange(d.create_date, start, end));   // QL, SQL
const byClose  = deals.filter(d => inRange(d.close_date,  start, end));   // Won, Revenue
const byProj   = deals.filter(d => inRange(d.projected_close_date, ...)); // Pipeline

// Then computes KPIs, trends, tables — all in the browser
```

---

### Step 8 — Commit and Push Your First Version

```powershell
git add dashboard.html fetch_data.py .gitignore data/dashboard.json README.md
git commit -m "Initial dashboard — first data fetch"
git push origin master
```

> Commit `data/dashboard.json` — GitHub Pages needs it in the repo to serve it.
> Never commit `.env`.

---

### Step 9 — Enable GitHub Pages (Free Hosting)

1. GitHub repo → **Settings** tab
2. Left sidebar → **Pages**
3. Source: **Deploy from a branch**
4. Branch: `master` · Folder: `/ (root)`
5. Click **Save**

After ~2 minutes your dashboard is live at:
```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

---

### Step 10 — Set Up Scheduled Auto-Refresh

Data needs to be refreshed so the dashboard stays current. Use **both options** — they back each other up.

#### Option A — Windows Task Scheduler (local, primary)

Create `refresh_and_push.bat`:

```bat
@echo off
cd /d "C:\path\to\your-dashboard"
echo [%date% %time%] Starting refresh... >> refresh_log.txt
python fetch_data.py >> refresh_log.txt 2>&1
if errorlevel 1 (
    echo [%date% %time%] FAILED >> refresh_log.txt
    exit /b 1
)
git add data/dashboard.json
git commit -m "Auto-refresh %date% %time%"
git push origin master
echo [%date% %time%] Done. >> refresh_log.txt
```

Schedule it in **Task Scheduler**:
1. Open Task Scheduler → **Create Task**
2. **General:** Name it; check *Run whether user is logged on or not*; check *Run with highest privileges*
3. **Triggers:** Daily, repeat every 8 hours — or set 3 specific times (e.g. 8:30 AM, 1:30 PM, 5:15 PM)
4. **Actions:** Start a program → point to `refresh_and_push.bat`
5. Click OK → enter Windows password

#### Option B — GitHub Actions (cloud, backup)

Create `.github/workflows/refresh.yml`:

```yaml
name: Refresh Dashboard Data

on:
  schedule:
    # PHT = UTC+8. These run at 8:30 AM, 1:30 PM, 5:15 PM PHT
    - cron: '30 0 * * *'
    - cron: '30 5 * * *'
    - cron: '15 9 * * *'
  workflow_dispatch:   # manual trigger from GitHub UI

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install requests

      - name: Fetch data from Databricks
        env:
          DATABRICKS_HOST:      ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_HTTP_PATH: ${{ secrets.DATABRICKS_HTTP_PATH }}
          DATABRICKS_TOKEN:     ${{ secrets.DATABRICKS_TOKEN }}
        run: python fetch_data.py

      - name: Commit and push
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/dashboard.json
          git diff --staged --quiet || git commit -m "Auto-refresh $(date -u '+%Y-%m-%d %H:%M UTC')"
          git push
```

Add GitHub Secrets (repo → **Settings → Secrets and variables → Actions**):

| Secret name | Value |
|---|---|
| `DATABRICKS_HOST` | `adb-XXXXXXXX.XX.azuredatabricks.net` |
| `DATABRICKS_HTTP_PATH` | `/sql/1.0/warehouses/XXXXXXXXX` |
| `DATABRICKS_TOKEN` | `dapi...` |

---

### Step 11 — Verify It's Working

1. GitHub repo → **Actions** tab → **Refresh Dashboard Data** → **Run workflow** (manual trigger)
2. Watch the run complete (~1–2 min)
3. Open your GitHub Pages URL
4. Confirm the **🟢 Live** status badge appears (not Sample Data)
5. Change the **Start Date / End Date** and click **Apply Filters** — KPIs should update instantly with no loading

---

## Using Claude or Another AI Tool

Provide the AI tool with:
- Business objective
- Table list and column list (from `DESCRIBE TABLE`)
- Approved metric definitions from DataPedia
- SQL business rules
- Dashboard layout requirements
- Filters needed

**Security reminder:** Do not paste production tokens or credentials into a public AI tool. Use placeholders in prompts, then configure credentials locally via `.env`.

---

## Running Locally (Without GitHub Pages)

Open `dashboard.html` directly in a browser.

> Note: Chrome blocks local `fetch()` calls by default. Use `python -m http.server 8000` in the project folder and open `http://localhost:8000/dashboard.html` instead.

The current login in `radar_revops.html` is a lightweight email-domain gate — users can access only if their email ends with `@sprout.ph`. This is not a secure authentication mechanism. For production, use Google OAuth / Sprout SSO restricted to the `@sprout.ph` domain.

---

## Publishing to GitHub Pages (Quick Reference)

1. Create a GitHub repository (e.g. `radar-revops`)
2. Rename your HTML file to `index.html` (or keep as `dashboard.html`)
3. Add `README.md`
4. Commit and push to GitHub
5. Go to **Settings → Pages**
6. Set source to branch `main` and folder `/ (root)`
7. Save — dashboard is live in ~2 minutes

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows "⚠️ Sample Data" | `data/dashboard.json` not committed | Run `python fetch_data.py` and `git push` |
| HTTP 401 from Databricks | PAT expired | Generate a new token; update `.env` and GitHub Secrets |
| `wait_timeout` error | Value out of range | Must be `5s` to `50s` |
| `.env` key has `﻿` prefix | BOM in file (PowerShell `Out-File`) | Use `encoding='utf-8-sig'` when reading (already in template) |
| GitHub Actions fails | Secrets not set | Check Settings → Secrets — no extra spaces or quotes |
| Filters don't change KPIs | Old pre-aggregated JSON format | Re-run `fetch_data.py` to generate raw-deals format |
| GitHub Pages shows old version | Browser cache | Hard refresh: `Ctrl + Shift + R` |

---

## Reference Implementation

The **Channels Dashboard** is the live reference built by RevOps:
- Repo: `https://github.com/lelei0624/channels-dashboard`
- Live: `https://lelei0624.github.io/channels-dashboard/`
- Data: 619 raw deal records, last 3 years, refreshed 3× daily
- Filters: Start date / End date / Segment — all re-computed client-side
