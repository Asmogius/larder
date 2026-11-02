// Larder unit tests
import { aggregateGrocery, computeCost, computeDailyNutrition, getTargets, getHouseholdSize } from './app.js';
import { MEALS } from './data.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function runLarderTests() {
  const results = [];
  try {
    // Aggregation
    const plan = [{ mealId: MEALS[0].id, status: 'planned', servings: 2 }];
    const list = aggregateGrocery(plan);
    assert(Array.isArray(list), 'aggregate returns array');
    results.push('aggregateGrocery OK');

    // Cost
    const cost = computeCost([MEALS[0]], 2);
    assert(typeof cost.total === 'number', 'cost has total');
    results.push('computeCost OK');

    // Nutrition
    const nut = computeDailyNutrition([MEALS[0]], 1);
    assert(nut.calories >= 0, 'nutrition calories');
    results.push('computeDailyNutrition OK');

    // Targets with members
    const profile = { members: [{ sex: 'female', age: 30, heightFt: 5, heightIn: 6, weightLb: 140, activity: 'light', goal: 'balanced' }] };
    const t = getTargets(profile);
    assert(t.calories > 1000, 'targets calories');
    results.push('getTargets OK');

    // Household size
    assert(getHouseholdSize(profile) === 1, 'household size');
    results.push('getHouseholdSize OK');

    console.log('All tests passed:', results);
    return { passed: true, results };
  } catch (e) {
    console.error('Test failed:', e.message);
    return { passed: false, error: e.message };
  }
}
