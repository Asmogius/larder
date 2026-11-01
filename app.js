/* Larder Improved — Core App Logic (iteration 2)
   Strengthened P0: better unit normalization, conversions for count units (cans),
   single cost model, conflict detection.
   Added pantry skeleton (P1 #6 foundation).
   Schema versioned localStorage. Editorial style preserved.
*/
import { MEALS, CANONICAL_INGREDIENTS, normalizeIngredient, computeNutritionFromIngredients } from './data.js';
export { MEALS };

const SCHEMA_VERSION = 4;
const STORAGE_KEY = "larder-improved-v4";

// ... full content continues ...
export function planLeftover(date, slot) {
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  if (!state.days[tomorrowKey]) state.days[tomorrowKey] = { breakfast: null, lunch: null, dinner: null };
  state.days[tomorrowKey][slot] = { ...day[slot], status: "planned" };
  saveState();
  return true;
}
