"""
Channels Dashboard — Databricks Data Fetcher
Fetches raw deal records. Dashboard computes all KPIs client-side,
enabling full date + segment filtering without re-querying Databricks.
"""
import os, json, time, requests
from datetime import date

# Load .env file if it exists (local runs) — utf-8-sig handles BOM
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

PIPELINE = 'Unified Channel Pipeline'
TODAY    = date.today()

HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}
API_URL = f'https://{HOST}/api/2.0/sql/statements'

print(f"Fetching raw deals for {PIPELINE} (last 3 years to {TODAY})...")


def db_query(label, sql):
    print(f"  Running: {label}...", end=' ', flush=True)
    r = requests.post(API_URL, headers=HEADERS, json={
        'warehouse_id': WAREHOUSE_ID,
        'statement':    sql,
        'wait_timeout': '50s',
        'on_wait_timeout': 'CONTINUE',
        'format': 'JSON_ARRAY'
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


# Fetch ALL raw deals for the last 3 years
# No date filter — JS does all date filtering client-side
# Only exclude renewals (hard business rule) and scope to pipeline
RAW_SQL = f"""
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
  reasons_for_lost_deal AS reasons_for_lost,
  partner_on_record,
  client_type,
  CASE WHEN department_source_clean = 'MICRO' THEN 'SME'
       ELSE department_source_clean END  AS segment,
  original_channel_source
FROM shared.revops.silver_deals
WHERE pipeline_name = '{PIPELINE}'
  AND deal_type NOT IN ('Renewal', 'renewal', 'Upsell - Renewal')
  AND LOWER(deal_name) NOT LIKE '%renewal%'
  AND (
    create_date          >= ADD_MONTHS(CURRENT_DATE, -36)
    OR close_date        >= ADD_MONTHS(CURRENT_DATE, -36)
    OR projected_close_date >= ADD_MONTHS(CURRENT_DATE, -36)
  )
ORDER BY create_date DESC
"""

TARGETS_SQL = f"""
SELECT
  metric_month,
  SUM(CASE WHEN target_type = 'mrr_target'       THEN target_value ELSE 0 END) AS mrr_target,
  SUM(CASE WHEN target_type = 'won_deals_target' THEN target_value ELSE 0 END) AS won_deals_target
FROM shared.revops.gold_targets
WHERE pipeline_name = '{PIPELINE}'
GROUP BY metric_month
ORDER BY metric_month DESC
"""

deals   = db_query('All Deals', RAW_SQL)
targets = db_query('Targets',   TARGETS_SQL)

data = {
    'refreshed_at': TODAY.isoformat() + 'T' + time.strftime('%H:%M:%S') + 'Z',
    'pipeline':     PIPELINE,
    'deals':        deals,
    'targets':      targets,
}

os.makedirs('data', exist_ok=True)
with open('data/dashboard.json', 'w') as f:
    json.dump(data, f)

size_kb = os.path.getsize('data/dashboard.json') // 1024
print(f"\nDone! Saved {len(deals)} deals to data/dashboard.json ({size_kb} KB)")
