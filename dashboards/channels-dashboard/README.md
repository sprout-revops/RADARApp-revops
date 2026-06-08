# Sprout RevOps — Self-Serve Analytics Dashboard Guide

A reusable blueprint for building a **live, filterable analytics dashboard** hosted on GitHub Pages — no servers, no BI tools, no licensing fees. Data is pulled from Databricks on a schedule and served as a static JSON file; all KPI computation happens in the browser.

> **Channels Dashboard** (this repo) is the reference implementation built by RevOps. Follow the steps below to create your own department dashboard.

---

## Architecture Overview

```
Databricks SQL
      │
      │  Python script (fetch_data.py)
      │  runs on schedule (local Task Scheduler or GitHub Actions)
      ▼
data/dashboard.json   ← static file committed to GitHub repo
      │
      │  browser reads via fetch()
      ▼
dashboard.html        ← single-file app hosted on GitHub Pages
      │
      │  JavaScript computes KPIs, charts, tables client-side
      ▼
User's browser        ← filters (date range, segment) re-compute instantly
```

**Why this approach?**
- No CORS issues — browser never talks directly to Databricks
- No backend to maintain — GitHub Pages serves static files for free
- Full date + segment filtering without re-querying Databricks
- Anyone with a GitHub account can host their own version

---

## What You Need Before Starting

| Requirement | Details |
|---|---|
| Python 3.8+ | Install from python.org; add to PATH |
| Git | Install from git-scm.com |
| GitHub account | Free at github.com |
| Databricks access | HTTP Path + Personal Access Token (PAT) from your workspace |
| `requests` Python library | `pip install requests` |

---

## Step-by-Step Setup

### Step 1 — Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it something like `my-team-dashboard` (lowercase, hyphens)
3. Set visibility to **Private** (recommended for internal data)
4. Check **Add a README file**
5. Click **Create repository**

---

### Step 2 — Clone the Repo to Your Computer

Open PowerShell or Command Prompt:

```powershell
git clone https://github.com/YOUR-USERNAME/my-team-dashboard.git
cd my-team-dashboard
```

---

### Step 3 — Create the Folder Structure

```
my-team-dashboard/
├── dashboard.html        ← the entire dashboard (one file)
├── fetch_data.py         ← pulls data from Databricks
├── .env                  ← your credentials (never commit this!)
├── .gitignore            ← tells git to ignore .env and data/
├── refresh_and_push.bat  ← local auto-refresh script
├── data/
│   └── dashboard.json    ← auto-generated; committed to repo
└── .github/
    └── workflows/
        └── refresh.yml   ← GitHub Actions scheduled refresh
```

Create the folders:

```powershell
mkdir data
mkdir .github\workflows
```

---

### Step 4 — Create Your `.env` File (Credentials)

In the project root, create a file named `.env` (no extension):

```
DATABRICKS_HOST=adb-XXXXXXXXXXXXXXXX.XX.azuredatabricks.net
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/XXXXXXXXXXXXXXXXX
DATABRICKS_TOKEN=dapi...your-personal-access-token...
```

**How to get these values:**
- **DATABRICKS_HOST**: Your Databricks workspace URL (without `https://`)
- **DATABRICKS_HTTP_PATH**: In Databricks → SQL Warehouses → your warehouse → Connection Details tab → HTTP Path
- **DATABRICKS_TOKEN**: In Databricks → top-right profile icon → Settings → Developer → Access Tokens → Generate new token

> **Important:** Never commit `.env` to GitHub. Add it to `.gitignore` (see Step 5).

---

### Step 5 — Create `.gitignore`

Create a file named `.gitignore` in the project root:

```
.env
node_modules/
__pycache__/
*.pyc
```

---

### Step 6 — Write `fetch_data.py`

This script queries Databricks and saves raw deal records to `data/dashboard.json`. The key principle: **fetch raw rows, not aggregates** — the dashboard will compute everything client-side, which enables full date and segment filtering.

```python
"""
[Your Team] Dashboard — Databricks Data Fetcher
Fetches raw records. Dashboard computes all KPIs client-side.
"""
import os, json, time, requests
from datetime import date

# Load .env file (local runs)
_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
if os.path.exists(_env):
    with open(_env, encoding='utf-8-sig') as _f:  # utf-8-sig handles BOM
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

TODAY = date.today()
print(f"Fetching data (last 3 years to {TODAY})...")


def db_query(label, sql):
    print(f"  Running: {label}...", end=' ', flush=True)
    r = requests.post(API_URL, headers=HEADERS, json={
        'warehouse_id':    WAREHOUSE_ID,
        'statement':       sql,
        'wait_timeout':    '50s',
        'on_wait_timeout': 'CONTINUE',
        'format':          'JSON_ARRAY'
    }, timeout=180)
    if not r.ok:
        raise Exception(f"HTTP {r.status_code}: {r.text[:500]}")
    body = r.json()
    polls = 0
    while body.get('status', {}).get('state') in ['PENDING', 'RUNNING']:
        time.sleep(3)
        polls += 1
        body = requests.get(
            f"{API_URL}/{body['statement_id']}", headers=HEADERS, timeout=30
        ).json()
    state = body.get('status', {}).get('state')
    if state == 'FAILED':
        err = body.get('status', {}).get('error', {}).get('message', 'Unknown error')
        raise Exception(f'{label} failed: {err}')
    cols = [c['name'] for c in body.get('manifest', {}).get('schema', {}).get('columns', [])]
    rows = [dict(zip(cols, row)) for row in body.get('result', {}).get('data_array', [])]
    print(f"{len(rows)} rows ({polls} polls)")
    return rows


# ── EDIT THIS QUERY FOR YOUR TEAM ──────────────────────────────────────────
# Replace the SELECT columns and table/filters with your own data.
# Keep the last-3-years date filter so users can slice any period.
# ───────────────────────────────────────────────────────────────────────────
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
WHERE pipeline_name = 'YOUR PIPELINE NAME HERE'
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

data = {
    'refreshed_at': TODAY.isoformat() + 'T' + time.strftime('%H:%M:%S') + 'Z',
    'pipeline':     'YOUR PIPELINE NAME HERE',
    'deals':        records,
}

os.makedirs('data', exist_ok=True)
with open('data/dashboard.json', 'w') as f:
    json.dump(data, f)

size_kb = os.path.getsize('data/dashboard.json') // 1024
print(f"\nDone! Saved {len(records)} records to data/dashboard.json ({size_kb} KB)")
```

**Test it locally:**

```powershell
pip install requests
python fetch_data.py
```

You should see something like:
```
Fetching data (last 3 years to 2026-05-11)...
  Running: All Records... 619 rows (0 polls)

Done! Saved 619 records to data/dashboard.json (358 KB)
```

---

### Step 7 — Create `dashboard.html`

This is the entire dashboard in a single HTML file. It reads `data/dashboard.json` and computes everything in JavaScript — no backend needed.

**Key sections to customise for your team:**

| Section | What to change |
|---|---|
| `<title>` tag | Your team name |
| `PIPELINE_DEFAULT` constant | Your pipeline name |
| KPI card HTML blocks | Add/remove/rename cards for your metrics |
| `computeFromDeals()` function | Your KPI formulas and business rules |
| Table columns (`<thead>`) | Your column names |
| `renderWon()` etc. | Map your JSON fields to table cells |
| `SAMPLE` data object | Realistic dummy values shown before first fetch |

> **Tip:** Start by copying the Channels Dashboard `dashboard.html` from this repo and adapting the sections above. The framework (charts, tables, filters, status badges, export) can be reused as-is.

---

### Step 8 — Commit and Push Your First Version

```powershell
git add dashboard.html fetch_data.py .gitignore data/dashboard.json README.md
git commit -m "Initial dashboard setup"
git push origin master
```

> **Note:** `data/dashboard.json` should be committed — it's what GitHub Pages serves to the browser. `.env` should never be committed.

---

### Step 9 — Enable GitHub Pages

1. In your GitHub repo → **Settings** tab
2. Left sidebar → **Pages**
3. Under **Source**, select **Deploy from a branch**
4. Branch: `master` (or `main`) · Folder: `/ (root)`
5. Click **Save**

After 1–2 minutes your dashboard is live at:
```
https://YOUR-USERNAME.github.io/my-team-dashboard/
```

> GitHub Pages serves `dashboard.html` as the default page from the root.

---

### Step 10 — Set Up Scheduled Refresh

You need data to be refreshed automatically so the dashboard stays current. There are two options — **use both** for maximum reliability.

#### Option A: Windows Task Scheduler (local machine, primary)

Create `refresh_and_push.bat` in the project root:

```bat
@echo off
cd /d "C:\path\to\your\my-team-dashboard"
echo [%date% %time%] Starting refresh... >> refresh_log.txt
python fetch_data.py >> refresh_log.txt 2>&1
if errorlevel 1 (
    echo [%date% %time%] fetch_data.py FAILED >> refresh_log.txt
    exit /b 1
)
git add data/dashboard.json
git commit -m "Auto-refresh: %date% %time%" >> refresh_log.txt 2>&1
git push origin master >> refresh_log.txt 2>&1
echo [%date% %time%] Done. >> refresh_log.txt
```

**Schedule it in Windows Task Scheduler:**

1. Open **Task Scheduler** (search in Start menu)
2. Click **Create Task** (right panel)
3. **General tab:**
   - Name: `Dashboard Refresh — My Team`
   - Check: *Run whether user is logged on or not*
   - Check: *Run with highest privileges*
4. **Triggers tab → New:**
   - Begin the task: On a schedule → Daily
   - Repeat task every: `8 hours` (or set 3 specific times)
   - Recommended times: 8:30 AM, 1:30 PM, 5:15 PM
5. **Actions tab → New:**
   - Action: Start a program
   - Program/script: `C:\path\to\your\my-team-dashboard\refresh_and_push.bat`
6. Click **OK** and enter your Windows password when prompted

#### Option B: GitHub Actions (cloud, backup)

Create `.github/workflows/refresh.yml`:

```yaml
name: Refresh Dashboard Data

on:
  schedule:
    # UTC times — adjust for PHT (UTC+8)
    # 8:30 AM PHT = 0:30 UTC | 1:30 PM PHT = 5:30 UTC | 5:15 PM PHT = 9:15 UTC
    - cron: '30 0 * * *'
    - cron: '30 5 * * *'
    - cron: '15 9 * * *'
  workflow_dispatch:  # allows manual trigger from GitHub UI

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install requests

      - name: Fetch data from Databricks
        env:
          DATABRICKS_HOST:      ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_HTTP_PATH: ${{ secrets.DATABRICKS_HTTP_PATH }}
          DATABRICKS_TOKEN:     ${{ secrets.DATABRICKS_TOKEN }}
        run: python fetch_data.py

      - name: Commit and push data
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/dashboard.json
          git diff --staged --quiet || git commit -m "Auto-refresh: $(date -u '+%Y-%m-%d %H:%M UTC')"
          git push
```

**Add GitHub Secrets** (so GitHub Actions can authenticate to Databricks):

1. GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** for each:

| Secret Name | Value |
|---|---|
| `DATABRICKS_HOST` | `adb-XXXXXXXX.XX.azuredatabricks.net` |
| `DATABRICKS_HTTP_PATH` | `/sql/1.0/warehouses/XXXXXXXXX` |
| `DATABRICKS_TOKEN` | `dapi...` |

> **Tip:** GitHub Actions runs in the cloud — it works even when your laptop is off. Windows Task Scheduler runs locally — it's faster and doesn't consume GitHub Actions minutes. Using both gives you redundancy.

---

### Step 11 — Test End-to-End

1. Manually trigger: GitHub repo → **Actions** tab → **Refresh Dashboard Data** → **Run workflow**
2. Watch the run complete (≈ 1–2 minutes)
3. Open your GitHub Pages URL
4. You should see live data with the green **🟢 Live** badge
5. Try changing the **Start Date / End Date** filters and clicking **Apply Filters** — all KPIs should update instantly

---

## Customising for Your Team

### Adding a New KPI Card

**In the HTML** — add a card block:
```html
<div class="kpi-card">
  <span class="kpi-icon">📊</span>
  <div class="kpi-label">My Metric</div>
  <div class="kpi-value" id="kpi-mymetric">—</div>
  <div class="kpi-ly"   id="kpi-mymetric-ly"></div>
  <div class="kpi-sub">Description</div>
</div>
```

**In JavaScript** — compute it inside `computeFromDeals()`:
```javascript
const myMetric = wonRows.reduce((a, d) => a + (+d.my_column || 0), 0);
kpi.my_metric = myMetric;
```

**In `renderKPIs()`** — display it:
```javascript
document.getElementById('kpi-mymetric').textContent = php(k.my_metric);
```

### Changing Metric Business Rules

The `computeFromDeals()` function uses **strict date-column separation**:

| Metric type | Date column used |
|---|---|
| Lead / Funnel counts | `create_date` |
| Revenue (Won MRR, Implem Fee, etc.) | `close_date` |
| Pipeline | `projected_close_date` |

Change the filter logic inside `computeFromDeals()` to match your team's definitions. All LY comparisons are computed automatically by shifting dates -1 year.

### Adding a New Filter (e.g., Sales Rep)

**HTML:** Add a `<select>` in the filter bar with `id="f-rep"`.

**In `readFilters()`:**
```javascript
S.filters.rep = document.getElementById('f-rep').value;
```

**In `computeFromDeals()`:** Add to `segMatch()` logic:
```javascript
const repMatch = d => !filters.rep || d.sales_rep === filters.rep;
```

Then apply `repMatch(d)` alongside `segMatch(d)` in the subset filters.

---

## File Reference

| File | Purpose |
|---|---|
| `dashboard.html` | Entire dashboard UI + JavaScript (single file) |
| `fetch_data.py` | Queries Databricks, writes `data/dashboard.json` |
| `.env` | Local credentials — **never commit** |
| `.env.example` | Template showing required variable names (safe to commit) |
| `data/dashboard.json` | Auto-generated data file served to browsers |
| `refresh_and_push.bat` | Windows Task Scheduler script for local auto-refresh |
| `.github/workflows/refresh.yml` | GitHub Actions cloud refresh schedule |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows "⚠️ Sample Data" | `data/dashboard.json` missing or empty | Run `python fetch_data.py` and commit the file |
| `fetch_data.py` fails with HTTP 401 | Databricks PAT expired | Generate a new token and update `.env` (and GitHub Secrets) |
| `fetch_data.py` fails with `wait_timeout` error | Timeout value out of range | Must be between `5s` and `50s` |
| `.env` values not loading (key has `﻿` prefix) | BOM in file (created by PowerShell) | Open `.env` with `encoding='utf-8-sig'` in Python (already done in template) |
| GitHub Actions runs but data doesn't update | Secrets not set correctly | Check **Settings → Secrets** — values must not have extra spaces or quotes |
| Filters don't update KPIs | `data/dashboard.json` has old pre-aggregated format | Re-run `fetch_data.py` to generate the new raw-deals format |
| GitHub Pages shows old version | Browser cache | Hard refresh: `Ctrl + Shift + R` |

---

## Architecture Decisions & Trade-offs

| Decision | Why |
|---|---|
| Single HTML file | Zero dependencies, easy to version-control, works on any host |
| Raw rows in JSON, not aggregates | Enables client-side date + segment filtering without re-querying |
| GitHub Pages hosting | Free, reliable, zero infrastructure to manage |
| Scheduled refresh (not live) | Avoids CORS — browsers can't directly call Databricks from a different origin |
| Both local + cloud refresh | Redundancy — cloud runs even when laptop is off; local runs faster |
| `data/` committed to repo | GitHub Pages needs the file to be in the repo; no CDN needed |

---

*Built by RevOps Data Analytics. Questions? Ping the RevOps team.*
