"""
Sales Dashboard — Databricks Data Fetcher
Fetches raw deal records + targets. Dashboard computes all KPIs client-side.
"""
import os, json, time, requests
from datetime import datetime, timezone, timedelta, date

# Load .env (local runs)
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
TODAY        = date.today()

HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}
API_URL = f'https://{HOST}/api/2.0/sql/statements'

print(f"Fetching sales data (last 3 years to {TODAY})...")


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
        time.sleep(3); polls += 1
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


DEALS_SQL = """
SELECT
  deal_id,
  deal_name,
  deal_type,
  pipeline_name,
  create_date,
  close_date,
  projected_close_date,
  client_journey_stage,
  stage_label,
  qualified_lead,
  mrr,
  ef_mrr,
  otp_only,
  mrr_lt_12,
  implem_fee,
  deal_velocity_days,
  sales_rep,
  hubspot_team,
  catalyst,
  forecast_category,
  department_source_clean,
  CASE
    WHEN segment LIKE '%SME%' OR segment LIKE '%MICRO%' OR segment LIKE '%11 to 200%' OR segment LIKE '%1 to 10%' THEN 'SME'
    WHEN segment LIKE '%ENT%' OR segment LIKE '%501%' OR segment LIKE '%MM%' OR segment LIKE '%201 to 500%' THEN 'ENT'
    ELSE segment
  END AS segment,
  original_channel_source
FROM shared.revops.silver_deals
WHERE deal_type NOT IN ('Renewal', 'renewal', 'Upsell - Renewal')
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
  AND (
    close_date              >= ADD_MONTHS(CURRENT_DATE, -36)
    OR projected_close_date >= ADD_MONTHS(CURRENT_DATE, -12)
    OR create_date          >= ADD_MONTHS(CURRENT_DATE, -36)
  )
ORDER BY COALESCE(close_date, projected_close_date) DESC
"""

TARGETS_SQL = """
SELECT
  metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment_official) = 'MICRO' THEN 'SME'
       ELSE segment_official END AS segment,
  department_source_clean,
  SUM(CASE WHEN target_type = 'mrr_target'       THEN CAST(target_value AS DOUBLE) ELSE 0 END) AS mrr_target,
  SUM(CASE WHEN target_type = 'ef_mrr_target'    THEN CAST(target_value AS DOUBLE) ELSE 0 END) AS ef_mrr_target,
  SUM(CASE WHEN target_type = 'ql_target'        THEN CAST(target_value AS DOUBLE) ELSE 0 END) AS ql_target,
  SUM(CASE WHEN target_type = 'won_deals_target' THEN CAST(target_value AS DOUBLE) ELSE 0 END) AS won_target
FROM shared.revops.gold_targets
WHERE metric_month >= ADD_MONTHS(CURRENT_DATE, -36)
GROUP BY metric_month, pipeline_name, segment_official, department_source_clean
ORDER BY metric_month DESC
"""

ALLIANCE_SQL = """
SELECT
  DATE_TRUNC('month', d.close_date) AS month,
  CASE WHEN d.pipeline_name = 'PH Upsell Pipeline' THEN 'upsell' ELSE 'nb' END AS deal_type,
  SUM(li.mrr) AS mrr
FROM shared.revops.silver_line_items li
JOIN shared.revops.silver_deals d ON li.deal_id = d.deal_id
WHERE (li.product_group = 'Third Party' OR li.parent_product = 'Recruit+')
  AND d.client_journey_stage = 'Customer'
  AND d.close_date IS NOT NULL
  AND d.close_date >= ADD_MONTHS(CURRENT_DATE, -36)
GROUP BY DATE_TRUNC('month', d.close_date),
         CASE WHEN d.pipeline_name = 'PH Upsell Pipeline' THEN 'upsell' ELSE 'nb' END
ORDER BY month DESC
"""

deals    = db_query('Deals',    DEALS_SQL)
targets  = db_query('Targets',  TARGETS_SQL)
alliance = db_query('Alliance', ALLIANCE_SQL)

PHT = timezone(timedelta(hours=8))
now_pht = datetime.now(PHT)
data = {
    'refreshed_at': now_pht.isoformat(),
    'deals':        deals,
    'targets':      targets,
    'alliance':     alliance,
}

os.makedirs('data', exist_ok=True)
with open('data/dashboard.json', 'w') as f:
    json.dump(data, f)

size_kb = os.path.getsize('data/dashboard.json') // 1024
print(f"\nDone! {len(deals)} deals + {len(targets)} target rows -> data/dashboard.json ({size_kb} KB)")
