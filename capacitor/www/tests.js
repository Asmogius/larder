// Larder unit tests. Browser: import and call runLarderTests(). Node: `node tests.js` (stubs localStorage).
if (typeof localStorage === 'undefined') {
  const mem = {};
  globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
}
const app = await import('./app.js');
const { MEALS } = await import('./data.js');
const { aggregateGrocery, computeCost, computeDailyNutrition, getTargets, getHouseholdSize, dateKey, parseDateKey, addDays,
  weekStartOf, weekDays, parseQuantity, parseIngredientLine, subtractPantry, migrateState, getRecipeSource, swapSlots, state } = app;

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
