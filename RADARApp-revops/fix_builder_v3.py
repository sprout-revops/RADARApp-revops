"""
fix_builder_v3.py

Nuclear approach: zero inline onclick/onchange on rows.
Single addEventListener on grid container reads e.target.tagName
to tell checkbox click apart from row click.

Also removes Finance metrics per user request.
"""
import json, re

with open('radar_revops.html', encoding='utf-8') as f:
    html = f.read()

m = re.search(r'const METRICS = (\[.*?\]);', html, re.DOTALL)
metrics = json.loads(m.group(1))

# ── 1. Remove Finance metrics ─────────────────────────────────────────────────
orig_count = len(metrics)
metrics = [mx for mx in metrics if mx.get('category','') != 'Finance']
print(f"Filtered: {orig_count} -> {len(metrics)} metrics (removed Finance)")

# ── 2. Re-render rows — NO inline onclick or onchange ─────────────────────────
CAT_LABELS = {
    'Finance': 'Finance', 'Funnel': 'Funnel', 'Revenue': 'Revenue',
    'Sales_Productivity': 'Sales', 'Marketing_Efficiency': 'Marketing',
    'Product_Performance': 'Product'
}

def esc(s):
    return (s or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

rows_html = ''
for i, mx in enumerate(metrics):
    name    = esc(mx.get('name', ''))
    cat     = mx.get('category', '')
    cat_lbl = esc(CAT_LABELS.get(cat, cat))
    defn    = esc(mx.get('definition', ''))
    rows_html += (
        f'<div class="builder-mrow" data-cat="{esc(cat)}" data-n="{name}" '
        f'data-name="{name.lower()}" data-def="{defn.lower()}">'
        f'<input type="checkbox">'
        f'<div class="builder-mrow-info">'
        f'<div class="builder-mrow-name">{name}</div>'
        f'<div class="builder-mrow-meta">'
        f'<span class="builder-mrow-cat">{cat_lbl}</span>'
        f'<span class="builder-mrow-def">{defn}</span>'
        f'</div></div></div>\n'
    )

start_tag = '<div class="builder-metrics-grid" id="builder-metrics-grid">'
start = html.index(start_tag)
depth, pos = 0, start
while pos < len(html):
    if html[pos:pos+4] == '<div': depth += 1
    elif html[pos:pos+6] == '</div>':
        depth -= 1
        if depth == 0: end = pos + 6; break
    pos += 1
html = html[:start] + start_tag + '\n' + rows_html + '</div>' + html[end:]
print(f"OK: re-rendered {len(metrics)} rows — no inline handlers")

# ── 3. Replace bmt + _builderInitAll with clean grid listener ─────────────────
old_bmt_block = '''// bmt = builder metric toggle — called via onchange on checkbox
function bmt(row, idx) {
  var name = row.getAttribute('data-n');
  if (!name) name = 'metric_' + idx;
  var cb = row.querySelector('input[type=checkbox]');
  var isSelected = cb ? cb.checked : !_builderSelectedIds.has(name);
  if (isSelected) { _builderSelectedIds.add(name); }
  else            { _builderSelectedIds.delete(name); }
  row.classList.toggle('selected', isSelected);
  var n = _builderSelectedIds.size;
  var el = document.getElementById('builder-selected-count');
  if (el) el.textContent = n + ' metric' + (n !== 1 ? 's' : '') + ' selected';
  var btn = document.getElementById('builder-next-1');
  if (btn) btn.disabled = (n === 0);
}'''

new_bmt_block = '''// _bmtUpdate: called after checkbox state is known
function _bmtUpdate(row, cb) {
  var name = row.getAttribute('data-n');
  if (!name) return;
  if (cb.checked) { _builderSelectedIds.add(name); }
  else            { _builderSelectedIds.delete(name); }
  row.classList.toggle('selected', cb.checked);
  var n = _builderSelectedIds.size;
  var el = document.getElementById('builder-selected-count');
  if (el) el.textContent = n + ' metric' + (n !== 1 ? 's' : '') + ' selected';
  var btn = document.getElementById('builder-next-1');
  if (btn) btn.disabled = (n === 0);
}
// Keep bmt() as a stub so any cached HTML onclick="bmt(...)" won't throw
function bmt() {}'''

if old_bmt_block in html:
    html = html.replace(old_bmt_block, new_bmt_block, 1)
    print("OK: replaced bmt with _bmtUpdate")
else:
    # fallback
    bmt_s = html.find('// bmt = builder metric toggle')
    bmt_e = html.find('\n}', html.find('\n}', bmt_s) + 2) + 2  # end of outer function
    if bmt_s > 0:
        html = html[:bmt_s] + new_bmt_block + html[bmt_e:]
        print("OK: replaced bmt with _bmtUpdate (fallback)")
    else:
        print("WARN: could not find bmt block")

# ── 4. Replace _builderInitAll to attach the single grid listener ─────────────
old_init = '''function _builderInitAll() {
  if (_builderInited) return;
  _builderInited = true;
  _builderInitCatFilters();
  builderFilterMetrics();
  _builderUpdateCount();
  // Inline onclick="bmt(this,idx)" on each row handles all clicks
}'''

new_init = '''function _builderInitAll() {
  if (_builderInited) return;
  _builderInited = true;
  _builderInitCatFilters();
  builderFilterMetrics();
  _builderUpdateCount();
  // Single grid click listener — no inline handlers on rows
  var grid = document.getElementById('builder-metrics-grid');
  if (grid) {
    grid.addEventListener('click', function(e) {
      var row = e.target.closest('.builder-mrow');
      if (!row) return;
      var cb = row.querySelector('input[type=checkbox]');
      if (!cb) return;
      // If user clicked anything other than the checkbox, toggle it manually
      if (e.target.tagName !== 'INPUT') {
        cb.checked = !cb.checked;
      }
      // cb.checked now has the correct new state — update everything
      _bmtUpdate(row, cb);
    });
  }
}'''

if old_init in html:
    html = html.replace(old_init, new_init, 1)
    print("OK: _builderInitAll updated with grid click listener")
else:
    print("WARN: _builderInitAll pattern not found — trying regex")
    html = re.sub(
        r'function _builderInitAll\(\) \{.*?^}',
        new_init,
        html,
        count=1,
        flags=re.DOTALL | re.MULTILINE
    )
    print("OK: _builderInitAll replaced via regex")

# ── 5. Also remove BUILDER_CATS Finance entry (hide it from filter too) ───────
html = html.replace(
    "var BUILDER_CATS = ['All','Finance','Funnel','Revenue','Sales_Productivity','Marketing_Efficiency','Product_Performance'];",
    "var BUILDER_CATS = ['All','Funnel','Revenue','Sales_Productivity','Marketing_Efficiency','Product_Performance'];"
)
print("OK: Finance removed from BUILDER_CATS filter")

# ── 6. Bump version marker ────────────────────────────────────────────────────
html = html.replace('v20260519b', 'v20260519c')
print("OK: version bumped to v20260519c")

with open('radar_revops.html', 'w', encoding='utf-8') as f:
    f.write(html)

# ── Verify ────────────────────────────────────────────────────────────────────
checks = [
    ('grid addEventListener present',   'grid.addEventListener' in html),
    ('e.target.tagName check',          'e.target.tagName' in html),
    ('_bmtUpdate function',             'function _bmtUpdate' in html),
    ('no inline onclick on rows',       'onclick="bmt' not in html),
    ('no inline onchange on rows',      'onchange="bmt' not in html),
    ('data-n in rows',                  'data-n="' in html),
    ('Finance removed from cats',       "'Finance'" not in html.split('BUILDER_CATS')[1][:200] if 'BUILDER_CATS' in html else False),
    ('version v19c',                    'v20260519c' in html),
]
print("")
for name, ok in checks:
    print(f"  {'OK' if ok else 'FAIL'}: {name}")
