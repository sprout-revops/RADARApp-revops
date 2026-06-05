import json, re

with open('radar_revops.html', encoding='utf-8') as f:
    html = f.read()

# Extract METRICS
m = re.search(r'const METRICS = (\[.*?\]);', html, re.DOTALL)
metrics = json.loads(m.group(1))

# Exclude Finance (same as DataPedia filter rule for builder)
metrics = [mx for mx in metrics if mx.get('category','') != 'Finance']

CAT_LABELS = {
    'Funnel': 'Funnel', 'Revenue': 'Revenue',
    'Sales_Productivity': 'Sales', 'Marketing_Efficiency': 'Marketing',
    'Product_Performance': 'Product', 'Customer_Health': 'CS',
    'Revenue_Risk': 'Rev Risk'
}

def esc(s):
    return (s or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;')

rows_html = ''
for mx in metrics:
    name    = esc(mx.get('name',''))
    cat     = mx.get('category','')
    cat_lbl = esc(CAT_LABELS.get(cat, cat))
    defn    = esc(mx.get('definition',''))
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

# Replace builder-metrics-grid content
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

with open('radar_revops.html', 'w', encoding='utf-8') as f:
    f.write(html)
print(f'Done - pre-rendered {len(metrics)} non-Finance metrics in builder')
