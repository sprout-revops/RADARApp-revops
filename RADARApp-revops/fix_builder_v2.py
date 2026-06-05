"""
fix_builder_v2.py

Switch from onclick-based toggle to onchange-based toggle.
- Checkbox gets: onclick="event.stopPropagation()" onchange="bmt(this.parentNode,N)"
- Row gets: onclick="this.querySelector('input').click()"
- bmt reads cb.checked directly (no Set-based toggle logic)
- Version marker bumped to v2 so user can confirm cache cleared
"""
import json, re

with open('radar_revops.html', encoding='utf-8') as f:
    html = f.read()

m = re.search(r'const METRICS = (\[.*?\]);', html, re.DOTALL)
if not m:
    print("ERROR: could not find METRICS"); exit(1)
metrics = json.loads(m.group(1))
print(f"Found {len(metrics)} metrics")

# ── 1. Replace bmt function ───────────────────────────────────────────────────
# Find and replace the entire bmt function
bmt_start = html.find('// bmt = builder metric toggle')
bmt_end   = html.find('\n}', bmt_start) + 2   # end of function

if bmt_start < 0:
    print("ERROR: bmt function not found"); exit(1)

new_bmt = '''// bmt = builder metric toggle — called via onchange on checkbox
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

html = html[:bmt_start] + new_bmt + html[bmt_end:]
print("OK: bmt() updated to read cb.checked directly")

# ── 2. Re-render rows with new event pattern ──────────────────────────────────
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
        # Row click: programmatically clicks the checkbox -> triggers onchange -> bmt
        f'<div class="builder-mrow" data-cat="{esc(cat)}" data-n="{name}" '
        f'data-name="{name.lower()}" data-def="{defn.lower()}" '
        f'onclick="this.querySelector(\'input\').click()">'
        # Checkbox: stopPropagation prevents row onclick re-firing; onchange calls bmt
        f'<input type="checkbox" onclick="event.stopPropagation()" onchange="bmt(this.parentNode,{i})">'
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
print(f"OK: re-rendered {len(metrics)} rows (onchange pattern)")

# ── 3. Bump version marker ────────────────────────────────────────────────────
html = html.replace('<!-- BUILDER v20260519 -->', '<!-- BUILDER v20260519b -->')
# Also add visible version in the panel title
OLD_TITLE = '<div class="builder-panel-title">Step 1 of 3 — Select Metrics</div>'
NEW_TITLE  = '<div class="builder-panel-title">Step 1 of 3 — Select Metrics <span style="font-size:10px;opacity:.4;font-weight:400">v20260519b</span></div>'
if OLD_TITLE in html:
    html = html.replace(OLD_TITLE, NEW_TITLE)
    print("OK: visible version tag added to panel title")
else:
    print("WARN: panel title not found for version tag")

with open('radar_revops.html', 'w', encoding='utf-8') as f:
    f.write(html)

# ── Verify ────────────────────────────────────────────────────────────────────
v = [
    ('bmt reads cb.checked',    'cb.checked' in html),
    ('onchange in rows',        'onchange="bmt(' in html),
    ('stopPropagation in rows', 'event.stopPropagation()' in html),
    ('row uses .click()',       "querySelector('input').click()" in html),
    ('data-n in rows',          'data-n="' in html),
    ('version marker v19b',     'v20260519b' in html),
]
print("")
for name, ok in v:
    status = "OK" if ok else "FAIL"
    print(f"  {status}: {name}")
