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

// Unit conversion helpers (volume, weight)
const VOLUME_TO_TSP = {
  tsp: 1,
  tbsp: 3,
  cup: 48,
  ml: 0.202884 // approx
};
const WEIGHT_TO_G = {
  g: 1,
  oz: 28.3495,
  lb: 453.592
};

function toBaseVolume(qty, unit) {
  const u = (unit || "").toLowerCase();
  return qty * (VOLUME_TO_TSP[u] || 1);
}
function fromBaseVolume(tsp) {
  if (tsp >= 48) return { qty: Math.round((tsp / 48) * 4) / 4, unit: "cup" };
  if (tsp >= 3) return { qty: Math.round((tsp / 3) * 4) / 4, unit: "tbsp" };
  return { qty: Math.round(tsp * 4) / 4, unit: "tsp" };
}
function formatQuantity(qty, unit) {
  if (!unit) return smartNumber(qty);
  const u = unit.toLowerCase();
  if (["tsp", "tbsp", "cup", "ml"].includes(u)) {
    const base = toBaseVolume(qty, u);
    const pretty = fromBaseVolume(base);
    return `${smartNumber(pretty.qty)} ${pretty.unit}`;
  }
  if (["g", "oz", "lb"].includes(u)) {
    return `${smartNumber(qty)} ${unit}`;
  }
  return `${smartNumber(qty)} ${unit}`;
}

function smartNumber(n) {
  const rounded = Math.round(n * 4) / 4;
  if (rounded === 0.25) return "¼";
  if (rounded === 0.5) return "½";
  if (rounded === 0.75) return "¾";
  if (rounded === 1.25) return "1¼";
  if (rounded === 1.5) return "1½";
  if (rounded === 1.75) return "1¾";
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function computeDailyNutrition(plannedMeals, householdSize = 1) {
  const size = typeof householdSize === 'object' ? getHouseholdSize(householdSize) : householdSize;
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  plannedMeals.forEach(meal => {
    const scale = size / (meal.servings || 1);
    const nut = meal.protein != null ? meal : computeNutritionFromIngredients(meal.ingredients || [], meal.servings || 1);
    totals.calories += (nut.calories || nut.protein * 4 + nut.carbs * 4 + nut.fat * 9 || 0) * scale;
    totals.protein += (nut.protein || 0) * scale;
    totals.carbs += (nut.carbs || 0) * scale;
    totals.fat += (nut.fat || 0) * scale;
    totals.fiber += (nut.fiber || 0) * scale;
  });
  Object.keys(totals).forEach(k => totals[k] = Math.round(totals[k]));
  return totals;
}

export function getTargets(profile) {
  const members = profile.members || [];
  if (!members.length) {
    // fallback single-person
    return profile.goal === 'keto' ? { calories: 1800, protein: 120, carbs: 30, fat: 140 } :
           profile.goal === 'performance' ? { calories: 2200, protein: 160, carbs: 250, fat: 70 } :
           { calories: 1920, protein: 100, carbs: 200, fat: 65 };
  }
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  members.forEach(m => {
    const t = estimatePersonTargets(m);
    totals.calories += t.calories;
    totals.protein += t.protein;
    totals.carbs += t.carbs;
    totals.fat += t.fat;
  });
  return totals;
}

function estimatePersonTargets(m) {
  // Mifflin-St Jeor BMR + activity multiplier, then adjust by goal
  const kg = (m.weightLb || 150) * 0.453592;
  const cm = ((m.heightFt || 5) * 12 + (m.heightIn || 6)) * 2.54;
  const age = m.age || 30;
  const sex = (m.sex || 'female').toLowerCase();
  let bmr = 10 * kg + 6.25 * cm - 5 * age;
  bmr += sex === 'male' ? 5 : -161;
  const activity = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }[m.activity || 'light'] || 1.375;
  let tdee = bmr * activity;
  const goal = m.goal || 'balanced';
  if (goal === 'keto') tdee *= 0.9;
  if (goal === 'performance') tdee *= 1.1;
  const calories = Math.round(tdee);
  // simple macro split
  let protein = Math.round((m.weightLb || 150) * (goal === 'performance' ? 0.9 : 0.7));
  let fat = Math.round(calories * (goal === 'keto' ? 0.7 : 0.3) / 9);
  let carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

export function getHouseholdSize(profile) {
  return (profile.members || []).length || profile.householdSize || 1;
}
export function computeCost(mealsInPlan, householdSize = 1, priceOverrides = {}) {
  let totalCents = 0;
  const itemCosts = new Map();
  mealsInPlan.forEach(meal => {
    const scale = householdSize / (meal.servings || 1);
    meal.ingredients.forEach(ing => {
      const canon = normalizeIngredient(ing.name);
      const override = priceOverrides[canon.id];
      const cents = override != null ? override * scale : (meal.centsPerServing || 200) * scale / Math.max(1, meal.ingredients.length);
      totalCents += cents;
      const key = canon.id;
      itemCosts.set(key, (itemCosts.get(key) || 0) + cents);
    });
  });
  return { total: Math.round(totalCents) / 100, itemCosts, label: "est." };
}

// Grocery aggregation with canonical IDs, unit normalization, and count conversions (P0 #1)
export function aggregateGrocery(plannedMeals, options = { excludeEaten: true, dateRange: "week" }) {
  const byCanon = new Map();
  plannedMeals.forEach(pm => {
    if (options.excludeEaten && pm.status === "eaten") return;
    if (pm.status === "skipped") return;
    const meal = MEALS.find(m => m.id === pm.mealId) || pm.custom;
    if (!meal) return;
    const scale = (pm.servings || meal.servings || 1) / (meal.servings || 1);
    meal.ingredients.forEach(rawIng => {
      const canon = normalizeIngredient(rawIng.name);
      const key = canon.id;
      if (!byCanon.has(key)) {
        byCanon.set(key, {
          canon,
          qty: 0,
          unit: rawIng.unit || "",
          recipes: [],
          aisle: canon.aisle
        });
      }
      const entry = byCanon.get(key);
      let addQty = (rawIng.qty || 1) * scale;
      let addUnit = rawIng.unit || "";
      // Handle count unit conversions (e.g. 1 can beans ≈ 1.5 cups)
      if (canon.conversions && addUnit && canon.conversions[addUnit.toLowerCase()]) {
        const factor = canon.conversions[addUnit.toLowerCase()];
        addQty *= factor;
        addUnit = "cup"; // convert to volume base
      }
      // Normalize volume if possible
      if (["tsp", "tbsp", "cup"].includes(addUnit.toLowerCase()) && ["tsp", "tbsp", "cup"].includes((entry.unit || "").toLowerCase())) {
        const baseAdd = toBaseVolume(addQty, addUnit);
        const baseExist = toBaseVolume(entry.qty, entry.unit || "tsp");
        const totalBase = baseAdd + baseExist;
        const pretty = fromBaseVolume(totalBase);
        entry.qty = pretty.qty;
        entry.unit = pretty.unit;
      } else {
        entry.qty += addQty;
        if (addUnit) entry.unit = addUnit;
      }
      if (!entry.recipes.includes(meal.name)) entry.recipes.push(meal.name);
    });
  });
  // Format display
  return Array.from(byCanon.values()).map(e => ({
    ...e,
    display: formatQuantity(e.qty, e.unit),
    expanded: e.recipes.join(", ")
  })).sort((a, b) => a.aisle.localeCompare(b.aisle) || a.canon.name.localeCompare(b.canon.name));
}

// Plan re-check on goal/allergen change (P0 #3)
export function checkConflicts(plan, profile) {
  const conflicts = [];
  Object.entries(plan.days || {}).forEach(([date, day]) => {
    ["breakfast", "lunch", "dinner"].forEach(slot => {
      const entry = day[slot];
      if (!entry || entry.status === "eaten" || entry.status === "skipped") return;
      const meal = MEALS.find(m => m.id === entry.mealId);
      if (!meal) return;
      const isKetoConflict = profile.goal === "keto" && !meal.keto;
      const allergenConflict = profile.allergens.some(a => meal.allergens?.includes(a));
      if (isKetoConflict || allergenConflict) {
        conflicts.push({ date, slot, mealId: meal.id, name: meal.name, reasons: [isKetoConflict ? "keto" : null, allergenConflict ? "allergen" : null].filter(Boolean) });
      }
    });
  });
  return conflicts;
}

// State management
export let state = loadState();
export function getAllMeals() {
  return [...MEALS, ...(state.customMeals || [])];
}



function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.schemaVersion === SCHEMA_VERSION) return parsed;
      // Migration stub for P3
    }
  } catch (e) {}
  // Empty first-run state (P2 #12)
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      householdSize: 1,
      goal: "balanced",
      allergens: [],
      members: [
        {
          id: "m1",
          name: "You",
          sex: "female",
          age: 34,
          heightFt: 5,
          heightIn: 6,
          weightLb: 150,
          activity: "light",
          goal: "balanced"
        }
      ],
      sample: false
    },
    days: {},
    customMeals: [],
    pantry: [], // P1 #6: { id, name, qty, unit, location, expiry? }
    prices: {}, // editable prices
    manualItems: [] // free-text grocery additions
  };
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Form validation helper (P0 #5)
export function validateRecipeForm(formData) {
  const errors = {};
  if (!formData.name?.trim()) errors.name = "Name is required";
  if (!formData.servings || isNaN(formData.servings) || Number(formData.servings) < 1) errors.servings = "Servings must be a positive number";
  if (formData.calories && (isNaN(formData.calories) || Number(formData.calories) < 0)) errors.calories = "Calories must be a non-negative number";
  if (formData.protein && (isNaN(formData.protein) || Number(formData.protein) < 0)) errors.protein = "Protein must be a non-negative number";
  return { valid: Object.keys(errors).length === 0, errors };
}

// Pantry helpers (P1 foundation)
export function addToPantry(item) {
  const entry = {
    id: Date.now().toString(),
    ...item,
    added: new Date().toISOString(),
    expiry: item.expiry || null // ISO date string optional
  };
  state.pantry.push(entry);
  saveState();
  return entry;
}

export function getExpiringSoon(days = 3) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return (state.pantry || []).filter(p => p.expiry && new Date(p.expiry) <= cutoff);
}

export function suggestUseItUp() {
  // Simple: meals that use ingredients currently in pantry
  const pantryIds = new Set((state.pantry || []).map(p => normalizeIngredient(p.name).id));
  return getAllMeals().filter(meal =>
    meal.ingredients?.some(ing => pantryIds.has(normalizeIngredient(ing.name).id))
  ).slice(0, 3);
}
export function deductFromPantry(ingredientName, qty) {
  const canon = normalizeIngredient(ingredientName);
  const item = state.pantry.find(p => normalizeIngredient(p.name).id === canon.id);
  if (item) {
    item.qty = Math.max(0, (item.qty || 0) - qty);
    if (item.qty <= 0) state.pantry = state.pantry.filter(p => p.id !== item.id);
    saveState();
  }
}

export function addCustomMeal(meal) {
  const id = "c-" + Date.now();
  const full = { id, ...meal, custom: true, centsPerServing: meal.centsPerServing || 200 };
  state.customMeals.push(full);
  saveState();
  return full;
}

export function markEatenAndDeduct(date, slot) {
  const day = state.days[date];
  if (!day || !day[slot] || day[slot].status === 'eaten') return false;
  const meal = getAllMeals().find(m => m.id === day[slot].mealId);
  if (!meal) return false;
  // Deduct ingredients scaled to household
  const scale = (state.profile.householdSize || 1) / (meal.servings || 1);
  (meal.ingredients || []).forEach(ing => {
    deductFromPantry(ing.name, (ing.qty || 1) * scale);
  });
  day[slot].status = 'eaten';
  saveState();
  return true;
}

export function copyDay(fromDate, toDate) {
  if (!state.days[fromDate]) return false;
  state.days[toDate] = JSON.parse(JSON.stringify(state.days[fromDate]));
  // Reset statuses for the copy
  ['breakfast', 'lunch', 'dinner'].forEach(s => {
    if (state.days[toDate][s]) state.days[toDate][s].status = 'planned';
  });
  saveState();
  return true;
}

export function undoStack() {
  if (!state._undo) state._undo = [];
  return state._undo;
}

export function pushUndo(action) {
  if (!state._undo) state._undo = [];
  // Store a snapshot of affected days
  const snapshot = JSON.parse(JSON.stringify(state.days));
  state._undo.push({ snapshot, label: action.label || 'change' });
  if (state._undo.length > 15) state._undo.shift();
  saveState();
}

export function popUndo() {
  if (!state._undo || !state._undo.length) return false;
  const last = state._undo.pop();
  if (last.snapshot) state.days = last.snapshot;
  saveState();
  return true;
}

export function exportData() {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...state }, null, 2);
}

export function importData(json) {
  try {
    const data = JSON.parse(json);
    if (data.schemaVersion && data.schemaVersion <= SCHEMA_VERSION) {
      // Simple migration: ensure required keys
      state = {
        schemaVersion: SCHEMA_VERSION,
        profile: data.profile || state.profile,
        days: data.days || {},
        customMeals: data.customMeals || [],
        pantry: data.pantry || [],
        prices: data.prices || {},
        manualItems: data.manualItems || []
      };
      saveState();
      return true;
    }
  } catch (e) {}
  return false;
}

export function resetData() {
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  saveState();
}

export function planLeftover(date, slot) {
  // Simple leftover planning stub
  const day = state.days[date];
  if (!day || !day[slot]) return false;
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  if (!state.days[tomorrowKey]) state.days[tomorrowKey] = { breakfast: null, lunch: null, dinner: null };
  state.days[tomorrowKey][slot] = { ...day[slot], status: "planned" };
  saveState();
  return true;
}
