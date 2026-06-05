-- ============================================================
-- RevOps Dashboard — Databricks SQL Query Library
-- Catalog: shared  |  Schema: revops
-- Syntax: Databricks SQL
--
-- Rules:
--   • Renewals excluded: LOWER(COALESCE(deal_name,'')) NOT LIKE '%renewal%'
--   • MICRO segment mapped to SME via CASE WHEN UPPER(segment)='MICRO' THEN 'SME'
--   • MRR from silver_deals (line-item rollup, term ≥ 12 months)
--   • ef_mrr = EmFi MRR (ReadyCash + ReadyWage)
--   • Use projected_close_date for pipeline / MQL / SQL TMRR
--   • Use close_date for Won, Closed-Won Revenue, Avg Deal Value
--   • Use create_date for Created Leads, Channel Source, Conversion, Velocity
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- BASE CTE  (paste at the top of any silver_deals query)
-- ────────────────────────────────────────────────────────────
/*
WITH deals_base AS (
  SELECT
    deal_id,
    deal_name,
    pipeline_name,
    deal_type,
    stage_label,
    client_journey_stage,
    create_date,
    close_date,
    projected_close_date,
    sales_rep,
    hubspot_team,
    department_source_clean,
    CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
    mrr,
    ef_mrr,
    amount,
    tcv,
    deal_velocity_days,
    original_traffic_source,
    original_source_of_awareness
  FROM shared.revops.silver_deals
  WHERE LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
)
*/


-- ============================================================
-- SECTION A: MQL — MARKETING QUALIFIED LEADS
-- Date basis: projected_close_date
-- Definition: stage_label IN Appointment Scheduled, Initial Demo Done,
--             Solutioning, Commercial Negotiation, Committed Accounts
-- ============================================================

-- Query 1 · MQL TMRR by Projected Close Month
SELECT
  DATE_TRUNC('month', projected_close_date) AS metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
  department_source_clean,
  SUM(COALESCE(mrr, 0)) AS mql_tmrr
FROM shared.revops.silver_deals
WHERE projected_close_date IS NOT NULL
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
  AND stage_label IN (
    'Appointment Scheduled',
    'Initial Demo Done',
    'Solutioning',
    'Commercial Negotiation',
    'Committed Accounts'
  )
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;


-- Query 2 · MQL TMRR vs Target
WITH actuals AS (
  SELECT
    DATE_TRUNC('month', projected_close_date) AS metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
    department_source_clean,
    SUM(COALESCE(mrr, 0)) AS actual_mql_tmrr
  FROM shared.revops.silver_deals
  WHERE projected_close_date IS NOT NULL
    AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
    AND stage_label IN (
      'Appointment Scheduled',
      'Initial Demo Done',
      'Solutioning',
      'Commercial Negotiation',
      'Committed Accounts'
    )
  GROUP BY 1, 2, 3, 4
),
targets AS (
  SELECT
    metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment_official) = 'MICRO' THEN 'SME' ELSE segment_official END AS segment,
    department_source_clean,
    SUM(target_value) AS target_mql_tmrr
  FROM shared.revops.gold_targets
  WHERE target_type IN ('MQL TMRR', 'Pipeline MRR', 'TMRR')
  GROUP BY 1, 2, 3, 4
)
SELECT
  a.metric_month,
  a.pipeline_name,
  a.segment,
  a.department_source_clean,
  a.actual_mql_tmrr,
  t.target_mql_tmrr,
  ROUND(a.actual_mql_tmrr / NULLIF(t.target_mql_tmrr, 0) * 100, 2) AS attainment_pct
FROM actuals a
LEFT JOIN targets t
  ON  a.metric_month              = t.metric_month
  AND a.pipeline_name             = t.pipeline_name
  AND a.segment                   = t.segment
  AND COALESCE(a.department_source_clean, '') = COALESCE(t.department_source_clean, '')
ORDER BY a.metric_month DESC;


-- ============================================================
-- SECTION B: SQL — SALES QUALIFIED LEADS
-- Date basis: projected_close_date
-- Definition: client_journey_stage = 'Opportunity'
-- ============================================================

-- Query 3 · SQL TMRR by Projected Close Month
SELECT
  DATE_TRUNC('month', projected_close_date) AS metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
  department_source_clean,
  SUM(COALESCE(mrr, 0)) AS sql_tmrr
FROM shared.revops.silver_deals
WHERE projected_close_date IS NOT NULL
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
  AND client_journey_stage = 'Opportunity'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;


-- ============================================================
-- SECTION C: WON
-- Date basis: close_date
-- Definition: client_journey_stage = 'Customer'
-- ============================================================

-- Query 4 · Won MRR vs Target
WITH actuals AS (
  SELECT
    DATE_TRUNC('month', close_date) AS metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
    department_source_clean,
    SUM(COALESCE(mrr, 0)) AS won_mrr
  FROM shared.revops.silver_deals
  WHERE close_date IS NOT NULL
    AND client_journey_stage = 'Customer'
    AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
  GROUP BY 1, 2, 3, 4
),
targets AS (
  SELECT
    metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment_official) = 'MICRO' THEN 'SME' ELSE segment_official END AS segment,
    department_source_clean,
    SUM(target_value) AS mrr_target
  FROM shared.revops.gold_targets
  WHERE target_type IN ('MRR', 'Won MRR')
  GROUP BY 1, 2, 3, 4
)
SELECT
  a.metric_month,
  a.pipeline_name,
  a.segment,
  a.department_source_clean,
  a.won_mrr,
  t.mrr_target,
  ROUND(a.won_mrr / NULLIF(t.mrr_target, 0) * 100, 2) AS attainment_pct
FROM actuals a
LEFT JOIN targets t
  ON  a.metric_month              = t.metric_month
  AND a.pipeline_name             = t.pipeline_name
  AND a.segment                   = t.segment
  AND COALESCE(a.department_source_clean, '') = COALESCE(t.department_source_clean, '')
ORDER BY a.metric_month DESC;


-- Query 5 · EmFi MRR (Embedded Finance)
-- ef_mrr = ReadyCash + ReadyWage (term ≥ 12 months)
SELECT
  DATE_TRUNC('month', close_date) AS metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
  department_source_clean,
  SUM(COALESCE(ef_mrr, 0)) AS emfi_mrr
FROM shared.revops.silver_deals
WHERE close_date IS NOT NULL
  AND client_journey_stage = 'Customer'
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;


-- ============================================================
-- SECTION D: CLOSED-WON REVENUE
-- Date basis: close_date
-- ============================================================

-- Query 6 · Closed-Won Revenue (Amount + TCV + MRR)
SELECT
  DATE_TRUNC('month', close_date) AS metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
  department_source_clean,
  SUM(COALESCE(amount, 0)) AS closed_won_revenue,
  SUM(COALESCE(tcv, 0))    AS closed_won_tcv,
  SUM(COALESCE(mrr, 0))    AS closed_won_mrr
FROM shared.revops.silver_deals
WHERE close_date IS NOT NULL
  AND client_journey_stage = 'Customer'
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;


-- ============================================================
-- SECTION E: AVERAGE DEAL VALUE
-- Date basis: close_date
-- ============================================================

-- Query 7 · Average Deal Value (MRR per deal + Amount per deal)
SELECT
  DATE_TRUNC('month', close_date) AS metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
  department_source_clean,
  COUNT(DISTINCT deal_id)                                                              AS won_deal_count,
  ROUND(SUM(COALESCE(mrr, 0))    / NULLIF(COUNT(DISTINCT deal_id), 0), 2) AS avg_deal_value_mrr,
  ROUND(SUM(COALESCE(amount, 0)) / NULLIF(COUNT(DISTINCT deal_id), 0), 2) AS avg_deal_value_amount
FROM shared.revops.silver_deals
WHERE close_date IS NOT NULL
  AND client_journey_stage = 'Customer'
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;


-- ============================================================
-- SECTION F: CREATED LEADS / MQL BY CHANNEL SOURCE
-- Date basis: create_date
-- Logic: Use original_traffic_source; if = 'Offline Sources',
--        use original_source_of_awareness (Events, Referrals, etc.)
-- ============================================================

-- Query 8 · Created Leads / MQL by Channel Source
WITH channel_base AS (
  SELECT
    DATE_TRUNC('month', create_date) AS metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
    department_source_clean,
    CASE
      WHEN original_traffic_source = 'Offline Sources'
        THEN COALESCE(original_source_of_awareness, 'Offline Sources - Unspecified')
      ELSE COALESCE(original_traffic_source, 'Unknown')
    END AS channel_source,
    deal_id
  FROM shared.revops.silver_deals
  WHERE create_date IS NOT NULL
    AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
)
SELECT
  metric_month,
  pipeline_name,
  segment,
  department_source_clean,
  channel_source,
  COUNT(DISTINCT deal_id) AS created_mql_count
FROM channel_base
GROUP BY 1, 2, 3, 4, 5
ORDER BY metric_month DESC, created_mql_count DESC;


-- ============================================================
-- SECTION G: CONVERSION RATES
-- Date basis: create_date
-- Excluded: TOFIL to MQL conversion
-- ============================================================

-- Query 9 · MQL to SQL Conversion Rate
WITH base AS (
  SELECT
    DATE_TRUNC('month', create_date) AS metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
    department_source_clean,
    deal_id,
    stage_label,
    client_journey_stage
  FROM shared.revops.silver_deals
  WHERE create_date IS NOT NULL
    AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
)
SELECT
  metric_month,
  pipeline_name,
  segment,
  department_source_clean,
  COUNT(DISTINCT CASE WHEN stage_label IN (
    'Appointment Scheduled', 'Initial Demo Done', 'Solutioning',
    'Commercial Negotiation', 'Committed Accounts'
  ) THEN deal_id END)                                          AS mql_count,
  COUNT(DISTINCT CASE WHEN client_journey_stage = 'Opportunity'
    THEN deal_id END)                                          AS sql_count,
  ROUND(
    COUNT(DISTINCT CASE WHEN client_journey_stage = 'Opportunity' THEN deal_id END)
    / NULLIF(COUNT(DISTINCT CASE WHEN stage_label IN (
        'Appointment Scheduled', 'Initial Demo Done', 'Solutioning',
        'Commercial Negotiation', 'Committed Accounts'
      ) THEN deal_id END), 0) * 100, 2
  )                                                            AS mql_to_sql_pct
FROM base
GROUP BY 1, 2, 3, 4
ORDER BY metric_month DESC;


-- Query 10 · SQL to Won Conversion Rate
WITH base AS (
  SELECT
    DATE_TRUNC('month', create_date) AS metric_month,
    pipeline_name,
    CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
    department_source_clean,
    deal_id,
    client_journey_stage
  FROM shared.revops.silver_deals
  WHERE create_date IS NOT NULL
    AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
)
SELECT
  metric_month,
  pipeline_name,
  segment,
  department_source_clean,
  COUNT(DISTINCT CASE WHEN client_journey_stage = 'Opportunity' THEN deal_id END) AS sql_count,
  COUNT(DISTINCT CASE WHEN client_journey_stage = 'Customer'    THEN deal_id END) AS won_count,
  ROUND(
    COUNT(DISTINCT CASE WHEN client_journey_stage = 'Customer' THEN deal_id END)
    / NULLIF(COUNT(DISTINCT CASE WHEN client_journey_stage = 'Opportunity' THEN deal_id END), 0) * 100, 2
  )                                                                                AS sql_to_won_pct
FROM base
GROUP BY 1, 2, 3, 4
ORDER BY metric_month DESC;


-- ============================================================
-- SECTION H: DEAL VELOCITY
-- Date basis: create_date  (won deals only)
-- ============================================================

-- Query 11 · Deal Velocity (avg days MQL → Won)
SELECT
  DATE_TRUNC('month', create_date) AS metric_month,
  pipeline_name,
  CASE WHEN UPPER(segment) = 'MICRO' THEN 'SME' ELSE segment END AS segment,
  department_source_clean,
  sales_rep,
  hubspot_team,
  ROUND(AVG(deal_velocity_days), 1) AS avg_deal_velocity_days,
  COUNT(DISTINCT deal_id)           AS won_deals
FROM shared.revops.silver_deals
WHERE create_date IS NOT NULL
  AND client_journey_stage = 'Customer'
  AND deal_velocity_days IS NOT NULL
  AND LOWER(COALESCE(deal_name, '')) NOT LIKE '%renewal%'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY metric_month DESC;


-- ============================================================
-- BONUS: Won MRR by Product (silver_line_items join)
-- Use for: Page 3 product breakdown
-- ============================================================
SELECT
  DATE_TRUNC('month', d.close_date) AS metric_month,
  d.pipeline_name,
  CASE WHEN UPPER(d.segment) = 'MICRO' THEN 'SME' ELSE d.segment END AS segment,
  li.parent_product,
  SUM(COALESCE(li.mrr, 0))  AS product_mrr,
  COUNT(DISTINCT d.deal_id) AS deal_count
FROM shared.revops.silver_deals d
JOIN shared.revops.silver_line_items li ON d.deal_id = li.deal_id
WHERE d.close_date IS NOT NULL
  AND d.client_journey_stage = 'Customer'
  AND LOWER(COALESCE(d.deal_name, '')) NOT LIKE '%renewal%'
  AND li.product_status = 'Availed'
GROUP BY 1, 2, 3, 4
ORDER BY metric_month DESC, product_mrr DESC;


-- ============================================================
-- BONUS: Executive Summary — fastest query for KPI cards
-- Source: gold_monthly_exec_summary (pre-aggregated, refreshed daily)
-- ============================================================
SELECT
  metric_month,
  pipeline_name,
  segment_official          AS segment,
  department_source_clean,
  qualified_leads           AS mql_count,
  sales_qualified_leads     AS sql_count,
  won_deals,
  lost_deals,
  won_mrr,
  won_ef_mrr                AS emfi_mrr,
  won_amount                AS closed_won_revenue,
  avg_deal_size             AS avg_deal_value,
  avg_deal_velocity         AS deal_velocity_days,
  sql_pct                   AS mql_to_sql_pct,
  win_rate                  AS sql_to_won_pct,
  mrr_in_pipeline           AS pipeline_tmrr
FROM shared.revops.gold_monthly_exec_summary
ORDER BY metric_month DESC;
