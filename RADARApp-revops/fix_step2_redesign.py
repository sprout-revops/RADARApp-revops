"""
fix_step2_redesign.py

Completely redesign Step 2 (Configure):
- Remove Date Range dropdown, replace with simple From/To date pickers
- Add multi-select filter section: segment, pipeline, team, rep, source, industry
- Add Views multi-select card grid: per rep, per team, per segment, trend, funnel, etc.
- Update _builderRenderPrompt to read all new fields
- Add new CSS for new components
"""
import re

with open('radar_revops.html', encoding='utf-8') as f:
    html = f.read()

# ── 1. New CSS for Step 2 ─────────────────────────────────────────────────────
new_css = '''
/* Builder Step 2 redesign */
.bd-section{margin-bottom:22px}
.bd-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:rgba(255,255,255,.35);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.06)}
.bd-date-row{display:flex;gap:12px;flex-wrap:wrap}
.bd-date-row .builder-field{flex:1;min-width:160px}
.bd-filters-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.bd-filter-box{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px 14px}
.bd-filter-box-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:rgba(255,255,255,.4);margin-bottom:8px}
.bd-check-list{display:flex;flex-direction:column;gap:5px}
.bd-check-item{display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.65);cursor:pointer;padding:3px 0;user-select:none}
.bd-check-item input[type=checkbox]{width:14px;height:14px;accent-color:#1DB954;cursor:pointer;flex-shrink:0}
.bd-check-item:hover{color:#e2e8f0}
.bd-views-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.bd-view-card{display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);border:1.5px solid rgba(255,255,255,.07);border-radius:8px;cursor:pointer;transition:all .15s;user-select:none}
.bd-view-card:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}
.bd-view-card input[type=checkbox]{width:15px;height:15px;accent-color:#1DB954;cursor:pointer;flex-shrink:0}
.bd-view-card.bd-view-checked{background:rgba(29,185,84,.07);border-color:rgba(29,185,84,.3)}
.bd-view-icon{font-size:18px;line-height:1;flex-shrink:0}
.bd-view-label{font-size:12px;font-weight:600;color:rgba(255,255,255,.7);line-height:1.3}
.bd-full-width{grid-column:1/-1}
'''

old_css_end = '.builder-tip-box strong{color:#1DB954}\n</style>'
new_css_end  = '.builder-tip-box strong{color:#1DB954}\n' + new_css + '</style>'
html = html.replace(old_css_end, new_css_end, 1)
print("OK: new CSS added")

# ── 2. Add view card toggle JS (add checked class) ────────────────────────────
# We'll handle this inline via the label + checkbox relationship (CSS :has or JS)

# ── 3. Replace Step 2 HTML entirely ──────────────────────────────────────────
old_step2 = '''  <!-- Step 2: Configure -->
  <div class="builder-step-panel" id="builder-step-2" style="display:none">
    <div class="builder-panel-header">
      <div>
        <div class="builder-panel-title">Step 2 of 3 — Configure Your Dashboard</div>
        <div class="builder-panel-sub">Set the name, date range, pipeline, segment, and view type for your dashboard.</div>
      </div>
    </div>

    <div class="builder-config-body">
      <div class="builder-form-grid">
        <div class="builder-field">
          <label class="builder-label">Dashboard Name</label>
          <input class="builder-input" id="bd-name" type="text" placeholder="e.g. Marketing Funnel Dashboard">
        </div>
        <div class="builder-field">
          <label class="builder-label">Date Range</label>
          <select class="builder-select" id="bd-daterange" onchange="builderToggleCustomDates()">
            <option value="MTD">MTD (Month to Date)</option>
            <option value="QTD">QTD (Quarter to Date)</option>
            <option value="YTD">YTD (Year to Date)</option>
            <option value="Last 30 Days">Last 30 Days</option>
            <option value="Last 90 Days">Last 90 Days</option>
            <option value="Custom">Custom Range</option>
          </select>
        </div>
        <div class="builder-field builder-custom-dates" id="bd-custom-dates" style="display:none">
          <label class="builder-label">From Date</label>
          <input class="builder-input" id="bd-from" type="date">
        </div>
        <div class="builder-field builder-custom-dates" id="bd-custom-dates-to" style="display:none">
          <label class="builder-label">To Date</label>
          <input class="builder-input" id="bd-to" type="date">
        </div>
        <div class="builder-field">
          <label class="builder-label">Pipeline</label>
          <select class="builder-select" id="bd-pipeline">
            <option value="All Pipelines">All Pipelines</option>
            <option value="Sales Pipeline">Sales Pipeline</option>
            <option value="PH Upsell Pipeline">PH Upsell Pipeline</option>
            <option value="Unified Channel Pipeline">Unified Channel Pipeline</option>
            <option value="TH Sales Pipeline">TH Sales Pipeline</option>
          </select>
        </div>
        <div class="builder-field">
          <label class="builder-label">Segment</label>
          <select class="builder-select" id="bd-segment">
            <option value="All Segments">All Segments</option>
            <option value="SME">SME</option>
            <option value="ENT">ENT</option>
            <option value="Channels">Channels</option>
          </select>
        </div>
        <div class="builder-field">
          <label class="builder-label">View Type</label>
          <select class="builder-select" id="bd-viewtype">
            <option value="KPI Cards + Charts">KPI Cards + Charts</option>
            <option value="KPI Cards Only">KPI Cards Only</option>
            <option value="Trend Charts Only">Trend Charts Only</option>
            <option value="Full Report">Full Report</option>
          </select>
        </div>
      </div>

      <div class="builder-selected-summary">
        <div class="builder-label" style="margin-bottom:8px">Selected Metrics</div>
        <div class="builder-chips" id="builder-chips"></div>
      </div>
    </div>

    <div class="builder-footer">
      <button class="builder-btn-back" onclick="builderGoStep(1)">← Back</button>
      <button class="builder-btn-next" onclick="builderGoStep(3)">Generate Prompt →</button>
    </div>
  </div>'''

new_step2 = '''  <!-- Step 2: Configure -->
  <div class="builder-step-panel" id="builder-step-2" style="display:none">
    <div class="builder-panel-header">
      <div>
        <div class="builder-panel-title">Step 2 of 3 — Configure Your Dashboard</div>
        <div class="builder-panel-sub">Set the dashboard name, date filter, apply data filters, and choose what views to include.</div>
      </div>
    </div>

    <div class="builder-config-body">

      <!-- Dashboard Name -->
      <div class="bd-section">
        <div class="bd-section-title">Dashboard Name</div>
        <input class="builder-input" id="bd-name" type="text" placeholder="e.g. Leads Dashboard Q2 2026" style="max-width:480px">
      </div>

      <!-- Date Filter -->
      <div class="bd-section">
        <div class="bd-section-title">Date Filter</div>
        <div class="bd-date-row">
          <div class="builder-field">
            <label class="builder-label">From</label>
            <input class="builder-input" id="bd-from" type="date">
          </div>
          <div class="builder-field">
            <label class="builder-label">To</label>
            <input class="builder-input" id="bd-to" type="date">
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="bd-section">
        <div class="bd-section-title">Filters <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:10px;color:rgba(255,255,255,.25)">(leave blank = include all)</span></div>
        <div class="bd-filters-grid">

          <div class="bd-filter-box">
            <div class="bd-filter-box-title">Segment</div>
            <div class="bd-check-list" id="bd-segment-group">
              <label class="bd-check-item"><input type="checkbox" value="SME"> SME</label>
              <label class="bd-check-item"><input type="checkbox" value="ENT"> Enterprise (ENT)</label>
              <label class="bd-check-item"><input type="checkbox" value="Channels"> Channels</label>
            </div>
          </div>

          <div class="bd-filter-box">
            <div class="bd-filter-box-title">Pipeline</div>
            <div class="bd-check-list" id="bd-pipeline-group">
              <label class="bd-check-item"><input type="checkbox" value="Sales Pipeline"> Sales Pipeline</label>
              <label class="bd-check-item"><input type="checkbox" value="PH Upsell Pipeline"> PH Upsell Pipeline</label>
              <label class="bd-check-item"><input type="checkbox" value="Unified Channel Pipeline"> Unified Channel Pipeline</label>
              <label class="bd-check-item"><input type="checkbox" value="TH Sales Pipeline"> TH Sales Pipeline</label>
            </div>
          </div>

          <div class="bd-filter-box">
            <div class="bd-filter-box-title">Lead Source / Department</div>
            <div class="bd-check-list" id="bd-source-group">
              <label class="bd-check-item"><input type="checkbox" value="Marketing"> Marketing</label>
              <label class="bd-check-item"><input type="checkbox" value="LDU Outbound"> LDU Outbound</label>
              <label class="bd-check-item"><input type="checkbox" value="LDU Inbound"> LDU Inbound</label>
              <label class="bd-check-item"><input type="checkbox" value="Sales"> Sales</label>
              <label class="bd-check-item"><input type="checkbox" value="Channels"> Channels</label>
              <label class="bd-check-item"><input type="checkbox" value="CSM"> CSM</label>
            </div>
          </div>

          <div class="bd-filter-box">
            <div class="bd-filter-box-title">Industry</div>
            <div class="bd-check-list" id="bd-industry-group">
              <label class="bd-check-item"><input type="checkbox" value="Retail"> Retail</label>
              <label class="bd-check-item"><input type="checkbox" value="Services"> Services</label>
              <label class="bd-check-item"><input type="checkbox" value="Manufacturing"> Manufacturing</label>
              <label class="bd-check-item"><input type="checkbox" value="Healthcare"> Healthcare</label>
              <label class="bd-check-item"><input type="checkbox" value="F&amp;B"> F&amp;B</label>
              <label class="bd-check-item"><input type="checkbox" value="Technology"> Technology</label>
              <label class="bd-check-item"><input type="checkbox" value="Education"> Education</label>
            </div>
          </div>

          <div class="bd-filter-box">
            <div class="bd-filter-box-title">Sales Rep <span style="font-weight:400;text-transform:none">(type names)</span></div>
            <input class="builder-input" id="bd-rep" type="text" placeholder="e.g. Katryn Saldajeno, Ferdie Salvosa" style="font-size:12px">
          </div>

          <div class="bd-filter-box">
            <div class="bd-filter-box-title">Team <span style="font-weight:400;text-transform:none">(type team name)</span></div>
            <input class="builder-input" id="bd-team" type="text" placeholder="e.g. Team A, PH Sales Team" style="font-size:12px">
          </div>

        </div>
      </div>

      <!-- Views to Include -->
      <div class="bd-section">
        <div class="bd-section-title">Views to Include <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:10px;color:rgba(255,255,255,.25)">(select all that apply)</span></div>
        <div class="bd-views-grid" id="bd-views-group">
          <label class="bd-view-card bd-view-checked"><input type="checkbox" value="summary" checked onchange="bdViewToggle(this)"><span class="bd-view-icon">📊</span><span class="bd-view-label">Summary KPIs</span></label>
          <label class="bd-view-card"><input type="checkbox" value="per_rep" onchange="bdViewToggle(this)"><span class="bd-view-icon">👤</span><span class="bd-view-label">Per Rep</span></label>
          <label class="bd-view-card"><input type="checkbox" value="per_team" onchange="bdViewToggle(this)"><span class="bd-view-icon">👥</span><span class="bd-view-label">Per Team</span></label>
          <label class="bd-view-card"><input type="checkbox" value="per_segment" onchange="bdViewToggle(this)"><span class="bd-view-icon">🎯</span><span class="bd-view-label">Per Segment</span></label>
          <label class="bd-view-card"><input type="checkbox" value="per_pipeline" onchange="bdViewToggle(this)"><span class="bd-view-icon">🔀</span><span class="bd-view-label">Per Pipeline</span></label>
          <label class="bd-view-card"><input type="checkbox" value="per_industry" onchange="bdViewToggle(this)"><span class="bd-view-icon">🏭</span><span class="bd-view-label">Per Industry</span></label>
          <label class="bd-view-card"><input type="checkbox" value="trend" onchange="bdViewToggle(this)"><span class="bd-view-icon">📈</span><span class="bd-view-label">Trend / Time Series</span></label>
          <label class="bd-view-card"><input type="checkbox" value="funnel" onchange="bdViewToggle(this)"><span class="bd-view-icon">🔽</span><span class="bd-view-label">Funnel Breakdown</span></label>
          <label class="bd-view-card"><input type="checkbox" value="leaderboard" onchange="bdViewToggle(this)"><span class="bd-view-icon">🏆</span><span class="bd-view-label">Leaderboard</span></label>
          <label class="bd-view-card"><input type="checkbox" value="comparison" onchange="bdViewToggle(this)"><span class="bd-view-icon">⚖️</span><span class="bd-view-label">MoM Comparison</span></label>
        </div>
      </div>

      <!-- Selected Metrics Summary -->
      <div class="builder-selected-summary">
        <div class="builder-label" style="margin-bottom:8px">Selected Metrics</div>
        <div class="builder-chips" id="builder-chips"></div>
      </div>

    </div>

    <div class="builder-footer">
      <button class="builder-btn-back" onclick="builderGoStep(1)">← Back</button>
      <button class="builder-btn-next" onclick="builderGoStep(3)">Generate Prompt →</button>
    </div>
  </div>'''

if old_step2 in html:
    html = html.replace(old_step2, new_step2, 1)
    print("OK: Step 2 HTML replaced")
else:
    print("WARN: Step 2 HTML not found exactly")

# ── 4. Add bdViewToggle JS function ──────────────────────────────────────────
old_toggle = 'function builderToggleCustomDates() {'
new_view_toggle = '''function bdViewToggle(cb) {
  var card = cb.closest ? cb.closest('.bd-view-card') : cb.parentNode;
  if (card) card.classList.toggle('bd-view-checked', cb.checked);
}

function builderToggleCustomDates() {'''

html = html.replace(old_toggle, new_view_toggle, 1)
print("OK: bdViewToggle function added")

# ── 5. Rewrite _builderRenderPrompt to use all new fields ─────────────────────
# Find and replace the entire _builderRenderPrompt function
old_prompt_start = 'function _builderRenderPrompt() {'
old_prompt_end   = '\n  var ta = document.getElementById(\'builder-prompt-output\');\n  if (ta) ta.value = prompt;\n}'

# Find the full function
ps = html.find(old_prompt_start)
pe = html.find(old_prompt_end, ps) + len(old_prompt_end)

new_prompt_fn = '''function _builderRenderPrompt() {
  // ── Read all config fields ──
  var name     = (document.getElementById('bd-name')||{}).value || 'RevOps Dashboard';
  var fromDate = (document.getElementById('bd-from')||{}).value || '';
  var toDate   = (document.getElementById('bd-to')||{}).value || '';
  var rep      = (document.getElementById('bd-rep')||{}).value || '';
  var team     = (document.getElementById('bd-team')||{}).value || '';

  function getChecked(groupId) {
    var vals = [];
    var grp = document.getElementById(groupId);
    if (grp) grp.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){ vals.push(cb.value); });
    return vals;
  }
  var segments  = getChecked('bd-segment-group');
  var pipelines = getChecked('bd-pipeline-group');
  var sources   = getChecked('bd-source-group');
  var industries= getChecked('bd-industry-group');
  var views     = getChecked('bd-views-group');

  // ── Build SQL filter block ──
  var dateSQL = fromDate && toDate
    ? "create_date >= '" + fromDate + "' AND create_date <= '" + toDate + "'"
    : fromDate
      ? "create_date >= '" + fromDate + "'"
      : '-- no date filter applied';

  var pipeSQL = pipelines.length
    ? "pipeline_name IN ('" + pipelines.join("','") + "')"
    : "pipeline_name IN ('Sales Pipeline','PH Upsell Pipeline','Unified Channel Pipeline','TH Sales Pipeline')";

  var segSQL    = segments.length   ? "AND segment IN ('" + segments.join("','") + "')" : '';
  var sourceSQL = sources.length    ? "AND lead_source IN ('" + sources.join("','") + "')" : '';
  var indSQL    = industries.length ? "AND industry IN ('" + industries.join("','") + "')" : '';
  var repSQL    = rep.trim()
    ? "AND sales_rep IN ('" + rep.split(',').map(function(r){return r.trim();}).join("','") + "')"
    : '';
  var teamSQL   = team.trim() ? "AND team = '" + team.trim() + "'" : '';

  // ── Get selected metrics from DOM ──
  var _selectedNames = [];
  document.querySelectorAll('#builder-metrics-grid .builder-mrow').forEach(function(row) {
    var cb = row.querySelector('input[type=checkbox]');
    if (cb && cb.checked) { var n = row.getAttribute('data-n'); if (n) _selectedNames.push(n); }
  });
  var selected = _getBuilderMetrics().filter(function(m){
    return _selectedNames.indexOf(m.name) >= 0 || _builderSelectedIds.has(m.name);
  });

  var mBlock = selected.map(function(m){
    var lines = ['### ' + m.name];
    if(m.definition)        lines.push('- **Definition:** ' + m.definition);
    if(m.business_question) lines.push('- **Business Question:** ' + m.business_question);
    if(m.formula)           lines.push('- **Formula:** ' + m.formula);
    if(m.sql)               lines.push('- **SQL:**\n```sql\n' + m.sql + '\n```');
    if(m.filters)           lines.push('- **Filters:** ' + m.filters);
    if(m.exclusions)        lines.push('- **Exclusions:** ' + m.exclusions);
    return lines.join('\n');
  }).join('\n\n');

  // ── View descriptions ──
  var viewLabels = {
    summary:      'Summary KPI Cards (top-level metrics)',
    per_rep:      'Per Sales Rep breakdown table + charts',
    per_team:     'Per Team breakdown table + charts',
    per_segment:  'Per Segment breakdown (SME / ENT / Channels)',
    per_pipeline: 'Per Pipeline breakdown',
    per_industry: 'Per Industry breakdown',
    trend:        'Trend / Time-series charts (MoM, WoW)',
    funnel:       'Funnel visualization (lead → SQL → won)',
    leaderboard:  'Leaderboard ranking (rep/team performance)',
    comparison:   'Month-over-Month comparison table'
  };
  var viewList = views.length
    ? views.map(function(v){ return '- ' + (viewLabels[v] || v); }).join('\n')
    : '- Summary KPI Cards (default)';

  var prompt = 'You are building a RevOps dashboard called "' + name + '" for Sprout Solutions using Databricks SQL (shared.revops schema).\n\n'
    + '## Dashboard Configuration\n'
    + '- Dashboard Name: ' + name + '\n'
    + (fromDate ? '- Date From: ' + fromDate + '\n' : '')
    + (toDate   ? '- Date To:   ' + toDate   + '\n' : '')
    + (segments.length   ? '- Segments:  ' + segments.join(', ')   + '\n' : '')
    + (pipelines.length  ? '- Pipelines: ' + pipelines.join(', ')  + '\n' : '- Pipelines: All\n')
    + (sources.length    ? '- Lead Source: ' + sources.join(', ')  + '\n' : '')
    + (industries.length ? '- Industries: ' + industries.join(', ') + '\n' : '')
    + (rep.trim()        ? '- Sales Reps: ' + rep + '\n' : '')
    + (team.trim()       ? '- Team: ' + team + '\n' : '')
    + '\n## Views to Include\n' + viewList + '\n\n'
    + '## Metrics to Include\n\n' + mBlock + '\n\n'
    + '## Global SQL Filters (apply to ALL queries)\n'
    + '```sql\n'
    + '-- Date filter\n' + dateSQL + '\n'
    + '-- Pipeline\n' + pipeSQL + '\n'
    + (segSQL    ? '-- Segment\n'      + segSQL    + '\n' : '')
    + (sourceSQL ? '-- Lead Source\n'  + sourceSQL + '\n' : '')
    + (indSQL    ? '-- Industry\n'     + indSQL    + '\n' : '')
    + (repSQL    ? '-- Sales Rep\n'    + repSQL    + '\n' : '')
    + (teamSQL   ? '-- Team\n'         + teamSQL   + '\n' : '')
    + "-- Exclude renewals (always)\nAND deal_type NOT IN ('Renewal','Upsell - Renewal') AND LOWER(deal_name) NOT LIKE '%renewal%'\n```\n\n"
    + '## Build Instructions\n'
    + '1. Use Databricks SQL: USE CATALOG shared; USE SCHEMA revops;\n'
    + '2. Apply ALL global filters above to every query\n'
    + '3. Build as a single self-contained HTML file:\n'
    + '   - Dark theme (#030712 bg, #1DB954 accent, white text)\n'
    + '   - Responsive grid layout\n'
    + '   - Executive-level professional design\n'
    + '   - Header showing dashboard name, date range, and filters applied\n'
    + '4. Include each requested view as a clearly labeled section\n'
    + '5. Use Chart.js (CDN) for charts\n'
    + '6. Exact metric definitions and SQL are provided above — do not change business logic';

  var ta = document.getElementById('builder-prompt-output');
  if (ta) ta.value = prompt;
}'''

if ps > 0 and pe > ps:
    html = html[:ps] + new_prompt_fn + html[pe:]
    print("OK: _builderRenderPrompt fully rewritten")
else:
    print("WARN: could not find _builderRenderPrompt")

# ── 6. Bump version ───────────────────────────────────────────────────────────
html = html.replace('v20260519e', 'v20260519f')
print("OK: version bumped to v20260519f")

with open('radar_revops.html', 'w', encoding='utf-8') as f:
    f.write(html)

checks = [
    ('new CSS bd-section',      'bd-section{' in html),
    ('bd-views-grid CSS',       'bd-views-grid{' in html),
    ('bd-view-card CSS',        'bd-view-card{' in html),
    ('Step 2 new HTML',         'bd-segment-group' in html),
    ('pipeline checkboxes',     'bd-pipeline-group' in html),
    ('industry checkboxes',     'bd-industry-group' in html),
    ('views checkboxes',        'bd-views-group' in html),
    ('bd-rep input',            'id="bd-rep"' in html),
    ('bd-team input',           'id="bd-team"' in html),
    ('new prompt fn',           '_selectedNames' in html and 'viewLabels' in html),
    ('bdViewToggle fn',         'function bdViewToggle' in html),
    ('version f',               'v20260519f' in html),
]
print("")
for name, ok in checks:
    print(f"  {'OK' if ok else 'FAIL'}: {name}")
