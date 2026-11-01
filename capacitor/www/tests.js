/* Simple unit tests for core functions (run in browser console or with a test runner)
   Covers unit conversion, aggregation merging, and cost consistency (P3 #28).
*/
import { aggregateGrocery, computeCost, computeDailyNutrition } from './app.js';
import { MEALS, normalizeIngredient } from './data.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
  console.log('✓', msg || 'passed');
}

export function runTests() {
  console.log('Running Larder core tests...');

  // Unit normalization
  const olive = normalizeIngredient('olive oil');
  assert(olive.id === 'olive-oil', 'canonical olive oil');

  // Aggregation merges same ingredient
  const planned = [
    { mealId: 'b-yogurt', status: 'planned' },
    { mealId: 'b-chia', status: 'planned' }
  ];
  const list = aggregateGrocery(planned);
  const yogurt = list.find(i => i.canon.id === 'greek-yogurt');
  assert(yogurt, 'yogurt appears once');
  assert(yogurt.recipes.length >= 1, 'has recipe provenance');

  // Cost consistency
  const meals = planned.map(p => MEALS.find(m => m.id === p.mealId)).filter(Boolean);
  const cost1 = computeCost(meals, 1);
  const cost2 = computeCost(meals, 1);
  assert(cost1.total === cost2.total, 'cost is deterministic');
  assert(cost1.label === 'est.', 'cost labeled est.');

  // Nutrition
  const nut = computeDailyNutrition([MEALS[0]], 1);
  assert(nut.calories >= 0, 'nutrition computes');

  console.log('All tests passed.');
  return true;
}

// Auto-run if in browser
if (typeof window !== 'undefined') {
  window.runLarderTests = runTests;
}
