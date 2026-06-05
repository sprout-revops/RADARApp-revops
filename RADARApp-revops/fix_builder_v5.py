"""
fix_builder_v5.py — Full 3-step fix

Problems:
1. v4 grid script never synced _builderSelectedIds → Next button guard failed
2. builderGoStep(2) checked _builderSelectedIds.size, not DOM
3. _builderRenderChips used _builderSelectedIds, not DOM
4. _builderRenderPrompt used _builderSelectedIds to filter metrics

Fix strategy: make ALL steps read from DOM checked boxes as truth.
_builderSelectedIds is also synced for backward compat but DOM is primary.
"""
import re

with open('radar_revops.html', encoding='utf-8') as f:
    html = f.read()

# ── HELPER: get selected names from DOM (shared logic in JS comments) ─────────

# ── 1. Replace the v4 inline grid script ──────────────────────────────────────
old_grid_script = '''<script>
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

new_grid_script = '''<script>
(function(){
  var grid = document.getElementById('builder-metrics-grid');
  var dbg  = document.getElementById('builder-debug');
  if (!grid) { if (dbg) dbg.textContent = 'ERR: grid not found'; return; }
  if (dbg) dbg.textContent = 'v5 ready';
  grid.addEventListener('click', function(e) {
    // Walk up to find .builder-mrow (no closest() for max compat)
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
    // Sync _builderSelectedIds (used by step 2 & 3)
    var name = row.getAttribute('data-n');
    if (name && window._builderSelectedIds) {
      if (cb.checked) window._builderSelectedIds.add(name);
      else            window._builderSelectedIds.delete(name);
    }
    // Update counter and Next button
    var n = grid.querySelectorAll('input[type=checkbox]:checked').length;
    var countEl = document.getElementById('builder-selected-count');
    if (countEl) countEl.textContent = n + ' metric' + (n !== 1 ? 's' : '') + ' selected';
    var btn = document.getElementById('builder-next-1');
    if (btn) btn.disabled = n === 0;
    row.classList.toggle('selected', cb.checked);
    if (dbg) dbg.textContent = 'v5: ' + n + ' selected';
  });
})();
</script>'''

if old_grid_script in html:
    html = html.replace(old_grid_script, new_grid_script, 1)
    print("OK: v4 grid script updated to v5 (syncs _builderSelectedIds)")
else:
    print("WARN: old grid script not found exactly — trying partial replace")
    html = re.sub(
        r'<script>\s*\(function\(\)\{.*?dbg\.textContent = \'v4: \' \+ n \+ \' selected\';\s*\}\);\s*\}\)\(\);\s*</script>',
        new_grid_script,
        html,
        count=1,
        flags=re.DOTALL
    )
    print("OK: v4 script replaced via regex")

# ── 2. Fix builderGoStep — use DOM count as primary truth ─────────────────────
old_go = '''function builderGoStep(n) {
  if (n===2 && _builderSelectedIds.size===0) return;
  if (n===2) _builderRenderChips();'''

new_go = '''function builderGoStep(n) {
  // Use DOM as source of truth for selected count
  var _domCount = document.querySelectorAll('#builder-metrics-grid input[type=checkbox]:checked').length;
  if (n===2 && _domCount===0) return;
  if (n===2) _builderRenderChips();'''

if old_go in html:
    html = html.replace(old_go, new_go, 1)
    print("OK: builderGoStep uses DOM count")
else:
    print("WARN: builderGoStep pattern not found")

# ── 3. Fix _builderRenderChips — read from DOM ────────────────────────────────
old_chips = '''function _builderRenderChips() {
  var wrap = document.getElementById('builder-chips');
  if (!wrap) return;
  wrap.innerHTML = Array.from(_builderSelectedIds).map(function(name){
    return '<span class="builder-chip">'+name+'</span>';
  }).join('');
}'''

new_chips = '''function _builderRenderChips() {
  var wrap = document.getElementById('builder-chips');
  if (!wrap) return;
  var names = [];
  document.querySelectorAll('#builder-metrics-grid .builder-mrow').forEach(function(row) {
    var cb = row.querySelector('input[type=checkbox]');
    if (cb && cb.checked) {
      var n = row.getAttribute('data-n');
      if (n) names.push(n);
    }
  });
  wrap.innerHTML = names.length
    ? names.map(function(n){ return '<span class="builder-chip">'+n+'</span>'; }).join('')
    : '<span style="color:rgba(255,255,255,.3);font-size:13px">No metrics selected</span>';
}'''

if old_chips in html:
    html = html.replace(old_chips, new_chips, 1)
    print("OK: _builderRenderChips reads from DOM")
else:
    print("WARN: _builderRenderChips pattern not found")

# ── 4. Fix _builderRenderPrompt — get selected names from DOM ─────────────────
old_prompt_sel = "  var selected = _getBuilderMetrics().filter(function(m){return _builderSelectedIds.has(m.name);});"
new_prompt_sel = '''  // Get selected metric names from DOM (DOM is source of truth)
  var _selectedNames = [];
  document.querySelectorAll('#builder-metrics-grid .builder-mrow').forEach(function(row) {
    var cb = row.querySelector('input[type=checkbox]');
    if (cb && cb.checked) { var n = row.getAttribute('data-n'); if (n) _selectedNames.push(n); }
  });
  var selected = _getBuilderMetrics().filter(function(m){
    return _selectedNames.indexOf(m.name) >= 0 || _builderSelectedIds.has(m.name);
  });'''

if old_prompt_sel in html:
    html = html.replace(old_prompt_sel, new_prompt_sel, 1)
    print("OK: _builderRenderPrompt reads from DOM")
else:
    print("WARN: _builderRenderPrompt selected line not found")

# ── 5. Fix builderGoStep reset (step 1) — also clear _builderSelectedIds ──────
# Already does this; just ensure DOM count is used in _builderUpdateCount too
old_update = '''function _builderUpdateCount() {
  var n = _builderSelectedIds.size;
  var el = document.getElementById('builder-selected-count');
  if (el) el.textContent = n + ' metric' + (n!==1?'s':'') + ' selected';
  var btn = document.getElementById('builder-next-1');
  if (btn) btn.disabled = n === 0;
}'''

new_update = '''function _builderUpdateCount() {
  // Use DOM as source of truth
  var n = document.querySelectorAll('#builder-metrics-grid input[type=checkbox]:checked').length;
  if (isNaN(n)) n = _builderSelectedIds.size;
  var el = document.getElementById('builder-selected-count');
  if (el) el.textContent = n + ' metric' + (n!==1?'s':'') + ' selected';
  var btn = document.getElementById('builder-next-1');
  if (btn) btn.disabled = n === 0;
}'''

if old_update in html:
    html = html.replace(old_update, new_update, 1)
    print("OK: _builderUpdateCount uses DOM count")
else:
    print("WARN: _builderUpdateCount pattern not found")

# ── 6. Bump version ───────────────────────────────────────────────────────────
html = html.replace('v20260519d', 'v20260519e')
print("OK: version bumped to v20260519e")

with open('radar_revops.html', 'w', encoding='utf-8') as f:
    f.write(html)

# Verify
checks = [
    ('v5 grid script',          "'v5 ready'" in html),
    ('_builderSelectedIds sync', 'window._builderSelectedIds' in html),
    ('builderGoStep DOM count',  '_domCount' in html),
    ('chips from DOM',           'getAttribute(\'data-n\')' in html),
    ('prompt from DOM',          '_selectedNames' in html),
    ('version e',                'v20260519e' in html),
]
print("")
for name, ok in checks:
    print(f"  {'OK' if ok else 'FAIL'}: {name}")
