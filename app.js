/* Larder Improved — Core App Logic (iteration 2)
   Strengthened P0: better unit normalization, conversions for count units (cans),
   single cost model, conflict detection.
   Added pantry skeleton (P1 #6 foundation).
   Schema versioned localStorage. Editorial style preserved.
*/
import { MEALS, CANONICAL_INGREDIENTS, normalizeIngredient, computeNutritionFromIngredients } from './data.js';
import { matchIngredient } from './ingredients-db.js';
export { MEALS };

const SCHEMA_VERSION = 5;
// Storage key kept from v4 so existing saved data is found and migrated in place.
const STORAGE_KEY = "larder-improved-v4";
export const SLOTS = ["breakfast", "lunch", "dinner"];

// ---- Local date helpers (never use toISOString for day keys: it is UTC) ----
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Noon local time: immune to DST transitions that happen at midnight in some zones
export function parseDateKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12);
}
export function isDateKey(key) {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKey(parseDateKey(key)) === key;
}
export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
// Weeks start on Monday
export function weekStartOf(key) {
  const d = parseDateKey(key);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return dateKey(d);
}
export function weekDays(startKey) {
  return Array.from({ length: 7 }, (_, i) => addDays(startKey, i));
}

// Safe quantity parser: "1 1/2", "1/2", "1.5", "½"
const UNICODE_FRACTIONS = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
export function parseQuantity(str) {
  let total = 0;
  const parts = String(str || "").trim().replace(/([¼½¾⅓⅔⅛])/g, " $1").split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (UNICODE_FRACTIONS[part] != null) total += UNICODE_FRACTIONS[part];
    else if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split("/").map(Number); if (b) total += a / b; }
    else if (!isNaN(parseFloat(part))) total += parseFloat(part);
  }
  return total || 1;
}
const KNOWN_UNITS = ["tsp", "teaspoon", "teaspoons", "tbsp", "tablespoon", "tablespoons", "cup", "cups", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "g", "gram", "grams", "kg", "ml", "l", "can", "cans", "clove", "cloves", "pinch", "slice", "slices", "handful", "bunch", "package", "pkg", "jar", "stick", "sticks"];
const UNIT_ALIASES = { teaspoon: "tsp", teaspoons: "tsp", tablespoon: "tbsp", tablespoons: "tbsp", cups: "cup", ounce: "oz", ounces: "oz", lbs: "lb", pound: "lb", pounds: "lb", gram: "g", grams: "g", cans: "can", cloves: "clove", slices: "slice", sticks: "stick", pkg: "package" };
export function parseIngredientLine(line) {
  const s = String(line).replace(/<[^>]+>/g, "").replace(/^[-*•]\s*/, "").trim();
  if (!s) return { name: "", qty: 1, unit: "" };
  const m = s.match(/^([\d\/\.\s¼½¾⅓⅔⅛]+)\s*(.*)$/);
  if (m && /[\d¼½¾⅓⅔⅛]/.test(m[1])) {
    const qty = parseQuantity(m[1]);
    let rest = m[2].trim().replace(/^\([^)]*\)\s*/, ""); // "1 (14 oz) can beans"
    let unit = "";
    const um = rest.match(/^([a-zA-Z]+)\.?\s+(.*)$/);
    if (um && KNOWN_UNITS.includes(um[1].toLowerCase())) {
      const u = um[1].toLowerCase();
      unit = UNIT_ALIASES[u] || u;
      rest = um[2].trim();
    }
    return { qty, unit, name: rest || s };
  }
  return { qty: 1, unit: "", name: s };
}

const ALLERGEN_SYNONYMS = { egg: "eggs", milk: "dairy", lactose: "dairy", wheat: "gluten", peanut: "nuts", peanuts: "nuts", "tree nuts": "nuts", nut: "nuts", soya: "soy", shellfish: "shellfish", fish: "fish" };
export function normalizeAllergen(a) {
  const k = String(a || "").trim().toLowerCase();
  return ALLERGEN_SYNONYMS[k] || k;
}
export function getRecipeSource(meal) {
  if (!meal) return "builtin";
  if (meal.source) return meal.source;
  return meal.custom ? "custom" : "builtin";
}
function inferImported(meal) {
  const steps = meal.steps || [];
  return meal.sourceUrl || meal.blurb === "Imported" || /URL fetch blocked/.test(meal.blurb || "") ||
    (steps.length === 1 && steps[0] === "Review and edit.");
}

// Bring any older (or imported-backup) state up to the current schema without losing data
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
function sanitizeDays(days) {
  const out = {};
  if (!isObj(days)) return out;
  for (const [k, day] of Object.entries(days)) {
    if (!isDateKey(k) || !isObj(day)) continue;
    const clean = {};
    for (const slot of SLOTS) {
      const e = day[slot];
      clean[slot] = isObj(e) && (e.mealId || e.custom) ? { ...e, status: ["planned", "eaten", "skipped"].includes(e.status) ? e.status : "planned" } : null;
      if (clean[slot] && !(Number(clean[slot].servings) > 0)) delete clean[slot].servings;
    }
    out[k] = clean;
  }
  return out;
}
export function migrateState(data) {
  const s = { ...data };
  delete s._undo; // undo history is in memory only now (was bloating storage)
  s.profile = isObj(s.profile) ? { ...s.profile } : {};
  s.profile.allergens = (Array.isArray(s.profile.allergens) ? s.profile.allergens : typeof s.profile.allergens === "string" ? s.profile.allergens.split(",") : [])
    .map(normalizeAllergen).filter(Boolean);
  s.profile.goal = ["balanced", "performance", "keto"].includes(s.profile.goal) ? s.profile.goal : "balanced";
  if (!Array.isArray(s.profile.members)) s.profile.members = [];
  s.profile.members = s.profile.members.filter(isObj);
  if (!s.profile.members.length) s.profile.members = [{ id: "m1", name: "You", sex: "female", age: 34, heightFt: 5, heightIn: 6, weightLb: 150, activity: "light", goal: s.profile.goal }];
  s.profile.householdSize = s.profile.members.length;
  s.days = sanitizeDays(s.days || s.plan?.days);
  delete s.plan;
  s.customMeals = (Array.isArray(s.customMeals) ? s.customMeals : []).filter(m => isObj(m) && m.id && m.name).map(m => ({
    ...m,
    custom: true,
    source: m.source || (inferImported(m) ? "imported" : "custom"),
    slot: SLOTS.includes(m.slot) ? m.slot : "dinner",
    servings: Number(m.servings) > 0 ? Number(m.servings) : 1,
    ingredients: (Array.isArray(m.ingredients) ? m.ingredients : []).filter(i => isObj(i) && i.name),
    steps: (Array.isArray(m.steps) ? m.steps : []).map(String)
  }));
  s.pantry = (Array.isArray(s.pantry) ? s.pantry : []).filter(p => isObj(p) && p.name).map((p, i) => ({ ...p, id: String(p.id || "p" + i + "-" + Date.now()), qty: Number(p.qty) >= 0 ? Number(p.qty) : 0 }));
  s.prices = isObj(s.prices) ? s.prices : {};
  s.manualItems = (Array.isArray(s.manualItems) ? s.manualItems : []).filter(m => isObj(m) && m.name);
  s.favorites = Array.isArray(s.favorites) ? s.favorites.filter(f => typeof f === "string") : [];
  s.shopChecked = isObj(s.shopChecked) ? s.shopChecked : {};
  s.ui = isObj(s.ui) ? s.ui : { plannerView: "week" };
  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

// Unit conversion helpers (volume, weight)
const VOLUME_TO_TSP = {
  tsp: 1,
  tbsp: 3,
  cup: 48,
  ml: 0.202884, // approx
  l: 202.884
};
const WEIGHT_TO_G = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592
};

function toBaseVolume(qty, unit) {
  const u = (unit || "").toLowerCase();
  return qty * (VOLUME_TO_TSP[u] || 1);
}
function fromBaseVolume(tsp) {
  if (tsp >= 12) return { qty: tsp / 48, unit: "cup" }; // ¼ cup and up reads better in cups
  if (tsp >= 3) return { qty: tsp / 3, unit: "tbsp" };
  return { qty: tsp, unit: "tsp" };
}
function formatQuantity(qty, unit) {
  if (!unit) return smartNumber(qty);
  const u = unit.toLowerCase();
  if (["tsp", "tbsp", "cup", "ml", "l"].includes(u)) {
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
  n = Number(n);
  if (!isFinite(n)) return "0";
  const rounded = Math.round(n * 4) / 4;
  if (rounded === 0 && n > 0) return String(Math.round(n * 100) / 100);
  if (rounded === 0.25) return "¼";
  if (rounded === 0.5) return "½";
  if (rounded === 0.75) return "¾";
  if (rounded === 1.25) return "1¼";
  if (rounded === 1.5) return "1½";
  if (rounded === 1.75) return "1¾";
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function computeDailyNutrition(plannedMeals, householdSize = 1, plannedEntries = []) {
  const size = typeof householdSize === 'object' ? getHouseholdSize(householdSize) : householdSize;
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  plannedMeals.forEach((meal, i) => {
    const entry = plannedEntries[i] || {};
    const servings = entry.servings || size;
    const scale = servings / (meal.servings || 1);
    const nut = (meal.protein != null || meal.calories) ? meal : computeNutritionFromIngredients(meal.ingredients || [], meal.servings || 1);
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
  const cm = ((m.heightFt || 5) * 12 + (Number.isFinite(m.heightIn) ? m.heightIn : 6)) * 2.54;
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
    (meal.ingredients || []).forEach(ing => {
      if (!ing || !ing.name) return;
      const canon = normalizeIngredient(ing.name);
      const override = priceOverrides[canon.id];
      const cents = override != null ? override * scale : (meal.centsPerServing || 200) * scale / Math.max(1, (meal.ingredients || []).length);
      totalCents += cents;
      const key = canon.id;
      itemCosts.set(key, (itemCosts.get(key) || 0) + cents);
    });
  });
  return { total: Math.round(totalCents) / 100, itemCosts, label: "est." };
}

// Grocery aggregation: canonical IDs, merged per unit dimension (volume / weight / count-by-unit)
// so incompatible units are never summed together. Leftovers, skipped and (optionally) eaten meals are excluded.
function ingAisle(canon, rawIng) {
  if (canon.aisle && canon.aisle !== "other") return canon.aisle;
  return rawIng.aisle || matchIngredient(rawIng.name)?.aisle || "other";
}
export function aggregateGrocery(plannedMeals, options = { excludeEaten: true, dateRange: "week" }) {
  const byKey = new Map();
  (plannedMeals || []).forEach(pm => {
    if (!pm) return;
    if (options.excludeEaten !== false && pm.status === "eaten") return;
    if (pm.status === "skipped" || pm.leftover) return;
    const meal = findMeal(pm.mealId) || pm.custom;
    if (!meal || !Array.isArray(meal.ingredients)) return;
    const baseServ = meal.servings > 0 ? meal.servings : 1;
    const scale = (pm.servings > 0 ? pm.servings : baseServ) / baseServ;
    meal.ingredients.forEach(rawIng => {
      if (!rawIng || !rawIng.name) return;
      const canon = normalizeIngredient(rawIng.name);
      let qty = (Number(rawIng.qty) > 0 ? Number(rawIng.qty) : 1) * scale;
      let unit = (rawIng.unit || "").toLowerCase();
      if (canon.conversions && unit && canon.conversions[unit]) { qty *= canon.conversions[unit]; unit = "cup"; }
      const b = toBase(qty, unit);
      const key = canon.id + "|" + b.dim;
      if (!byKey.has(key)) byKey.set(key, { canon, base: 0, dim: b.dim, unit, recipes: [], aisle: ingAisle(canon, rawIng) });
      const e = byKey.get(key);
      e.base += b.v;
      if (!e.recipes.includes(meal.name)) e.recipes.push(meal.name);
    });
  });
  return Array.from(byKey.values()).map(e => {
    let qty = e.base, unit = e.unit;
    if (e.dim === "vol") { const pr = fromBaseVolume(e.base); qty = pr.qty; unit = pr.unit; }
    else if (e.dim === "wt") {
      if (unit === "g" || unit === "kg") { unit = e.base >= 1000 ? "kg" : "g"; qty = e.base / WEIGHT_TO_G[unit]; }
      else { unit = e.base >= WEIGHT_TO_G.lb ? "lb" : "oz"; qty = e.base / WEIGHT_TO_G[unit]; }
    }
    const { base, dim, ...rest } = e;
    return { ...rest, qty, unit, display: formatQuantity(qty, unit), expanded: e.recipes.join(", ") };
  }).sort((a, b) => String(a.aisle).localeCompare(String(b.aisle)) || String(a.canon.name).localeCompare(String(b.canon.name)));
}

// Subtract pantry stock from an aggregated grocery list.
// Returns { need: [...items still to buy], have: [...items fully covered by pantry] }
function toBase(qty, unit) {
  const u = (unit || "").toLowerCase();
  if (VOLUME_TO_TSP[u]) return { dim: "vol", v: qty * VOLUME_TO_TSP[u] };
  if (WEIGHT_TO_G[u]) return { dim: "wt", v: qty * WEIGHT_TO_G[u] };
  return { dim: "count:" + u, v: qty };
}
export function subtractPantry(list, pantry = []) {
  const need = [], have = [];
  list.forEach(item => {
    const stock = pantry.filter(p => p && p.name && normalizeIngredient(p.name).id === item.canon.id);
    if (!stock.length) { need.push(item); return; }
    const want = toBase(item.qty, item.unit);
    let remaining = want.v;
    let comparable = false;
    stock.forEach(p => {
      const b = toBase(p.qty || 0, p.unit);
      if (b.dim === want.dim) { remaining -= b.v; comparable = true; }
    });
    if (!comparable) { need.push({ ...item, pantryNote: stock.map(p => `${smartNumber(p.qty || 0)} ${p.unit || ""}`.trim()).join(", ") }); return; }
    if (remaining <= 0.0001) { have.push(item); return; }
    const ratio = remaining / want.v;
    const qty = item.qty * ratio;
    need.push({ ...item, qty, display: formatQuantity(qty, item.unit), partial: true });
  });
  return { need, have };
}

// Plan re-check on goal/allergen change (P0 #3)
export function checkConflicts(plan, profile) {
  const conflicts = [];
  Object.entries(plan.days || {}).forEach(([date, day]) => {
    ["breakfast", "lunch", "dinner"].forEach(slot => {
      const entry = day[slot];
      if (!entry || entry.status === "eaten" || entry.status === "skipped") return;
      const meal = findMeal(entry.mealId);
      if (!meal) return;
      const isKetoConflict = profile.goal === "keto" && meal.keto === false;
      const allergenConflict = (profile.allergens || []).some(a => meal.allergens?.includes(a));
      if (isKetoConflict || allergenConflict) {
        conflicts.push({ date, slot, mealId: meal.id, name: meal.name, reasons: [isKetoConflict ? "keto" : null, allergenConflict ? "allergen" : null].filter(Boolean) });
      }
    });
  });
  return conflicts;
}

// State management
export let loadProblem = null; // set when saved data could not be read (UI shows a notice)
export let saveErrorHandler = null;
export let state = loadState();
export function getAllMeals() {
  return [...MEALS, ...(state.customMeals || [])];
}
export function findMeal(id) {
  return MEALS.find(m => m.id === id) || (state.customMeals || []).find(m => m.id === id);
}
export function ensureDay(date) {
  if (!state.days[date]) state.days[date] = { breakfast: null, lunch: null, dinner: null };
  return state.days[date];
}
export function setSlot(date, slot, mealId) {
  const day = ensureDay(date);
  day[slot] = mealId ? { mealId, status: "planned" } : null;
  saveState();
}
// Swap the contents of two slots (either may be empty)
export function swapSlots(a, b) {
  if (a.date === b.date && a.slot === b.slot) return false;
  const da = ensureDay(a.date), db = ensureDay(b.date);
  const tmp = da[a.slot] || null;
  da[a.slot] = db[b.slot] || null;
  db[b.slot] = tmp;
  saveState();
  return true;
}
export function isFavorite(id) {
  return (state.favorites || []).includes(id);
}
export function toggleFavorite(id) {
  state.favorites = state.favorites || [];
  if (state.favorites.includes(id)) state.favorites = state.favorites.filter(f => f !== id);
  else state.favorites.push(id);
  saveState();
  return state.favorites.includes(id);
}
export function updateCustomMeal(id, patch) {
  const m = (state.customMeals || []).find(x => x.id === id);
  if (!m) return null;
  Object.assign(m, patch);
  saveState();
  return m;
}
// Returns { meal, index } so the caller can offer Undo
export function deleteCustomMeal(id) {
  const index = (state.customMeals || []).findIndex(x => x.id === id);
  if (index < 0) return null;
  const [meal] = state.customMeals.splice(index, 1);
  const wasFav = isFavorite(id);
  state.favorites = (state.favorites || []).filter(f => f !== id);
  saveState();
  return { meal, index, wasFav };
}
export function restoreCustomMeal({ meal, index, wasFav }) {
  state.customMeals.splice(Math.min(index, state.customMeals.length), 0, meal);
  if (wasFav && !isFavorite(meal.id)) state.favorites.push(meal.id);
  saveState();
}



function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { loadProblem = "storage-unavailable"; }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const migrated = migrateState(parsed);
        // Persist upgraded data right away so an older schema never lingers on disk
        if (parsed.schemaVersion !== SCHEMA_VERSION || parsed._undo) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch (_) {}
        }
        return migrated;
      }
      throw new Error("not an object");
    } catch (e) {
      // Keep the unreadable data instead of silently overwriting it on the next save
      try { localStorage.setItem(STORAGE_KEY + "-corrupt-" + Date.now(), raw); } catch (_) {}
      loadProblem = "corrupt";
    }
  }
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
    manualItems: [], // free-text grocery additions
    favorites: [],
    shopChecked: {},
    ui: { plannerView: "week" }
  };
}

export function onSaveError(fn) { saveErrorHandler = fn; }
export function saveState() {
  try {
    pruneShopChecked();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    // Quota exceeded or storage disabled: keep running in memory and tell the user
    saveErrorHandler?.(e);
    return false;
  }
}
function pruneShopChecked() {
  const keys = Object.keys(state.shopChecked || {});
  if (keys.length <= 12) return;
  keys.sort().slice(0, keys.length - 12).forEach(k => delete state.shopChecked[k]);
}

// Form validation helper (P0 #5)
export function validateRecipeForm(formData) {
  const errors = {};
  if (!formData.name?.trim()) errors.name = "Name is required";
  if (!formData.servings || isNaN(formData.servings) || Number(formData.servings) < 1) errors.servings = "Servings must be a positive number";
  if (formData.calories && (isNaN(formData.calories) || Number(formData.calories) < 0)) errors.calories = "Calories must be a non-negative number";
  if (formData.protein && (isNaN(formData.protein) || Number(formData.protein) < 0)) errors.protein = "Protein must be a non-negative number";
  if (!errors.servings && Number(formData.servings) > 99) errors.servings = "Servings must be 99 or fewer";
  if (!errors.calories && Number(formData.calories) > 5000) errors.calories = "Calories per serving looks too high (max 5000)";
  if (!errors.protein && Number(formData.protein) > 500) errors.protein = "Protein per serving looks too high (max 500 g)";
  if ((formData.name || "").length > 120) errors.name = "Name is too long (120 characters max)";
  return { valid: Object.keys(errors).length === 0, errors };
}

// Pantry helpers (P1 foundation)
export function addToPantry(item) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ...item,
    added: new Date().toISOString(),
    expiry: item.expiry || null // ISO date string optional
  };
  state.pantry.push(entry);
  saveState();
  return entry;
}

export function getExpiringSoon(days = 3) {
  const cutoff = addDays(dateKey(new Date()), days);
  return (state.pantry || []).filter(p => p.expiry && String(p.expiry).slice(0, 10) <= cutoff);
}

export function suggestUseItUp() {
  // Simple: meals that use ingredients currently in pantry
  const pantryIds = new Set((state.pantry || []).map(p => normalizeIngredient(p.name).id));
  return getAllMeals().filter(meal =>
    meal.ingredients?.some(ing => pantryIds.has(normalizeIngredient(ing.name).id))
  ).slice(0, 3);
}
// Unit-aware: only deducts from pantry entries whose unit is convertible to the recipe unit
export function deductFromPantry(ingredientName, qty, unit = "") {
  if (!ingredientName) return;
  const canon = normalizeIngredient(ingredientName);
  let unitL = String(unit || "").toLowerCase();
  if (canon.conversions && canon.conversions[unitL]) { qty *= canon.conversions[unitL]; unitL = "cup"; }
  let need = toBase(qty, unitL);
  for (const item of state.pantry.filter(p => p.name && normalizeIngredient(p.name).id === canon.id)) {
    if (need.v <= 0) break;
    const have = toBase(item.qty || 0, item.unit);
    if (have.dim !== need.dim || have.v <= 0) continue;
    const used = Math.min(have.v, need.v);
    need = { ...need, v: need.v - used };
    item.qty = (have.v - used) / (have.v / (item.qty || 1));
    if (item.qty <= 1e-6) state.pantry = state.pantry.filter(p => p.id !== item.id);
  }
  saveState();
}

export function addCustomMeal(meal) {
  const id = "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const full = { id, source: "custom", ...meal, custom: true, centsPerServing: meal.centsPerServing || 200 };
  state.customMeals.push(full);
  saveState();
  return full;
}

export function markEatenAndDeduct(date, slot) {
  const day = state.days[date];
  if (!day || !day[slot] || day[slot].status === 'eaten') return false;
  const meal = findMeal(day[slot].mealId);
  if (!meal) return false;
  // Deduct ingredients scaled to the servings planned for this meal (or household size).
  // Leftovers were cooked already, so they deduct nothing.
  if (!day[slot].leftover) {
    const scale = (day[slot].servings || getHouseholdSize(state.profile)) / (meal.servings || 1);
    (meal.ingredients || []).forEach(ing => {
      if (ing && ing.name) deductFromPantry(ing.name, (Number(ing.qty) > 0 ? Number(ing.qty) : 1) * scale, ing.unit);
    });
  }
  day[slot].status = 'eaten';
  saveState();
  return true;
}

export function copyDay(fromDate, toDate) {
  if (!state.days[fromDate]) return false;
  state.days[toDate] = JSON.parse(JSON.stringify(state.days[fromDate]));
  // Reset statuses for the copy
  ['breakfast', 'lunch', 'dinner'].forEach(s => {
    if (state.days[toDate][s]) { state.days[toDate][s].status = 'planned'; delete state.days[toDate][s].leftover; }
  });
  saveState();
  return true;
}

// Undo history lives in memory only (persisting 15 full snapshots risked the storage quota)
const undoMem = [];
export function undoStack() { return undoMem; }

export function pushUndo(action = {}) {
  const snapshot = JSON.parse(JSON.stringify(state.days));
  const pantry = JSON.parse(JSON.stringify(state.pantry || []));
  undoMem.push({ snapshot, pantry, label: action.label || 'change' });
  if (undoMem.length > 15) undoMem.shift();
}

export function popUndo() {
  if (!undoMem.length) return false;
  const last = undoMem.pop();
  if (last.snapshot) state.days = last.snapshot;
  if (last.pantry) state.pantry = last.pantry;
  saveState();
  return true;
}

export function exportData() {
  const { _undo, ...rest } = state;
  return JSON.stringify({ ...rest, schemaVersion: SCHEMA_VERSION }, null, 2);
}

export function importData(json) {
  try {
    const data = JSON.parse(json);
    if (data && typeof data === 'object' && (!data.schemaVersion || data.schemaVersion <= SCHEMA_VERSION) && (data.days || data.profile || data.customMeals)) {
      // Simple migration: ensure required keys
      const { _undo, ...rest } = data;
      state = migrateState({ ...rest, profile: data.profile || state.profile });
      undoMem.length = 0;
      saveState();
      return true;
    }
  } catch (e) {}
  return false;
}

export function resetData() {
  undoMem.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  state = loadState();
  saveState();
}

export function planLeftover(date, slot) {
  const day = state.days[date];
  if (!day || !day[slot]) return false;
  const tomorrowKey = addDays(date, 1);
  if (!state.days[tomorrowKey]) state.days[tomorrowKey] = { breakfast: null, lunch: null, dinner: null };
  state.days[tomorrowKey][slot] = { ...day[slot], status: "planned", leftover: true };
  saveState();
  return true;
}
export { formatQuantity, smartNumber };
