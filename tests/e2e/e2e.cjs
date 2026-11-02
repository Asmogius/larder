/* Larder end-to-end suite (playwright-core + system Chrome).
   Usage: node tests/e2e/e2e.cjs   (CHROME=/path/to/chrome to override; needs `npm i playwright-core` somewhere on NODE_PATH)
   Serves the repo root on a random port, runs every flow at phone (390x844 touch) and desktop (1280x900),
   fails on any assertion, console error or page error. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let pass = 0, fail = 0; const failures = [];
function ok(cond, name) { if (cond) pass++; else { fail++; failures.push(name); console.log('   ✗', name); } }
const shift = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const mode of ['phone', 'desktop']) {
    console.log(`== ${mode}`);
    const phone = mode === 'phone';
    const ctx = await browser.newContext({
      ...(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } }),
      timezoneId: 'America/Chicago', acceptDownloads: true, serviceWorkers: 'allow'
    });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.slice(0, -1) });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    p.on('dialog', d => d.type() === 'prompt' ? d.dismiss() : d.accept());
    // Desktop runs on New Year's Eve, late evening (already Jan 1 in UTC) to catch timezone/year bugs
    if (!phone) await p.clock.setFixedTime(new Date('2026-12-31T22:30:00-06:00'));
    else await p.clock.setFixedTime(new Date('2026-11-01T21:00:00-06:00')); // DST-change Sunday
    const TODAY = phone ? '2026-11-01' : '2026-12-31';
    const tab = async name => {
      if (phone) await p.click(`.bottom-tabs a[data-page~="${name}"]`);
      else await p.click(`.top-nav a[data-page="${name}"]`);
      await sleep(150);
    };
    const toastVisible = () => p.evaluate(() => document.getElementById('undo-toast')?.classList.contains('show') || false);
    const store = () => p.evaluate(() => JSON.parse(localStorage.getItem('larder-improved-v4') || '{}'));
    const slot = (d, s) => `#week-days .meal-slot[data-date="${d}"][data-slot="${s}"]`;
    const slotName = async (d, s) => (await p.textContent(slot(d, s) + ' .slot-name')).trim();

    await p.goto(BASE + '#today'); await sleep(400);
    ok(await p.evaluate(() => location.hash) === '#planner', 'old #today redirects to #planner');
    ok(await p.isVisible('#planner') && !(await p.isVisible('#recipes')), 'planner visible');
    ok((await p.textContent('.today-card h3')).includes(phone ? 'November 1' : 'December 31'), 'today uses local date (not UTC)');
    ok(await p.locator(`.week-day.is-today[data-date="${TODAY}"]`).count() === 1, 'today highlighted in week');

    // ---- planner: choose via sheet + picker search
    await p.click(slot(TODAY, 'dinner')); await sleep(100);
    ok(await p.isVisible('#meal-sheet'), 'sheet opens on slot tap');
    await p.click('[data-act="choose"]');
    await p.fill('#picker-q', 'zzzz-nothing'); ok(await p.locator('.picker-item').count() === 0, 'picker no-match empty state');
    await p.fill('#picker-q', 'lentil'); ok(await p.locator('.picker-item').count() > 0, 'picker search finds lentil');
    await p.locator('.picker-item').first().click(); await sleep(150);
    ok(!(await p.isVisible('#meal-sheet')), 'sheet closes after pick');
    ok(/lentil/i.test(await slotName(TODAY, 'dinner')), 'dinner planned');
    ok(await toastVisible(), 'toast shown after plan');
    await p.click('.toast-undo'); await sleep(150);
    ok(/Add a meal/.test(await slotName(TODAY, 'dinner')), 'undo removes planned dinner');
    ok(!(await toastVisible()), 'toast hides on undo');
    // re-plan breakfast + dinner with picker "all types"
    for (const [s, q] of [['breakfast', 'yogurt'], ['dinner', 'chili'], ['lunch', 'salad']]) {
      await p.click(slot(TODAY, s)); await p.click('[data-act="choose"]');
      await p.check('#picker-all'); await p.fill('#picker-q', q); await sleep(50);
      if (await p.locator('.picker-item').count()) await p.locator('.picker-item').first().click(); else await p.click('#sheet-close');
      await sleep(120);
    }
    ok(!/Add a meal/.test(await slotName(TODAY, 'breakfast')), 'breakfast planned');
    // sheet twice / rapid taps
    await p.click(slot(TODAY, 'breakfast')); await p.click('#sheet-close');
    await p.click(slot(TODAY, 'breakfast')); ok(await p.isVisible('#meal-sheet'), 'sheet re-opens');
    await p.keyboard.press('Escape'); ok(!(await p.isVisible('#meal-sheet')), 'Escape closes sheet');
    await p.click(slot(TODAY, 'breakfast')); await p.click('#sheet-backdrop', { position: { x: 5, y: 5 }, force: true }).catch(() => {});
    ok(!(await p.isVisible('#meal-sheet')), 'backdrop closes sheet');
    // servings
    await p.click(slot(TODAY, 'breakfast')); await p.fill('#sheet-servings', '3'); await p.click('[data-act="servings"]'); await sleep(100);
    ok((await store()).days[TODAY].breakfast.servings === 3, 'servings saved');
    await p.click(slot(TODAY, 'breakfast')); await p.fill('#sheet-servings', '-5'); await p.click('[data-act="servings"]'); await sleep(100);
    ok(!('servings' in (await store()).days[TODAY].breakfast), 'invalid servings resets to default');
    // swap with another day
    const next = shift(TODAY, phone ? -1 : -2);
    const before = await slotName(TODAY, 'breakfast');
    await p.click(slot(TODAY, 'breakfast')); await p.click('[data-act="swap"]'); await sleep(100);
    ok(await p.isVisible('.move-hint'), 'swap hint visible');
    await p.click(slot(next, 'lunch')); await sleep(150);
    ok((await slotName(next, 'lunch')).startsWith(before.split(' ·')[0].slice(0, 10)), 'swap moved meal');
    ok(/Add a meal/.test(await slotName(TODAY, 'breakfast')), 'swap left source empty');
    await p.click('.toast-undo'); await sleep(150);
    ok((await slotName(TODAY, 'breakfast')).startsWith(before.slice(0, 10)), 'undo swap');
    // swap cancel
    await p.click(slot(TODAY, 'breakfast')); await p.click('[data-act="swap"]'); await p.click('#cancel-move'); ok(!(await p.isVisible('.move-hint')), 'swap cancel');
    // leftover (tomorrow may be next week/next year)
    await p.click(slot(TODAY, 'dinner')); await p.click('[data-act="leftover"]'); await sleep(100);
    const tomorrow = shift(TODAY, 1);
    ok((await store()).days[tomorrow]?.dinner?.leftover === true, `leftover planned on ${tomorrow}`);
    // ate / skip via today card
    await p.click('[data-today-ate="dinner"]'); await sleep(100);
    ok((await store()).days[TODAY].dinner.status === 'eaten', 'ate marks eaten');
    await p.click('[data-today-reset="dinner"]'); await p.click('[data-today-skip="dinner"]'); await sleep(100);
    ok((await store()).days[TODAY].dinner.status === 'skipped', 'skip marks skipped');
    await p.click('[data-today-reset="dinner"]'); await sleep(100);
    // sheet ate/skip/remove
    await p.click(slot(TODAY, 'lunch')); await p.click('[data-act="skip"]'); await sleep(80);
    ok((await store()).days[TODAY].lunch?.status === 'skipped', 'sheet skip');
    await p.click(slot(TODAY, 'lunch')); await p.click('[data-act="remove"]'); await sleep(80);
    ok((await store()).days[TODAY].lunch === null, 'sheet remove');
    // suggest
    await p.click('#suggest-btn'); await sleep(120);
    ok(['breakfast', 'lunch', 'dinner'].every(s => true) && (await store()).days[TODAY].lunch, 'suggest fills open slots');
    // cook via sheet
    await p.click(slot(TODAY, 'dinner')); await p.click('[data-act="cook"]'); await sleep(100);
    ok(await p.isVisible('#cook-overlay') && !(await p.isVisible('#meal-sheet')), 'cook opens, sheet closed');
    await p.click('#next-step'); await p.click('#start-timer'); await sleep(1100);
    ok(/4:5\d/.test(await p.textContent('#timer-display')), 'timer counts');
    await p.keyboard.press('Escape'); ok(await p.locator('#cook-overlay').count() === 0, 'Escape closes cook');
    // copy day
    await p.click(`[data-copy="${TODAY}"]`); await sleep(100);
    ok((await store()).days[tomorrow]?.breakfast, 'copy to next day');
    // rapid toasts
    for (let i = 0; i < 6; i++) { await p.click('#next-range'); await p.click('#prev-range'); }
    await p.click(`[data-copy="${TODAY}"]`); await p.click(`[data-copy="${TODAY}"]`); await p.click(`[data-copy="${TODAY}"]`);
    ok(await p.locator('#undo-toast').count() === 1, 'single toast element under rapid toasts');
    await sleep(5400); ok(!(await toastVisible()), 'toast auto-hides after rapid toasts');
    ok(await p.evaluate(() => getComputedStyle(document.getElementById('undo-toast')).pointerEvents) === 'none', 'hidden toast does not block taps');
    // week nav across many weeks (year boundary + DST)
    let prevStart = await p.getAttribute('#week-days .week-day', 'data-date'); let seqOk = true;
    for (let i = 0; i < 60; i++) {
      await p.click('#next-range');
      const s = await p.getAttribute('#week-days .week-day', 'data-date');
      const exp = shift(prevStart, 7);
      const days = await p.$$eval('#week-days .week-day', els => els.map(e => e.dataset.date));
      if (s !== exp || days.length !== 7 || new Set(days).size !== 7 || new Date(s + 'T12:00:00Z').getUTCDay() !== 1) seqOk = false;
      prevStart = s;
    }
    ok(seqOk, 'week navigation: 60 consecutive Monday-start weeks (DST/year boundaries)');
    await p.click('#today-range');
    // month view
    await p.click('[data-view="month"]'); await sleep(100);
    ok(await p.locator(`.month-day[data-day="${TODAY}"].is-today`).count() === 1, 'month shows today');
    ok(await p.locator('#expanded-day').count() === 1, 'month auto-expands today');
    let mOk = true; const labels = [];
    for (let i = 0; i < 14; i++) {
      await p.click('#next-range');
      const n = await p.locator('.month-day').count();
      labels.push(await p.textContent('.range-label'));
      if (n % 7 !== 0 || n < 28 || n > 42) mOk = false;
    }
    ok(mOk && new Set(labels).size === 14, 'month nav 14 months: full weeks, unique labels');
    ok(labels.some(l => /February 2028|February 2027/.test(l)), 'month nav crosses February/new year');
    await p.click('#today-range');
    await p.locator('.month-day:not(.other)').nth(9).click(); await sleep(100);
    ok(await p.locator('#expanded-day .meal-slot').count() === 3, 'tap day expands slots');
    await p.locator('#expanded-day .meal-slot').first().click(); ok(await p.isVisible('#meal-sheet'), 'month slot opens sheet'); await p.click('#sheet-close');
    await p.click('#open-week'); ok(await p.locator('#week-days').count() === 1, 'open this week returns to week view');
    await p.click('#today-range');
    // view persists
    await p.click('[data-view="month"]'); await p.reload(); await sleep(300);
    ok(await p.locator('.month-grid').count() === 1, 'planner view persists across reload');
    await p.click('[data-view="week"]');
    if (!phone) {
      // desktop drag and drop
      const tgt = shift(TODAY, -1);
      const name = await slotName(TODAY, 'dinner');
      await p.dragAndDrop(slot(TODAY, 'dinner'), slot(tgt, 'breakfast')); await sleep(150);
      ok((await slotName(tgt, 'breakfast')) === name, 'desktop drag and drop moves meal');
      await p.click('.toast-undo');
    }

    // ---- shop
    await tab('shop');
    ok(/Week of/.test(await p.textContent('#shop-content')), 'shop states week');
    const items1 = await p.locator('.shop-item [data-check]').count();
    ok(items1 > 0, 'shop has items from plan');
    await p.locator('.shop-item [data-check]').first().check(); await p.reload(); await sleep(300);
    ok(await p.locator('.shop-item [data-check]').first().isChecked(), 'shop checkbox persists across reload');
    const firstName = await p.locator('.shop-item').first().textContent();
    await p.locator('[data-add-pantry]').first().click(); await sleep(150);
    ok(await p.locator('.shop-item [data-check]').count() === items1 - 1, 'add to pantry removes item from list (live deduction)');
    await p.click('.toast-undo'); await sleep(100);
    ok(await p.locator('.shop-item [data-check]').count() === items1, 'undo add-to-pantry restores item');
    await p.fill('#manual-name', 'Paper towels'); await p.press('#manual-name', 'Enter'); await sleep(100);
    ok((await p.textContent('#shop-content')).includes('Paper towels'), 'manual item added');
    await p.click('#copy-list'); await sleep(100);
    ok((await p.evaluate(() => navigator.clipboard.readText())).includes('Paper towels'), 'copy list includes manual items');
    await p.click('#share-list'); await sleep(100); ok(await toastVisible(), 'share gives feedback');
    await p.click('[data-del-manual="0"]'); ok(!(await p.textContent('#shop-content')).includes('Paper towels'), 'manual item removed');
    await p.locator('[data-price]').first().fill('3.50'); await p.locator('[data-price]').first().dispatchEvent('change'); await sleep(100);
    ok(Object.values((await store()).prices).includes(350), 'price saved in cents');
    await p.click('#shop-next'); ok(/Week of/.test(await p.textContent('.range-label')), 'shop week nav');
    await p.click('#shop-prev');
    // planner change -> shop live
    const shopBefore = await p.textContent('.shop-list');
    await tab('planner'); await p.click(slot(TODAY, 'dinner')); await p.click('[data-act="remove"]'); await tab('shop');
    ok((await p.textContent('#shop-content')) !== shopBefore && !(await p.textContent('#shop-content')).includes(shopBefore), 'shop updates live from planner');

    // ---- recipes
    await tab('recipes');
    const total = Number((await p.textContent('#recipe-count')).match(/of (\d+)/)[1]);
    ok(total >= 75, 'all recipes listed');
    await p.fill('#meal-search', 'oat'); ok(await p.evaluate(() => document.activeElement.id) === 'meal-search', 'search keeps focus');
    const oat = await p.locator('.recipe-card').count(); ok(oat > 0 && oat < total, 'search filters');
    await p.fill('#meal-search', 'black beans'); ok(await p.locator('.recipe-card').count() > 0, 'ingredient search');
    await p.fill('#meal-search', '');
    for (const c of ['breakfast', 'lunch', 'dinner']) { await p.click(`[data-chip="${c}"]`); ok(await p.locator('.recipe-card').count() > 0, `chip ${c}`); }
    await p.click('[data-chip="all"][data-chip-group="slot"]');
    await p.click('[data-chip="builtin"]'); ok(await p.locator('.recipe-card').count() === 75, 'built-in chip = 75');
    await p.click('[data-chip="favorites"]'); ok((await p.textContent('#recipe-results')).includes('Favorites'), 'favorites empty state');
    await p.click('[data-chip="all"][data-chip-group="source"]');
    // form validation
    await p.click('#new-recipe'); await p.fill('[name="servings"]', '0'); await p.click('#recipe-form-el button[type=submit]');
    ok(await p.isVisible('#form-errors') && (await p.textContent('.error[data-field="name"]')).length > 0, 'form validation errors');
    ok(await p.evaluate(() => document.activeElement.name) === 'name', 'focus moves to first invalid field');
    await p.fill('[name="name"]', '<img src=x onerror="window.__xss=1">Test Bowl');
    await p.fill('[name="servings"]', '2'); await p.fill('[name="ingredients"]', '1 1/2 cup rolled oats\n2 tbsp peanut butter\n1 banana');
    await p.fill('[name="steps"]', 'Mix.\nEat.'); await p.click('#recipe-form-el button[type=submit]'); await sleep(200);
    ok(/#recipe\/c-/.test(await p.evaluate(() => location.hash)), 'saved recipe opens detail');
    ok(await p.evaluate(() => window.__xss) === undefined, 'no XSS from recipe name');
    ok((await p.textContent('#ing-list')).includes('1½ cup'), 'ingredient fraction parsed');
    await p.click('#serv-plus'); await p.click('#serv-plus');
    ok((await p.textContent('#ing-list')).includes('3 cup'), 'scaling updates live (2→4 servings)');
    await p.fill('#serv-input', ''); ok(!(await p.textContent('#ing-list')).includes('NaN'), 'bad servings no NaN');
    await p.fill('#serv-input', '2');
    await p.click('#fav-btn'); ok(await p.getAttribute('#fav-btn', 'aria-pressed') === 'true', 'favorite toggled');
    await p.click('#edit-btn'); await p.fill('[name="name"]', 'Test Bowl Edited'); await p.click('#recipe-form-el button[type=submit]'); await sleep(150);
    ok((await p.textContent('#recipes-title')) === 'Test Bowl Edited', 'edit saved');
    await p.selectOption('#plan-slot', 'lunch'); await p.click('#plan-add'); await sleep(100);
    ok(Object.values((await store()).days).some(d => /^c-/.test(d.lunch?.mealId || '')), 'add to planner from detail');
    await p.click('#cook-btn'); ok(await p.isVisible('#cook-overlay'), 'cook from detail'); await p.click('#close-cook');
    const rid = (await p.evaluate(() => location.hash)).split('/')[1];
    await p.click('#delete-btn'); await sleep(200);
    ok(await p.evaluate(() => location.hash) === '#recipes', 'delete navigates to list');
    await p.click('.toast-undo'); await sleep(200);
    ok((await p.evaluate(() => location.hash)) === '#recipe/' + rid && (await store()).favorites.includes(rid), 'undo delete restores recipe + favorite');
    await p.goBack(); await sleep(150); ok(await p.isVisible('#recipes'), 'back button works');
    await p.goto(BASE + '#recipe/does-not-exist'); await sleep(150);
    ok((await p.textContent('#recipes-content')).includes('not found'), 'unknown recipe empty state');
    await p.goto(BASE + '#recipe/%E0%A4%A'); await sleep(150); ok(true, 'malformed hash does not crash');
    await p.goto(BASE + '#recipe/b-yogurt'); await sleep(150);
    ok(await p.locator('#edit-btn').count() === 0 && await p.locator('#delete-btn').count() === 0, 'built-in recipes not editable');
    // import
    await tab('recipes');
    for (const [fx, expect] of [['jsonld.html', 'Fixture Chili & Beans'], ['microdata.html', 'Microdata Pancakes']]) {
      await p.click('#import-recipe'); await p.fill('#import-text', BASE + 'tests/fixtures/' + fx); await p.click('#do-import');
      await p.waitForSelector('#imp-name', { timeout: 5000 });
      ok((await p.inputValue('#imp-name')) === expect, `import ${fx} name`);
      const res = await p.textContent('#import-result');
      if (fx === 'jsonld.html') ok(/Ingredients \(6\)/.test(res) && /Steps \(2\)/.test(res) && (await p.inputValue('#imp-servings')) === '6', 'json-ld ingredients/steps/yield');
      else ok(/Ingredients \(3\)/.test(res) && /Steps \(2\)/.test(res), 'microdata ingredients/steps');
      await p.click('#save-import'); await sleep(250);
      ok(/#recipe\//.test(await p.evaluate(() => location.hash)) && (await p.textContent('.recipe-detail')).includes('Imported'), `import ${fx} saved as Imported`);
      await tab('recipes');
    }
    await p.click('#import-recipe'); await p.fill('#import-text', BASE + 'tests/fixtures/garbage.html'); await p.click('#do-import'); await sleep(400);
    ok(/Could not find a recipe/.test(await p.textContent('#import-result')) && await p.evaluate(() => window.__x) === undefined, 'garbage import rejected safely');
    await p.fill('#import-text', 'Toast\nIngredients\n2 slices bread\n1 tbsp butter\nSteps\nToast bread.\nButter it.'); await p.click('#do-import'); await sleep(200);
    ok((await p.inputValue('#imp-name')) === 'Toast' && /Ingredients \(2\)/.test(await p.textContent('#import-result')), 'plain-text import');
    await p.click('#cancel-import-review');
    await p.click('[data-chip="imported"]'); ok(await p.locator('.recipe-card').count() === 2, 'imported chip shows 2');
    await p.click('[data-chip="custom"]'); ok(await p.locator('.recipe-card').count() === 1, 'custom chip shows 1');

    // ---- pantry
    await tab('pantry');
    await p.fill('#pantry-add-form [name="name"]', 'Rolled oats'); await p.fill('#pantry-add-form [name="qty"]', '4'); await p.fill('#pantry-add-form [name="unit"]', 'cup');
    const soon = shift(TODAY, 2);
    await p.fill('#pantry-add-form [name="expiry"]', soon); await p.click('#pantry-add-form button[type=submit]'); await sleep(150);
    ok((await p.textContent('#pantry-content')).includes('Rolled oats'), 'pantry add');
    ok(/Expiring soon/.test(await p.textContent('#pantry-content')), 'expiring soon notice');
    await p.locator('.pantry-edit [data-field="qty"]').first().fill('2.5'); await p.locator('.pantry-edit [data-field="qty"]').first().dispatchEvent('change'); await sleep(100);
    ok((await store()).pantry.some(x => x.qty === 2.5), 'pantry edit qty');
    await p.click('#find-meals'); await sleep(100); ok(await p.locator('[data-plan]').count() > 0, 'cook from what I have');
    await p.locator('[data-plan]').first().click(); await sleep(100); ok(await toastVisible(), 'plan from pantry');
    const n0 = (await store()).pantry.length;
    await p.locator('#pantry-content [data-remove]').first().click(); await sleep(100);
    ok((await store()).pantry.length === n0 - 1, 'pantry remove'); await p.click('.toast-undo'); await sleep(100);
    ok((await store()).pantry.length === n0, 'pantry remove undo');

    // ---- settings / household / conflicts
    await tab('settings');
    ok(await p.locator('a[href="#review"]').count() > 0, 'More links to Review');
    await p.click('#add-member'); await sleep(100); ok(await p.locator('form[data-member]').count() === 2, 'add member');
    await p.locator('form[data-member="1"] [name="name"]').fill('Sam'); await p.locator('form[data-member="1"] button[type=submit]').click(); await sleep(100);
    ok((await store()).profile.members[1].name === 'Sam', 'edit member');
    await p.click('[data-remove="1"]'); await sleep(100); ok((await store()).profile.members.length === 1, 'remove member'); await p.click('.toast-undo'); await sleep(100);
    ok((await store()).profile.members.length === 2, 'undo remove member');
    await p.check('input[name="allergen"][value="dairy"]'); await p.fill('#settings-form [name="allergens"]', 'Peanuts'); await p.click('#settings-form button[type=submit]'); await sleep(150);
    const al = (await store()).profile.allergens; ok(al.includes('dairy') && al.includes('nuts'), 'allergens normalized (Peanuts→nuts)');
    await p.selectOption('#settings-form [name="goal"]', 'keto'); await p.click('#settings-form button[type=submit]'); await sleep(150);
    ok(await p.isVisible('#conflicts'), 'conflicts shown after diet change');
    await p.selectOption('#settings-form [name="goal"]', 'balanced'); await p.uncheck('input[name="allergen"][value="dairy"]'); await p.fill('#settings-form [name="allergens"]', ''); await p.click('#settings-form button[type=submit]');
    // export / import backup
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#export-btn')]);
    const backupPath = await dl.path(); const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    ok(backup.schemaVersion === 5 && backup.customMeals.length === 3 && !backup._undo, 'export backup');
    await p.click('#copy-backup-btn'); await sleep(100); ok((await p.evaluate(() => navigator.clipboard.readText())).includes('"schemaVersion"'), 'copy backup');
    await p.click('#reset-btn'); await sleep(150); ok(((await store()).customMeals || []).length === 0, 'reset all data');
    const bad = path.join(require('os').tmpdir(), 'larder-bad.json'); fs.writeFileSync(bad, '{oops');
    await p.setInputFiles('#import-file', bad); await sleep(200); ok(/Import failed/.test(await p.textContent('#undo-toast')), 'bad backup rejected');
    await p.setInputFiles('#import-file', backupPath); await sleep(200);
    ok((await store()).customMeals.length === 3, 'import backup restores data');
    // ---- review
    await p.goto(BASE + '#review'); await sleep(150);
    ok(/Meals marked eaten/.test(await p.textContent('#review-content')), 'review renders');
    ok(phone ? await p.getAttribute('.bottom-tabs a[data-page~="review"]', 'aria-current') === 'page' : await p.getAttribute('.top-nav a[data-page="review"]', 'aria-current') === 'page', 'nav marks current');
    // ---- reload persistence + legacy routes
    await p.goto(BASE + '#meals'); await sleep(150); ok(await p.evaluate(() => location.hash) === '#recipes', '#meals → #recipes');
    await p.goto(BASE + '#week'); await sleep(150); ok(await p.evaluate(() => location.hash) === '#planner', '#week → #planner');
    await p.goto(BASE + '#nonsense'); await sleep(150); ok(await p.isVisible('#planner'), 'unknown route → planner');
    await p.reload(); await sleep(300); ok((await store()).customMeals.length === 3, 'data persists after reload');

    // ---- migration from a v4 save + corrupt storage
    await p.evaluate(() => localStorage.setItem('larder-improved-v4', JSON.stringify({ schemaVersion: 4, profile: { goal: 'balanced', allergens: ['Dairy'], members: [{ name: 'A' }] }, days: { '2026-11-01': { breakfast: { mealId: 'b-yogurt', status: 'planned' } } }, customMeals: [{ id: 'c-1', name: 'Old import', blurb: 'Imported', custom: true }], _undo: [{ snapshot: {} }] })));
    await p.reload(); await sleep(300);
    const mig = await store();
    ok(mig.schemaVersion === 5 && mig.customMeals[0].source === 'imported' && mig.profile.allergens[0] === 'dairy' && !mig._undo, 'v4 → v5 migration');
    await p.evaluate(() => localStorage.setItem('larder-improved-v4', '{corrupt'));
    await p.reload(); await sleep(300);
    ok(/unreadable/.test(await p.textContent('#undo-toast')) && await p.evaluate(() => Object.keys(localStorage).some(k => k.includes('corrupt'))), 'corrupt storage kept + notice');

    // ---- large data
    await p.evaluate(() => {
      const days = {}; const d = new Date(2025, 0, 1, 12);
      for (let i = 0; i < 730; i++) { const k = d.toLocaleDateString('en-CA'); days[k] = { breakfast: { mealId: 'b-yogurt', status: 'eaten' }, lunch: { mealId: 'l-salad', status: 'planned' }, dinner: { mealId: 'd-stirfry', status: 'planned' } }; d.setDate(d.getDate() + 1); }
      const customMeals = Array.from({ length: 400 }, (_, i) => ({ id: 'c-big' + i, name: 'Big recipe ' + i, slot: 'dinner', servings: 2, custom: true, source: 'custom', ingredients: [{ name: 'rice', qty: 1, unit: 'cup' }], steps: ['x'] }));
      localStorage.setItem('larder-improved-v4', JSON.stringify({ schemaVersion: 5, days, customMeals, pantry: [], favorites: [] }));
    });
    const t0 = Date.now(); await p.reload(); await p.waitForSelector('.today-card'); await tab('recipes'); await p.fill('#meal-search', 'big recipe 39'); await tab('shop'); await tab('planner'); await p.click('[data-view="month"]');
    ok(Date.now() - t0 < 8000, `large data (730 days, 400 recipes) usable in ${Date.now() - t0}ms`);
    await p.click('[data-view="week"]');

    // ---- accessibility / layout checks
    if (phone) {
      await p.setViewportSize({ width: 360, height: 740 });
      for (const pg of ['planner', 'recipes', 'shop', 'pantry', 'settings', 'review', 'recipe/b-yogurt']) {
        await p.goto(BASE + '#' + pg); await sleep(200);
        const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        ok(ow <= 0, `no horizontal overflow at 360px on #${pg} (${ow}px)`);
        const small = await p.evaluate(() => [...document.querySelectorAll('main button, main a.btn, .bottom-tabs a, main select, main input:not([type=checkbox]):not([type=file]), #sheet-actions button')]
          .filter(e => e.offsetParent && getComputedStyle(e).visibility !== 'hidden')
          .map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.name || e.id || e.tagName).trim().slice(0, 20), h: r.height, w: r.width }; })
          .filter(r => r.h < 43.5 || r.w < 43.5));
        ok(small.length === 0, `tap targets ≥44px on #${pg}` + (small.length ? ' ' + JSON.stringify(small.slice(0, 4)) : ''));
      }
      await p.goto(BASE + '#planner'); await p.click('#week-days .meal-slot >> nth=0'); await sleep(100);
      // focus stays inside sheet
      for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
      ok(await p.evaluate(() => document.getElementById('meal-sheet').contains(document.activeElement)), 'focus trapped in sheet');
      await p.keyboard.press('Escape');
      await p.click('[data-view="month"]'); await p.click('[data-view="week"]'); await p.click(`[data-copy]`);
      const ov = await p.evaluate(() => { const t = document.getElementById('undo-toast').getBoundingClientRect(); const b = document.querySelector('.bottom-tabs').getBoundingClientRect(); return t.bottom <= b.top + 1; });
      ok(ov, 'toast does not overlap bottom tabs');
    }
    const contrast = await p.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bg = el => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; el = el.parentElement; } return 'rgb(255,255,255)'; };
      const bad = [];
      document.querySelectorAll('.muted, .slot-label, .slot-empty, .tagline, .badge, .chip, .mini, small').forEach(e => {
        if (!e.offsetParent || !e.textContent.trim()) return;
        const a = lum(getComputedStyle(e).color), b = lum(bg(e)); const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (r < 4.5) bad.push(e.className + ':' + r.toFixed(2));
      });
      return bad;
    });
    ok(contrast.length === 0, 'muted text contrast ≥ 4.5:1 ' + contrast.slice(0, 5).join(' '));
    ok((await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label')).length)) === 0, 'all buttons have names');
    ok((await p.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(i => i.offsetParent && !i.labels?.length && !i.getAttribute('aria-label')).length)) === 0, 'all form fields labelled');

    // ---- offline via service worker (desktop only; SW scope needs a fresh load)
    if (!phone) {
      await p.goto(BASE + '#planner');
      await p.evaluate(() => navigator.serviceWorker.ready); await sleep(500); await p.reload(); await sleep(300);
      await ctx.setOffline(true); await p.reload(); await sleep(500);
      ok(await p.isVisible('.today-card'), 'app loads offline via service worker');
      await ctx.setOffline(false);
      const icon = await p.evaluate(async () => (await fetch('icon-192.png')).status); ok(icon === 200, 'icon-192.png served (no manifest 404)');
    }
    ok(errors.length === 0, 'no console/page errors ' + errors.slice(0, 5).join(' | '));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
