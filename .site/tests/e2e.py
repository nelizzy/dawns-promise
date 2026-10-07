"""Browser checks against a built fixture (needs `pip install playwright`, a Chromium, and a static server).
Usage: node tests/build-fixture.mjs /tmp/fx && (cd /tmp/fx && python3 -m http.server 8124 &) && python3 tests/e2e.py http://localhost:8124
"""
import sys
from playwright.sync_api import sync_playwright
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8124').rstrip('/')
fails = []
def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1300, 'height': 1000})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_' not in m.text and 'Failed to load resource' not in m.text else None)
    def text(url, sel):
        pg.goto(BASE + url, wait_until='networkidle'); pg.wait_for_timeout(1200)
        return pg.evaluate("s=>[...document.querySelectorAll(s)].map(e=>e.innerText)", sel)
    home = text('/home/', '.base-block')
    check(len(home) == 4, 'home has 4 base blocks')
    check('Neuromancer (1984)' in home[0] and 'Dune (1965)' in home[0], 'table view shows formula column')
    check('Average' in home[0] and '8.5' in home[0], 'table summary row (Average price = 8.5)')
    check('Checked' in home[0] and '2' in home[0], 'checkbox summary')
    check('Dune' in home[1] and '19' in home[1], 'cards view shows formula.value')
    check('Dune' in home[3] and 'Datacore Demo' in home[3], 'this.file.hasLink(file) resolves against embedding note')
    pg.goto(BASE + '/home/', wait_until='networkidle'); pg.wait_for_timeout(800)
    sel = pg.query_selector_all('.bases-toolbar-views')[0]
    sel.select_option(label='Grouped'); pg.wait_for_timeout(300)
    check('status' in pg.evaluate("()=>document.querySelectorAll('.base-block')[2].innerText") or 'Reading status' in pg.evaluate("()=>document.querySelectorAll('.base-block')[2].innerText"), 'view switcher + groupBy heading')
    broken = text('/broken-base/', '.base-block')
    check(any('Filter error' in t for t in broken), 'broken filter is reported visibly')
    check(any('mystery' in t for t in broken), 'unknown setting is reported')
    dc = text('/datacore-demo/', '.datacore-block')
    check(len(dc) == 7, 'seven datacore blocks')
    check('Dune' in dc[0] and '1965' in dc[0], 'dc.Table over @page query')
    check('LOADED!' in dc[1], 'dc.require of a vault script')
    check('reread the appendix' in dc[2] and 'buy a copy' not in dc[2], '@task query with $completed filter')
    check('1 section(s): Plot' in dc[3], 'TSX + @section query')
    check('bold' in dc[4] and 'Neuromancer' in dc[4], 'dc.Markdown + dc.VanillaTable')
    check('boom on purpose' in dc[5], 'a throwing block shows its error')
    check('[shared]' in dc[6] and '#md' in dc[6], 'dc.require of .jsx and Markdown (headerLink) components in the unpublished Components folder')
    real = [e for e in errs if 'boom on purpose' not in e]
    check(not real, 'no unexpected console errors: ' + '; '.join(real)[:200])
    b.close()
sys.exit(1 if fails else 0)
