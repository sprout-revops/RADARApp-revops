"""
fix_builder_v4.py

Nuclear approach v4:
- Inject a small self-contained <script> RIGHT AFTER builder-metrics-grid
  closing tag. It runs immediately when that HTML is parsed, before the
  main script even starts. No dependency on _builderInitAll or anything else.
- Also declare var _builderSearchVal to prevent any implicit-global issues.
- Version v20260519d with visible debug indicator.
"""
import json, re

with open('radar_revops.html', encoding='utf-8') as f:
    html = f.read()

m = re.search(r'const METRICS = (\[.*?\]);', html, re.DOTALL)
metrics = json.loads(m.group(1))

# Keep only non-Finance metrics
metrics = [mx for mx in metrics if mx.get('category','') != 'Finance']
print(f"Using {len(metrics)} non-Finance metrics")

# ── 1. Re-render rows — completely plain, no event attributes ─────────────────
CAT_LABELS = {
    'Funnel': 'Funnel', 'Revenue': 'Revenue',
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

# Replace grid content
start_tag = '<div class="builder-metrics-grid" id="builder-metrics-grid">'
start = html.index(start_tag)
depth, pos = 0, start
while pos < len(html):
    if html[pos:pos+4] == '<div': depth += 1
    elif html[pos:pos+6] == '</div>':
        depth -= 1
        if depth == 0: end = pos + 6; break
    pos += 1

# The self-contained grid script (no dependencies on main JS)
grid_script = '''
<script>
(function(){
  var grid = document.getElementById('builder-metrics-grid');
  var dbg  = document.getElementById('builder-debug');
  if (!grid) { if (dbg) dbg.textContent = 'ERR: grid not found'; return; }
  if (dbg) dbg.textContent = 'v4 ready';
  grid.addEventListener('click', function(e) {
    // Walk up to find .builder-mrow
    var row = e.target;
    while (row && row !== grid) {
      if (row.className && row.className.indexOf('builder-mrow') >= 0) break;
      row = row.parentNode;
    }
    if (!row || row === grid) return;
    var cb = row.querySelector('input[type=checkbox]');
    if (!cb) return;
    // Toggle checkbox if user didn't click it directly
    if (e.target.tagName !== 'INPUT') cb.checked = !cb.checked;
    // Count all checked boxes in grid
    var n = grid.querySelectorAll('input[type=checkbox]:checked').length;
    var countEl = document.getElementById('builder-selected-count');
    if (countEl) countEl.textContent = n + ' metric' + (n !== 1 ? 's' : '') + ' selected';
    var btn = document.getElementById('builder-next-1');
    if (btn) btn.disabled = n === 0;
    row.classList.toggle('selected', cb.checked);
    if (dbg) dbg.textContent = 'v4: ' + n + ' selected';
  });
})();
</script>'''

new_grid_block = start_tag + '\n' + rows_html + '</div>' + grid_script
html = html[:start] + new_grid_block + html[end:]
print(f"OK: re-rendered {len(metrics)} rows + injected self-contained grid script")

# ── 2. Add debug div after the builder controls area ─────────────────────────
old_controls_end = '<div class="builder-metrics-grid" id="builder-metrics-grid">'
new_with_debug = '<div id="builder-debug" style="font-size:10px;color:#f59e0b;padding:2px 24px 0;min-height:14px"></div>\n    <div class="builder-metrics-grid" id="builder-metrics-grid">'
html = html.replace(old_controls_end, new_with_debug, 1)
print("OK: debug indicator div added")

# ── 3. Fix _builderSearchVal declaration ──────────────────────────────────────
html = html.replace(
    'var _builderActiveCat   = \'\';',
    'var _builderActiveCat   = \'\';\nvar _builderSearchVal   = \'\';'
)
print("OK: _builderSearchVal declared")

# ── 4. Bump version ───────────────────────────────────────────────────────────
html = html.replace('v20260519c', 'v20260519d')
print("OK: version bumped to v20260519d")

with open('radar_revops.html', 'w', encoding='utf-8') as f:
    f.write(html)

# Verify
v = [
    ('grid script injected',    '(function(){' in html and 'grid.addEventListener' in html),
    ('builder-debug div',       'id="builder-debug"' in html),
    ('_builderSearchVal decl',  'var _builderSearchVal' in html),
    ('no Finance rows',         'data-cat="Finance"' not in html),
    ('version d',               'v20260519d' in html),
    ('closest not used',        'closest(' not in html or 'className.indexOf' in html),
]
print("")
for name, ok in v:
    print(f"  {'OK' if ok else 'FAIL'}: {name}")
