# RADAR — RevOps Analytics, Data & Reporting

RADAR is Sprout Solutions' internal RevOps data portal. It provides a single destination for:

- **Database** — Databricks table schemas, connection guides for Power BI / Excel / BI tools / AI tools
- **DataPedia** — Approved metric definitions and business glossary (43 metrics)
- **Dashboard Plan** — Full layout, KPI definitions, SQL templates, filters, Claude prompt, and GitHub publishing guide

---

## Data Sources

All tables live in `shared.revops` on Databricks (Unity Catalog).

| Table | Layer | Refresh | Purpose |
|---|---|---|---|
| `gold_monthly_exec_summary` | Gold | Daily | Pre-aggregated monthly KPIs — **use first for dashboards** |
| `gold_targets` | Gold | On change | Monthly quota targets by pipeline / segment |
| `silver_deals` | Silver | Daily | Deal-level HubSpot data (all 4 pipelines) |
| `silver_line_items` | Silver | Daily | Product line items per deal — MRR by product |
| `silver_company` | Silver | Daily | Company / account attributes |
| `gold_metrics_datapedia` | Gold | On change | Metric definitions glossary |
| `datapedia_approved` | Gold | On change | Approved metric definitions (source of truth) |

---

## Key Business Rules

| Rule | Detail |
|---|---|
| Exclude renewals | `WHERE LOWER(COALESCE(deal_name,'')) NOT LIKE '%renewal%'` |
| MICRO → SME | `CASE WHEN UPPER(segment)='MICRO' THEN 'SME' ELSE segment END` |
| MQL stages | Appointment Scheduled, Initial Demo Done, Solutioning, Commercial Negotiation, Committed Accounts |
| SQL stage | `client_journey_stage = 'Opportunity'` |
| Won stage | `client_journey_stage = 'Customer'` |
| EmFi MRR | `ef_mrr` column — ReadyCash + ReadyWage, term ≥ 12 months |
| Offline source | If `original_traffic_source = 'Offline Sources'`, use `original_source_of_awareness` |

---

## Date Basis Per Metric

| Date Field | Metrics |
|---|---|
| `projected_close_date` | MQL TMRR, SQL TMRR, Pipeline Forecast |
| `close_date` | Won MRR, EmFi MRR, Closed-Won Revenue, Avg Deal Value |
| `create_date` | Created Leads, Channel Source, MQL→SQL Rate, SQL→Won Rate, Deal Velocity |

---

## Dashboard Layout (5 Pages)

| Page | Content |
|---|---|
| 1 · Executive Overview | KPI cards: MQL TMRR, SQL TMRR, Won MRR vs Target, EmFi MRR, CW Revenue, Avg Deal Value, Velocity |
| 2 · Pipeline / Forecast | MQL & SQL TMRR by projected close month, pipeline by stage / segment / rep |
| 3 · Won Revenue | Won MRR vs Target, EmFi MRR, CW Revenue, Avg Deal Value, MRR by product |
| 4 · Channel Source | Created MQL by channel, Offline Sources breakdown, channel by segment |
| 5 · Conversion & Velocity | MQL→SQL rate, SQL→Won rate, deal velocity trend by rep / segment / pipeline |

---

## Access Requirements

- Read access to catalog `shared`
- Read access to schema `revops`
- Access to the Databricks SQL Warehouse (ask RevOps team for details)
- Server Hostname and HTTP Path from **SQL Warehouses → Connection Details**
- Personal Access Token (PAT) from **Settings → Developer → Access Tokens**

---

## How to Run Locally

1. Download `radar_revops.html` (or `index.html` from this repo)
2. Open in **Chrome** or **Edge**
3. Log in with your `@sprout.ph` email address
4. No server, no installation — runs entirely in the browser

---

## How to Publish to GitHub Pages

```bash
# 1. Create repo at github.com — name: radar-revops
# 2. Clone and add files
git clone https://github.com/[your-username]/radar-revops.git
cd radar-revops
cp /path/to/radar_revops.html index.html
git add index.html README.md
git commit -m "Initial RADAR publish"
git push origin main

# 3. Enable Pages: Settings → Pages → Branch: main / Folder: / (root)
# 4. Access at: https://[your-username].github.io/radar-revops/
```

**Recommended visibility:** Private repo (requires GitHub Team plan for Pages).  
For free hosting, use a public repo — but ensure no hard-coded PAT tokens are in the file.

---

## SQL Query Library

See `revops_dashboard_queries.sql` for all 11 dashboard queries plus bonus executive summary and product breakdown queries.

---

## Connecting AI Tools (Claude)

See the **Dashboard Plan → Claude Prompt** tab inside RADAR for the full copyable prompt.

**Quick guide:**
1. Run `DESCRIBE TABLE shared.revops.gold_monthly_exec_summary` in Databricks SQL Editor
2. Paste the output + the Claude prompt template into Claude
3. Fill in your Server Hostname, HTTP Path, PAT in the generated CONFIG block
4. Open the generated HTML in Chrome

---

## Security

RADAR uses a lightweight **email-only login gate** (browser localStorage).

- Only `@sprout.ph` email addresses can access the app
- No password is stored — this is a front-end access gate, **not** secure authentication
- Session persists until the user clicks Sign Out or clears browser storage

**For production use:** Implement Google OAuth restricted to the `@sprout.ph` domain, or integrate with Sprout SSO.

**Credential safety:** Never commit Databricks PAT tokens to this repo. Use placeholders in any shared files and configure credentials locally.

---

## Maintainer

RevOps Analytics Team · Sprout Solutions  
Data layer: `shared.revops` · Databricks SQL
