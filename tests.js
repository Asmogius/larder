// Larder unit tests. Browser: import and call runLarderTests(). Node: `node tests.js` (stubs localStorage).
if (typeof localStorage === 'undefined') {
  const mem = {};
  globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
}
const app = await import('./app.js');
const { MEALS } = await import('./data.js');
const { aggregateGrocery, computeCost, computeDailyNutrition, getTargets, getHouseholdSize, dateKey, parseDateKey, addDays,
  weekStartOf, weekDays, parseQuantity, parseIngredientLine, subtractPantry, migrateState, getRecipeSource, swapSlots, state,
  deductFromPantry, markEatenAndDeduct, isDateKey, normalizeAllergen, validateRecipeForm, smartNumber, formatQuantity, pushUndo, popUndo, importData, exportData, getTargets: gt } = app;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function runLarderTests() {
  const results = [];
  try {
    const plan = [{ mealId: MEALS[0].id, status: 'planned', servings: 2 }];
    const list = aggregateGrocery(plan);
    assert(Array.isArray(list) && list.length > 0, 'aggregate returns items');
    results.push('aggregateGrocery OK');

    assert(aggregateGrocery([{ mealId: MEALS[0].id, status: 'skipped' }]).length === 0, 'skipped excluded');
    results.push('aggregateGrocery skips skipped OK');

    const cost = computeCost([MEALS[0]], 2);
    assert(typeof cost.total === 'number', 'cost has total');
    assert(computeCost([{ servings: 1 }], 1).total === 0, 'cost tolerates no ingredients');
    results.push('computeCost OK');

    const nut = computeDailyNutrition([MEALS[0]], 1);
    assert(nut.calories >= 0, 'nutrition calories');
    results.push('computeDailyNutrition OK');

    const profile = { members: [{ sex: 'female', age: 30, heightFt: 5, heightIn: 6, weightLb: 140, activity: 'light', goal: 'balanced' }] };
    assert(getTargets(profile).calories > 1000, 'targets calories');
    assert(getHouseholdSize(profile) === 1, 'household size');
    results.push('targets/household OK');

    // Local date helpers (no UTC drift)
    const late = new Date(2026, 10, 1, 23, 30);
    assert(dateKey(late) === '2026-11-01', 'dateKey uses local date');
    assert(addDays('2026-11-01', 1) === '2026-11-02', 'addDays across DST change');
    assert(addDays('2026-12-31', 1) === '2027-01-01', 'addDays year rollover');
    assert(weekStartOf('2026-11-01') === '2026-10-26', 'week starts Monday (Sun)');
    assert(weekStartOf('2026-11-02') === '2026-11-02', 'week starts Monday (Mon)');
    assert(weekDays('2026-11-02').length === 7 && weekDays('2026-11-02')[6] === '2026-11-08', 'weekDays');
    assert(parseDateKey('2026-03-08').getDate() === 8, 'parseDateKey local');
    results.push('date helpers OK');

    assert(parseQuantity('1 1/2') === 1.5, 'mixed fraction');
    assert(parseQuantity('½') === 0.5, 'unicode fraction');
    const ing = parseIngredientLine('2 cups rolled oats');
    assert(ing.qty === 2 && ing.unit === 'cup' && ing.name === 'rolled oats', 'ingredient line');
    const egg = parseIngredientLine('3 large eggs');
    assert(egg.qty === 3 && egg.unit === '' && egg.name === 'large eggs', 'non-unit word kept in name');
    results.push('ingredient parsing OK');

    const groc = [{ canon: { id: 'milk', name: 'Milk' }, qty: 2, unit: 'cup', aisle: 'dairy', display: '2 cup', expanded: '' },
      { canon: { id: 'eggs', name: 'Eggs' }, qty: 2, unit: '', aisle: 'dairy', display: '2', expanded: '' }];
    const { need, have } = subtractPantry(groc, [{ name: 'milk', qty: 1, unit: 'cup' }, { name: 'eggs', qty: 6, unit: '' }]);
    assert(have.length === 1 && have[0].canon.id === 'eggs', 'eggs covered by pantry');
    assert(need.length === 1 && Math.abs(need[0].qty - 1) < 1e-6, 'milk partially covered');
    results.push('subtractPantry OK');

    const migrated = migrateState({ schemaVersion: 4, days: {}, customMeals: [{ id: 'c-1', name: 'X', blurb: 'Imported', custom: true }, { id: 'c-2', name: 'Y', custom: true, steps: ['a'] }] });
    assert(migrated.schemaVersion === 5 && Array.isArray(migrated.favorites), 'migration adds favorites');
    assert(getRecipeSource(migrated.customMeals[0]) === 'imported' && getRecipeSource(migrated.customMeals[1]) === 'custom', 'source inferred');
    assert(getRecipeSource(MEALS[0]) === 'builtin', 'builtin source');
    results.push('migration OK');

    state.days['2099-01-01'] = { breakfast: { mealId: 'a', status: 'planned' }, lunch: null, dinner: null };
    swapSlots({ date: '2099-01-01', slot: 'breakfast' }, { date: '2099-01-02', slot: 'dinner' });
    assert(!state.days['2099-01-01'].breakfast && state.days['2099-01-02'].dinner.mealId === 'a', 'swap into empty slot');
    delete state.days['2099-01-01']; delete state.days['2099-01-02'];
    results.push('swapSlots OK');


    // Leap years, month/year boundaries, DST weeks
    assert(addDays('2028-02-28', 1) === '2028-02-29' && addDays('2027-02-28', 1) === '2027-03-01', 'leap years');
    assert(addDays('2026-03-08', 0) === '2026-03-08' && weekDays('2026-03-02').join() === '2026-03-02,2026-03-03,2026-03-04,2026-03-05,2026-03-06,2026-03-07,2026-03-08', 'US DST-start week');
    assert(weekDays('2026-10-26')[6] === '2026-11-01', 'US DST-end week');
    assert(weekStartOf('2027-01-01') === '2026-12-28', 'week across year');
    assert(addDays('2026-01-31', 1) === '2026-02-01' && addDays('2026-03-01', -1) === '2026-02-28', 'month boundaries');
    assert(isDateKey('2026-02-29') === false && isDateKey('2028-02-29') === true && isDateKey('junk') === false, 'isDateKey');
    for (let i = 0, k = '2026-01-01'; i < 800; i++, k = addDays(k, 1)) assert(addDays(addDays(k, 1), -1) === k && weekDays(weekStartOf(k)).includes(k) && parseDateKey(weekStartOf(k)).getDay() === 1, 'roundtrip ' + k);
    results.push('calendar edge cases OK');

    // Units / numbers
    assert(parseIngredientLine('1 (14 oz) can black beans').unit === 'can', 'parenthetical size');
    assert(parseIngredientLine('').name === '' && parseIngredientLine('salt').qty === 1, 'empty / unitless');
    assert(smartNumber(NaN) === '0' && smartNumber(0.1) === '0.1' && smartNumber(1.5) === '1½', 'smartNumber');
    assert(formatQuantity(3, 'tsp') === '1 tbsp' && formatQuantity(48, 'tsp') === '1 cup', 'volume formatting');
    const mixed = aggregateGrocery([{ mealId: 'x', status: 'planned', custom: { name: 'M', servings: 1, ingredients: [{ name: 'milk', qty: 1, unit: 'cup' }, { name: 'milk', qty: 2, unit: '' }, { name: 'milk', qty: 2, unit: 'tbsp' }] } }]);
    const milk = mixed.filter(i => i.canon.id === 'milk');
    assert(milk.length === 2, 'incompatible units kept separate');
    assert(milk.some(i => i.unit === 'cup' && Math.abs(i.qty - 1.125) < 1e-9), 'cup + tbsp merged');
    const lo = aggregateGrocery([{ mealId: MEALS[0].id, status: 'planned', leftover: true }]);
    assert(lo.length === 0, 'leftovers not re-bought');
    assert(aggregateGrocery([{ mealId: MEALS[0].id, status: 'planned', servings: 0 }]).length > 0, 'servings 0 falls back');
    assert(aggregateGrocery([null, {}, { mealId: 'nope' }]).length === 0, 'tolerates junk');
    const wt = aggregateGrocery([{ mealId: 'x', custom: { name: 'W', servings: 1, ingredients: [{ name: 'beef', qty: 12, unit: 'oz' }, { name: 'beef', qty: 1, unit: 'lb' }] } }]);
    assert(wt.length === 1 && wt[0].unit === 'lb' && Math.abs(wt[0].qty - 1.75) < 1e-6, 'oz + lb merged');
    assert(computeDailyNutrition([{ servings: 0, protein: 10, carbs: 0, fat: 0 }], 0).protein >= 0, 'zero servings/household no NaN');
    results.push('units/aggregation edge cases OK');

    // Unit-aware pantry deduction
    state.pantry = [{ id: 'a', name: 'olive oil', qty: 1, unit: 'cup' }, { id: 'b', name: 'eggs', qty: 6, unit: '' }];
    deductFromPantry('olive oil', 2, 'tbsp');
    assert(Math.abs(state.pantry.find(p => p.id === 'a').qty - 0.875) < 1e-9, 'tbsp from cup');
    deductFromPantry('eggs', 1, 'cup');
    assert(state.pantry.find(p => p.id === 'b').qty === 6, 'incompatible unit not deducted');
    deductFromPantry('eggs', 6, '');
    assert(!state.pantry.find(p => p.id === 'b'), 'used-up item removed');
    state.days['2099-02-01'] = { breakfast: { mealId: MEALS[0].id, status: 'planned', leftover: true }, lunch: null, dinner: null };
    state.pantry = [{ id: 'y', name: 'plain Greek yogurt', qty: 1, unit: 'cup' }];
    markEatenAndDeduct('2099-02-01', 'breakfast');
    assert(state.pantry.length === 1 && state.pantry[0].qty === 1, 'leftover eaten deducts nothing');
    delete state.days['2099-02-01']; state.pantry = [];
    results.push('pantry deduction OK');

    // Undo in memory only
    state.days['2099-03-01'] = { breakfast: null, lunch: null, dinner: null };
    pushUndo({ label: 't' }); state.days['2099-03-01'].lunch = { mealId: 'a', status: 'planned' };
    assert(popUndo() && !state.days['2099-03-01'].lunch, 'undo restores');
    assert(!JSON.parse(exportData())._undo, 'undo not exported');
    delete state.days['2099-03-01'];
    results.push('undo OK');

    // Migration of messy / older shapes
    const junk = migrateState({ days: { 'bad': {}, '2026-01-01': { breakfast: 'x', lunch: { mealId: 'b', status: 'weird', servings: -1 } } }, customMeals: [null, { id: 'c', name: 'C' }], pantry: 'x', favorites: [1, 'a'], profile: { allergens: 'Dairy, peanuts' }, _undo: [1] });
    assert(!junk.days.bad && junk.days['2026-01-01'].breakfast === null && junk.days['2026-01-01'].lunch.status === 'planned' && !('servings' in junk.days['2026-01-01'].lunch), 'days sanitized');
    assert(junk.customMeals.length === 1 && junk.customMeals[0].slot === 'dinner' && junk.pantry.length === 0 && junk.favorites.join() === 'a', 'collections sanitized');
    assert(junk.profile.allergens.join() === 'dairy,nuts' && junk.profile.members.length === 1 && !junk._undo, 'profile sanitized');
    assert(migrateState({ schemaVersion: 1, plan: { days: { '2026-01-02': { dinner: { mealId: 'z' } } } } }).days['2026-01-02'].dinner.mealId === 'z', 'v1 plan.days shape');
    assert(normalizeAllergen(' Egg ') === 'eggs' && normalizeAllergen('wheat') === 'gluten', 'allergen synonyms');
    assert(importData('not json') === false && importData('[]') === false && importData('{"foo":1}') === false, 'bad backups rejected');
    results.push('migration/sanitize OK');

    assert(!validateRecipeForm({ name: 'x', servings: '1000' }).valid && !validateRecipeForm({ name: ' ', servings: 1 }).valid && validateRecipeForm({ name: 'ok', servings: '2' }).valid, 'form validation');
    assert(gt({ members: [{ heightFt: 6, heightIn: 0, weightLb: 180, age: 40, sex: 'male' }] }).calories > 0, 'heightIn 0 accepted');
    results.push('validation OK');

    console.log('All tests passed:', results);
    return { passed: true, results };
  } catch (e) {
    console.error('Test failed:', e.message);
    return { passed: false, error: e.message, results };
  }
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('tests.js')) {
  const r = runLarderTests();
  if (!r.passed) process.exit(1);
}
