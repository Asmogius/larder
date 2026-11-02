// Catalog validator: node scripts/validate-data.mjs  (exit 1 on errors)
import { MEALS, normalizeIngredient, CANONICAL_INGREDIENTS } from '../data.js';
import { matchIngredient, INGREDIENT_DB } from '../ingredients-db.js';
const AISLES = new Set(['produce','dairy','meat','seafood','bakery','pantry','frozen','spices','deli','other','canned','grains','condiments','beverages','snacks','international']);
const ALLERGEN_RULES = { // prefix matches so plurals count
  dairy: /\b(milk|yogurt|cheese|cheddar|feta|parmesan|mozzarella|ricotta|butter|cream|kefir|cottage|whey)/i,
  gluten: /\b(bread|muffin|flour|pasta|spaghetti|noodle|tortilla|pita|granola|barley|farro|couscous|bagel|wheat|bun|crouton|panko|naan|wrap|cracker|soy sauce)/i,
  nuts: /\b(peanut|almond|walnut|pecan|cashew|pistachio|hazelnut)/i,
  eggs: /\begg/i,
  fish: /\b(salmon|tuna|cod|tilapia|sardine|anchov|fish)/i,
  shellfish: /\b(shrimp|prawn|crab|lobster|scallop)/i,
  soy: /\b(tofu|soy|edamame|tempeh|miso)/i
};
const NEG = /\b(gluten-free|dairy-free|almond milk|oat milk|coconut milk|peanut-free|egg-free|vegan butter|corn tortilla|rice noodle|tamari)/i;
const errors = [], warnings = [];
const ids = new Set();
for (const m of MEALS) {
  const where = `${m.id}`;
  for (const f of ['id','name','slot','blurb','servings','ingredients','steps','centsPerServing'])
    if (m[f] == null || m[f] === '' ) errors.push(`${where}: missing ${f}`);
  if (ids.has(m.id)) errors.push(`${where}: duplicate id`); ids.add(m.id);
  if (!['breakfast','lunch','dinner'].includes(m.slot)) errors.push(`${where}: bad slot ${m.slot}`);
  if (!(m.servings > 0)) errors.push(`${where}: servings ${m.servings}`);
  if (!(m.centsPerServing > 0)) errors.push(`${where}: cost ${m.centsPerServing}`);
  if (!Array.isArray(m.steps) || !m.steps.length || m.steps.some(s => !String(s).trim())) errors.push(`${where}: empty steps`);
  if (!Array.isArray(m.ingredients) || !m.ingredients.length) errors.push(`${where}: no ingredients`);
  if (m.totalMin != null && m.prepMin != null && m.prepMin > m.totalMin) errors.push(`${where}: prepMin > totalMin`);
  for (const k of ['protein','carbs','fat']) if (typeof m[k] !== 'number' || m[k] < 0 || isNaN(m[k])) errors.push(`${where}: bad ${k}`);
  const est = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
  if (m.calories != null && Math.abs(m.calories - est) / Math.max(est, 1) > 0.15) errors.push(`${where}: calories ${m.calories} vs macros ${Math.round(est)}`);
  if (m.keto === true && m.carbs > 20) errors.push(`${where}: keto but ${m.carbs}g carbs`);
  if (m.keto !== true && m.carbs <= 12 && m.keto !== false) warnings.push(`${where}: low carb, keto flag unset`);
  if (est < 80 || est > 1300) errors.push(`${where}: implausible ${Math.round(est)} kcal/serving`);
  const text = (m.ingredients || []).map(i => i.name).join(' | ');
  for (const [a, re] of Object.entries(ALLERGEN_RULES)) {
    const hits = (m.ingredients || []).filter(i => re.test(i.name) && !NEG.test(i.name));
    const flagged = (m.allergens || []).includes(a);
    if (hits.length && !flagged) errors.push(`${where}: missing allergen ${a} (${hits.map(h => h.name).join(', ')})`);
    if (!hits.length && flagged) warnings.push(`${where}: allergen ${a} flagged but no matching ingredient`);
  }
  for (const i of m.ingredients || []) {
    if (!i.name || !String(i.name).trim()) { errors.push(`${where}: ingredient without name`); continue; }
    if (!(i.qty > 0)) errors.push(`${where}: ${i.name} qty ${i.qty}`);
    if (i.aisle && !AISLES.has(i.aisle)) errors.push(`${where}: ${i.name} bad aisle ${i.aisle}`);
    if (!i.aisle) errors.push(`${where}: ${i.name} missing aisle`);
    if (!matchIngredient(i.name)) warnings.push(`${where}: no ingredients-db match for "${i.name}"`);
  }
}
const dbIds = new Set();
for (const d of INGREDIENT_DB) {
  if (dbIds.has(d.id)) errors.push(`db ${d.id}: duplicate id`); dbIds.add(d.id);
  const n = d.per100g || {};
  for (const k of ['calories','protein','carbs','fat']) if (typeof n[k] !== 'number' || n[k] < 0) errors.push(`db ${d.id}: bad ${k}`);
  const est = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  if (n.calories > 40 && Math.abs(n.calories - est) / n.calories > 0.35) warnings.push(`db ${d.id}: ${n.calories} kcal vs macros ${Math.round(est)}`);
  if (!(d.gramsPerUnit > 0)) errors.push(`db ${d.id}: gramsPerUnit ${d.gramsPerUnit}`);
  if (!(d.centsPerUnit >= 0)) errors.push(`db ${d.id}: centsPerUnit`);
}
const aisleCounts = {};
for (const m of MEALS) for (const i of m.ingredients || []) aisleCounts[i.aisle] = (aisleCounts[i.aisle] || 0) + 1;
console.log(`${MEALS.length} recipes checked. ${errors.length} errors, ${warnings.length} warnings. Aisles:`, aisleCounts);
if (process.argv.includes('-v')) warnings.forEach(w => console.log('WARN', w));
errors.forEach(e => console.log('ERR ', e));
process.exit(errors.length ? 1 : 0);
