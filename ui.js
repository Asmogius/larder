/* Larder Improved — UI layer (iteration 3)
   Added validated recipe form UI, Shop pantry integration, improved Week skeleton.
   Accessible focus, labels, role=alert.
*/
import { state, saveState, MEALS, aggregateGrocery, computeCost, checkConflicts, validateRecipeForm, addToPantry, addCustomMeal, getAllMeals, getExpiringSoon, suggestUseItUp, markEatenAndDeduct, planLeftover, exportData, importData, resetData, copyDay, pushUndo, popUndo, computeDailyNutrition, getTargets, getHouseholdSize } from './app.js';
import { normalizeIngredient } from './data.js';

function showUndoToast(message) {
  let toast = document.getElementById('undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:0.75rem 1rem;border-radius:8px;z-index:2000;display:flex;gap:1rem;align-items:center;';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>${message}</span><button id="undo-btn" style="background:#fff;color:#1a1a1a;">Undo</button>`;
  toast.hidden = false;
  document.getElementById('undo-btn').onclick = () => {
    if (popUndo()) {
      toast.hidden = true;
      renderPage(document.querySelector('.page:not([hidden])')?.id || 'today');
    }
  };
  setTimeout(() => { toast.hidden = true; }, 5000);
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.hidden = true);
  const page = document.getElementById(id);
  if (page) {
    page.hidden = false;
    page.focus();
  }
}

// Navigation
document.querySelectorAll('nav a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const target = a.getAttribute('href').slice(1);
    showPage(target);
    renderPage(target);
  });
});

function renderPage(page) {
  if (page === 'today') renderToday();
  if (page === 'shop') renderShop();
  if (page === 'settings') renderSettings();
  if (page === 'meals') renderMeals();
  if (page === 'week') renderWeek();
  if (page === 'pantry') renderPantry();
  if (page === 'review') renderReview();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDay(date) {
  if (!state.days[date]) state.days[date] = { breakfast: null, lunch: null, dinner: null };
  return state.days[date];
}

function renderToday() {
  const el = document.getElementById('today-content');
  const today = getTodayKey();
  const day = ensureDay(today);
  const planned = [day.breakfast, day.lunch, day.dinner].filter(Boolean);
  const allMeals = getAllMeals();
  const nut = computeDailyNutrition(planned.map(p => allMeals.find(m => m.id === p?.mealId)).filter(Boolean), getHouseholdSize(state.profile));
  const targets = getTargets(state.profile);
  const cost = computeCost(planned.map(p => allMeals.find(m => m.id === p?.mealId)).filter(Boolean), getHouseholdSize(state.profile), state.prices || {});
  el.innerHTML = `
    <p>${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${state.profile.goal} · ${getHouseholdSize(state.profile)} person</p>
    <div class="card">
      <h3>Breakfast ${day.breakfast ? '' : 'OPEN'}</h3>
      ${day.breakfast ? `<p>${allMeals.find(m => m.id === day.breakfast.mealId)?.name || 'Custom'} <button data-slot="breakfast" data-action="clear">Clear</button> <button data-slot="breakfast" data-action="ate">We ate this</button> <button data-slot="breakfast" data-action="cook">Cook</button> <button data-slot="breakfast" data-action="leftover">Leftover tomorrow</button></p>` : '<button data-slot="breakfast" data-action="add">Add breakfast</button>'}
    </div>
    <div class="card">
      <h3>Lunch ${day.lunch ? '' : 'OPEN'}</h3>
      ${day.lunch ? `<p>${allMeals.find(m => m.id === day.lunch.mealId)?.name || 'Custom'} <button data-slot="lunch" data-action="clear">Clear</button> <button data-slot="lunch" data-action="ate">We ate this</button> <button data-slot="lunch" data-action="cook">Cook</button> <button data-slot="lunch" data-action="leftover">Leftover tomorrow</button></p>` : '<button data-slot="lunch" data-action="add">Add lunch</button>'}
    </div>
    <div class="card">
      <h3>Dinner ${day.dinner ? '' : 'OPEN'}</h3>
      ${day.dinner ? `<p>${allMeals.find(m => m.id === day.dinner.mealId)?.name || 'Custom'} <button data-slot="dinner" data-action="clear">Clear</button> <button data-slot="dinner" data-action="ate">We ate this</button> <button data-slot="dinner" data-action="cook">Cook</button> <button data-slot="dinner" data-action="leftover">Leftover tomorrow</button></p>` : '<button data-slot="dinner" data-action="add">Add dinner</button>'}
    </div>
    <aside class="card">
      <h3>If this day stands</h3>
      <p>Calories ${nut.calories} / ${targets.calories} · Protein ${nut.protein}g / ${targets.protein}g · Carbs ${nut.carbs}g / ${targets.carbs}g · Fat ${nut.fat}g / ${targets.fat}g</p>
      <p>Cost ${cost.total.toFixed(2)} ${cost.label}</p>
      <button id="suggest-btn">Suggest open meals</button>
    </aside>
  `;
  // Wire buttons
  el.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.slot;
      const action = btn.dataset.action;
      if (action === 'clear') {
        day[slot] = null;
        saveState();
        renderToday();
      } else if (action === 'ate') {
        if (markEatenAndDeduct(today, slot)) {
          alert('Marked eaten and deducted ingredients from pantry (where stocked).');
        }
        renderToday();
      } else if (action === 'cook') {
        const meal = allMeals.find(m => m.id === day[slot]?.mealId);
        if (meal) openCookMode(meal);
      } else if (action === 'leftover') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomKey = tomorrow.toISOString().slice(0, 10);
        if (planLeftover(today, slot, tomKey, slot)) {
          alert('Planned as leftover for tomorrow.');
        }
        renderToday();
      } else if (action === 'add') {
        const meal = allMeals.find(m => m.slot === slot && !state.profile.allergens.some(a => m.allergens?.includes(a)));
        if (meal) {
          day[slot] = { mealId: meal.id, status: 'planned' };
          saveState();
          renderToday();
        }
      }
    });
  });
  document.getElementById('suggest-btn')?.addEventListener('click', () => {
    const pantryIds = new Set((state.pantry || []).map(p => normalizeIngredient(p.name).id));
    ['breakfast', 'lunch', 'dinner'].forEach(slot => {
      if (!day[slot]) {
        // Prefer meals that use pantry items
        let meal = allMeals.find(m => m.slot === slot && !state.profile.allergens.some(a => m.allergens?.includes(a)) && m.ingredients?.some(ing => pantryIds.has(normalizeIngredient(ing.name).id)));
        if (!meal) meal = allMeals.find(m => m.slot === slot && !state.profile.allergens.some(a => m.allergens?.includes(a)));
        if (meal) day[slot] = { mealId: meal.id, status: 'planned' };
      }
    });
    saveState();
    renderToday();
  });
}

function renderShop() {
  const el = document.getElementById('shop-content');
  const planned = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const day = state.days[key];
    if (day) {
      ['breakfast', 'lunch', 'dinner'].forEach(slot => {
        if (day[slot] && day[slot].mealId) planned.push(day[slot]);
      });
    }
  }
  const allMeals = getAllMeals();
  const list = aggregateGrocery(planned, { excludeEaten: true });
  const total = computeCost(planned.map(p => allMeals.find(m => m.id === p.mealId)).filter(Boolean), getHouseholdSize(state.profile));
  el.innerHTML = `
    <p>Grocery list · ${total.total.toFixed(2)} ${total.label} · Next 7 days</p>
    <ul style="list-style:none; padding:0;">
      ${list.map((item, idx) => `<li class="card" style="margin-bottom:0.5rem;"><label><input type="checkbox" data-idx="${idx}"> ${item.display} ${item.canon.name}</label> <small style="color:var(--muted);">(${item.expanded})</small> <button data-add-pantry="${idx}" style="margin-left:0.5rem; font-size:0.8rem;">Add to pantry</button> <input type="number" data-price="${item.canon.id}" placeholder="price est." step="0.01" style="width:80px; margin-left:0.5rem;" value="${((state.prices || {})[item.canon.id] || 0) / 100 || ''}"></li>`).join('') || '<li>No planned meals in the next 7 days.</li>'}
    </ul>
    <button id="add-manual">Add manual item</button>
    <button id="copy-list">Copy list</button>
    <button id="share-list">Share</button>
    <p>Date range: <select id="range"><option value="7">Next 7 days</option><option value="week">Rest of this week</option><option value="custom">Custom</option></select></p>
    <label><input type="checkbox" id="include-eaten"> Include already eaten</label>
    <p><small>Check off or use “Add to pantry” to track inventory (P1 foundation).</small></p>
  `;
  el.querySelectorAll('[data-add-pantry]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = list[Number(btn.dataset.addPantry)];
      addToPantry({ name: item.canon.name, qty: item.qty, unit: item.unit, location: item.aisle });
      alert(`Added ${item.display} ${item.canon.name} to pantry.`);
    });
  });
  el.querySelectorAll('[data-price]').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.price;
      const val = parseFloat(input.value);
      if (!isNaN(val) && val >= 0) {
        state.prices = state.prices || {};
        state.prices[id] = Math.round(val * 100);
        saveState();
        renderShop();
      }
    });
  });
  document.getElementById('copy-list')?.addEventListener('click', () => {
    const text = list.map(i => `${i.display} ${i.canon.name}`).join('\n');
    navigator.clipboard.writeText(text).then(() => alert('List copied'));
  });
  document.getElementById('share-list')?.addEventListener('click', () => {
    const text = list.map(i => `${i.display} ${i.canon.name}`).join('\n');
    if (navigator.share) navigator.share({ title: 'Grocery list', text }).catch(() => {});
    else alert('Share not supported; list copied instead.');
  });
  document.getElementById('add-manual')?.addEventListener('click', () => {
    const name = prompt('Item name:');
    if (name) {
      state.manualItems = state.manualItems || [];
      state.manualItems.push({ name, qty: 1, unit: '' });
      saveState();
      renderShop();
    }
  });
}

function renderSettings() {
  const el = document.getElementById('settings-content');
  const members = state.profile.members || [];
  const size = members.length || getHouseholdSize(state.profile) || 1;
  el.innerHTML = `
    <form id="settings-form">
      <label>Default goal
        <select name="goal">
          <option value="balanced" ${state.profile.goal === 'balanced' ? 'selected' : ''}>Balanced</option>
          <option value="performance" ${state.profile.goal === 'performance' ? 'selected' : ''}>Performance</option>
          <option value="keto" ${state.profile.goal === 'keto' ? 'selected' : ''}>Keto</option>
        </select>
      </label>
      <label>Allergens (comma-separated) <input name="allergens" value="${(state.profile.allergens || []).join(', ')}"></label>
      <button type="submit">Save goal & allergens</button>
    </form>
    <div class="card">
      <h3>Household (${size})</h3>
      <p>Each person has their own biometrics. Targets and serving scaling use these.</p>
      <div id="members-list">
        ${members.map((m, i) => `
          <div class="card" style="margin-bottom:0.5rem; padding:0.75rem;">
            <strong>${m.name || 'Person ' + (i+1)}</strong>
            <form data-member="${i}" style="margin-top:0.5rem;">
              <label>Name <input name="name" value="${m.name || ''}"></label>
              <label>Sex
                <select name="sex">
                  <option value="female" ${m.sex === 'female' ? 'selected' : ''}>Female</option>
                  <option value="male" ${m.sex === 'male' ? 'selected' : ''}>Male</option>
                </select>
              </label>
              <label>Age <input type="number" name="age" value="${m.age || 30}" min="1" max="120"></label>
              <label>Height <input type="number" name="heightFt" value="${m.heightFt || 5}" min="3" max="8" style="width:50px;"> ft
                <input type="number" name="heightIn" value="${m.heightIn || 6}" min="0" max="11" style="width:50px;"> in</label>
              <label>Weight (lb) <input type="number" name="weightLb" value="${m.weightLb || 150}" min="50" max="500"></label>
              <label>Activity
                <select name="activity">
                  <option value="sedentary" ${m.activity === 'sedentary' ? 'selected' : ''}>Sedentary</option>
                  <option value="light" ${m.activity === 'light' ? 'selected' : ''}>Light</option>
                  <option value="moderate" ${m.activity === 'moderate' ? 'selected' : ''}>Moderate</option>
                  <option value="active" ${m.activity === 'active' ? 'selected' : ''}>Active</option>
                </select>
              </label>
              <label>Goal
                <select name="goal">
                  <option value="balanced" ${m.goal === 'balanced' ? 'selected' : ''}>Balanced</option>
                  <option value="performance" ${m.goal === 'performance' ? 'selected' : ''}>Performance</option>
                  <option value="keto" ${m.goal === 'keto' ? 'selected' : ''}>Keto</option>
                </select>
              </label>
              <button type="submit">Save</button>
              ${members.length > 1 ? `<button type="button" data-remove="${i}" style="margin-left:0.5rem;">Remove</button>` : ''}
            </form>
          </div>
        `).join('')}
      </div>
      <button id="add-member" type="button">Add person</button>
    </div>
    <div class="card">
      <h3>Data</h3>
      <button id="export-btn">Export JSON backup</button>
      <button id="import-btn">Import JSON</button>
      <input type="file" id="import-file" accept=".json" hidden>
      <button id="reset-btn">Reset all data</button>
    </div>
    <div id="settings-errors" role="alert" hidden></div>
    <div id="conflicts" class="card" hidden></div>
  `;
  document.getElementById('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const allergens = (form.get('allergens') || '').split(',').map(s => s.trim()).filter(Boolean);
    state.profile.goal = form.get('goal');
    state.profile.allergens = allergens;
    state.profile.householdSize = (state.profile.members || []).length || 1;
    saveState();
    renderSettings();
  });
  el.querySelectorAll('form[data-member]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const i = Number(form.dataset.member);
      const fd = new FormData(form);
      const m = state.profile.members[i];
      m.name = fd.get('name') || m.name;
      m.sex = fd.get('sex');
      m.age = Number(fd.get('age'));
      m.heightFt = Number(fd.get('heightFt'));
      m.heightIn = Number(fd.get('heightIn'));
      m.weightLb = Number(fd.get('weightLb'));
      m.activity = fd.get('activity');
      m.goal = fd.get('goal');
      state.profile.householdSize = state.profile.members.length;
      saveState();
      renderSettings();
    });
  });
  el.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.remove);
      state.profile.members.splice(i, 1);
      state.profile.householdSize = state.profile.members.length || 1;
      saveState();
      renderSettings();
    });
  });
  document.getElementById('add-member')?.addEventListener('click', () => {
    if (!state.profile.members) state.profile.members = [];
    state.profile.members.push({
      id: 'm' + Date.now(),
      name: 'Person ' + (state.profile.members.length + 1),
      sex: 'female',
      age: 30,
      heightFt: 5,
      heightIn: 6,
      weightLb: 150,
      activity: 'light',
      goal: state.profile.goal || 'balanced'
    });
    state.profile.householdSize = state.profile.members.length;
    saveState();
    renderSettings();
  });
  document.getElementById('export-btn')?.addEventListener('click', () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'larder-backup.json';
    a.click();
  });
  document.getElementById('import-btn')?.addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (importData(reader.result)) renderSettings();
      else alert('Import failed');
    };
    reader.readAsText(file);
  });
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset all data?')) { resetData(); renderSettings(); }
  });
}


function renderMeals() {
  const allMeals = getAllMeals();
  const el = document.getElementById('meals-content');
  el.innerHTML = `
    <p>${allMeals.length} recipes. Estimated prices shown as "est."</p>
    <button class="btn" id="new-recipe">Write a recipe</button>
    <button class="btn" id="import-recipe" style="margin-left:0.5rem;">Import from URL / text</button>
    <div id="recipe-form" class="card" hidden>
      <h3>New recipe</h3>
      <form id="recipe-form-el">
        <div id="form-errors" role="alert" hidden></div>
        <label>Name <input name="name" required></label><div class="error" data-field="name"></div>
        <label>Slot
          <select name="slot">
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
          </select>
        </label>
        <label>Servings <input name="servings" type="number" min="1" inputmode="numeric" value="1"></label><div class="error" data-field="servings"></div>
        <label>Calories (optional) <input name="calories" type="number" min="0" inputmode="numeric"></label><div class="error" data-field="calories"></div>
        <label>Protein g (optional) <input name="protein" type="number" min="0" inputmode="numeric"></label><div class="error" data-field="protein"></div>
        <label>Blurb <textarea name="blurb" rows="2" style="width:100%;max-width:400px;"></textarea></label>
        <button type="submit">Save recipe</button>
        <button type="button" id="cancel-recipe">Cancel</button>
      </form>
    </div>
    <div id="import-panel" class="card" hidden>
      <h3>Import recipe</h3>
      <p>Paste a recipe URL or raw text (schema.org/Recipe preferred).</p>
      <textarea id="import-text" rows="4" style="width:100%;" placeholder="https://example.com/recipe or paste recipe text"></textarea>
      <button id="do-import">Import</button>
      <button type="button" id="cancel-import">Cancel</button>
      <div id="import-result"></div>
    </div>
    <div>${allMeals.map(m => `<div class="card"><h3>${m.name}${m.custom ? ' <small>(Yours)</small>' : ''}</h3><p>${m.blurb || ''}</p><small>${m.totalMin || '?'} min · $${((m.centsPerServing || 200)/100).toFixed(2)} est. · ${m.slot}</small></div>`).join('')}</div>
  `;
  document.getElementById('new-recipe')?.addEventListener('click', () => {
    document.getElementById('recipe-form').hidden = false;
    document.getElementById('import-panel').hidden = true;
  });
  document.getElementById('import-recipe')?.addEventListener('click', () => {
    document.getElementById('import-panel').hidden = false;
    document.getElementById('recipe-form').hidden = true;
  });
  document.getElementById('cancel-recipe')?.addEventListener('click', () => {
    document.getElementById('recipe-form').hidden = true;
  });
  document.getElementById('cancel-import')?.addEventListener('click', () => {
    document.getElementById('import-panel').hidden = true;
  });
  document.getElementById('recipe-form-el')?.addEventListener('submit', e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const data = Object.fromEntries(form);
    const result = validateRecipeForm(data);
    const errorSummary = document.getElementById('form-errors');
    document.querySelectorAll('.error').forEach(el => el.textContent = '');
    if (!result.valid) {
      errorSummary.hidden = false;
      errorSummary.textContent = 'Please fix the errors below.';
      Object.entries(result.errors).forEach(([field, msg]) => {
        const errEl = document.querySelector(`.error[data-field="${field}"]`);
        if (errEl) errEl.textContent = msg;
      });
      const first = Object.keys(result.errors)[0];
      document.querySelector(`[name="${first}"]`)?.focus();
    } else {
      errorSummary.hidden = true;
      const meal = {
        name: data.name,
        slot: data.slot,
        servings: Number(data.servings),
        blurb: data.blurb || '',
        ingredients: [],
        steps: [],
        protein: Number(data.protein) || 0,
        calories: Number(data.calories) || 0,
        centsPerServing: 200
      };
      addCustomMeal(meal);
      document.getElementById('recipe-form').hidden = true;
      renderMeals();
    }
  });
  document.getElementById('do-import')?.addEventListener('click', async () => {
    const text = document.getElementById('import-text').value.trim();
    const resultEl = document.getElementById('import-result');
    if (!text) {
      resultEl.textContent = 'Please paste a URL or recipe text.';
      return;
    }
    resultEl.innerHTML = '<p>Importing…</p>';

    const parsed = await parseRecipeImport(text);
    if (!parsed || !parsed.name) {
      resultEl.innerHTML = '<p>Could not extract a recipe. Try pasting the full recipe text, or a different site.</p>';
      return;
    }

    // Review form before save
    resultEl.innerHTML = `
      <div class="card">
        <h4>Review import</h4>
        <label>Name <input id="imp-name" value="${escapeHtml(parsed.name)}" style="width:100%;"></label>
        <label>Servings <input id="imp-servings" type="number" min="1" value="${parsed.servings || 2}" style="width:80px;"></label>
        <label>Blurb <textarea id="imp-blurb" rows="2" style="width:100%;">${escapeHtml(parsed.blurb || '')}</textarea></label>
        <p><strong>Ingredients (${parsed.ingredients.length})</strong></p>
        <ul style="font-size:0.9rem;">${parsed.ingredients.map(i => `<li>${i.qty || 1} ${i.unit || ''} ${escapeHtml(i.name)}</li>`).join('')}</ul>
        <p><strong>Steps (${(parsed.steps || []).length})</strong></p>
        <ol style="font-size:0.9rem;">${(parsed.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        <button id="save-import">Save as custom recipe</button>
        <button type="button" id="cancel-import-review">Cancel</button>
      </div>
    `;
    document.getElementById('cancel-import-review')?.addEventListener('click', () => {
      document.getElementById('import-panel').hidden = true;
    });
    document.getElementById('save-import')?.addEventListener('click', () => {
      const name = document.getElementById('imp-name').value.trim() || parsed.name;
      const servings = Number(document.getElementById('imp-servings').value) || 2;
      const blurb = document.getElementById('imp-blurb').value.trim();
      addCustomMeal({
        name,
        slot: 'dinner',
        servings,
        blurb: blurb || 'Imported',
        ingredients: parsed.ingredients,
        steps: parsed.steps && parsed.steps.length ? parsed.steps : ['Review and edit.'],
        centsPerServing: 200
      });
      document.getElementById('import-panel').hidden = true;
      renderMeals();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
}

async function parseRecipeImport(input) {
  let html = '';
  let name = '';
  let ingredients = [];
  let steps = [];
  let servings = 2;
  let blurb = '';

  if (/^https?:\/\//i.test(input)) {
    // Direct fetch only. In the Capacitor Android APK, CapacitorHttp (enabled in config)
    // patches fetch to use native HTTP, bypassing CORS. In the browser this may fail.
    try {
      const res = await fetch(input, { headers: { 'Accept': 'text/html' } });
      if (res.ok) {
        html = await res.text();
      }
    } catch (e) { /* fall through */ }
    if (!html || html.length < 200) {
      name = input.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || 'Imported recipe';
      return { name, ingredients: [], steps: [], servings: 2, blurb: 'URL fetch blocked in the browser. In the Android app this works natively. Or paste the recipe text.' };
    }
  } else {
    html = input;
  }

  // 1. JSON-LD (schema.org Recipe), including @graph and arrays
  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldMatches) {
    try {
      let data = JSON.parse(m[1].trim());
      const candidates = [];
      const collect = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(collect); return; }
        const types = [].concat(obj['@type'] || []);
        if (types.some(t => /Recipe/i.test(t))) candidates.push(obj);
        if (obj['@graph']) collect(obj['@graph']);
        Object.values(obj).forEach(v => { if (typeof v === 'object') collect(v); });
      };
      collect(data);
      const recipe = candidates[0];
      if (recipe) {
        name = recipe.name || name;
        blurb = recipe.description || blurb;
        servings = parseInt(recipe.recipeYield) || servings;
        const ings = recipe.recipeIngredient || recipe.ingredients || [];
        ingredients = ings.map(parseIngredientLine).filter(i => i.name);
        const instr = recipe.recipeInstructions || recipe.instructions || [];
        steps = (Array.isArray(instr) ? instr : [instr]).flatMap(s => {
          if (typeof s === 'string') return [s];
          if (s.text) return [s.text];
          if (s.itemListElement) return s.itemListElement.map(i => i.text || i).filter(Boolean);
          return [];
        }).map(s => String(s).trim()).filter(Boolean);
        if (name && ingredients.length) return { name, ingredients, steps, servings, blurb };
      }
    } catch (e) { /* continue */ }
  }

  // 2. Microdata fallback
  const nameMatch = html.match(/itemprop=["']name["'][^>]*>([^<]+)/i) || html.match(/<h1[^>]*>([^<]+)/i);
  if (nameMatch) name = nameMatch[1].trim();
  const ingMatches = [...html.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([^<]+)/gi)];
  if (ingMatches.length) {
    ingredients = ingMatches.map(m => parseIngredientLine(m[1])).filter(i => i.name);
  }
  const stepMatches = [...html.matchAll(/itemprop=["']recipeInstructions["'][^>]*>([^<]+)/gi)];
  if (stepMatches.length) steps = stepMatches.map(m => m[1].trim()).filter(Boolean);

  // 3. Plain text / paste heuristics
  if (!ingredients.length) {
    const lines = html.split(/\n|<br\s*\/?>/i).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    if (!name && lines[0]) name = lines[0];
    let mode = 'none';
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (/ingredient/.test(lower)) { mode = 'ing'; continue; }
      if (/instruction|direction|method|step/.test(lower)) { mode = 'step'; continue; }
      if (mode === 'step' || /^\d+[\.\)]\s/.test(line)) {
        steps.push(line.replace(/^\d+[\.\)]\s*/, ''));
      } else if (mode === 'ing' || /^\d/.test(line)) {
        const parsedIng = parseIngredientLine(line);
        if (parsedIng.name) ingredients.push(parsedIng);
      }
    }
  }

  if (!name) name = 'Imported recipe';
  return { name, ingredients, steps, servings, blurb };
}

function parseIngredientLine(line) {
  const s = String(line).replace(/<[^>]+>/g, '').trim();
  if (!s) return { name: '', qty: 1, unit: '' };
  // Common patterns: "2 cups flour", "1/2 tsp salt", "3 large eggs"
  const m = s.match(/^([\d\/\.\s]+)\s*([a-zA-Z]+)?\s+(.*)$/);
  if (m) {
    let qty = 1;
    try { qty = eval(m[1].replace(/\s+/g, '')) || 1; } catch { qty = parseFloat(m[1]) || 1; }
    return { qty, unit: m[2] || '', name: m[3].trim() };
  }
  return { qty: 1, unit: '', name: s };
}

function renderPantry() {
  const el = document.getElementById('pantry-content');
  const items = state.pantry || [];
  const expiring = getExpiringSoon(3);
  const suggestions = suggestUseItUp();
  el.innerHTML = `
    <p>${items.length} items in pantry.</p>
    ${expiring.length ? `<div class="card" role="alert" style="background:#fff3cd;"><strong>Expiring soon:</strong> ${expiring.map(e => e.name).join(', ')}</div>` : ''}
    ${suggestions.length ? `<div class="card"><strong>Use it up:</strong> ${suggestions.map(s => s.name).join(', ')}</div>` : ''}
    <div class="card">
      <h3>Scan receipt</h3>
      <p>Upload a photo of a store receipt. Text is extracted on your device (never leaves the browser).</p>
      <input type="file" id="receipt-file" accept="image/*" capture="environment" style="margin-bottom:0.5rem;">
      <button id="scan-receipt" disabled>Scan receipt</button>
      <div id="scan-status" style="margin-top:0.5rem;"></div>
      <div id="scan-results"></div>
    </div>
    ${items.length ? items.map(item => `
      <div class="card">
        <strong>${item.name}</strong> · ${item.qty || 0} ${item.unit || ''}
        <br><small>Location: ${item.location || 'pantry'} · Added ${new Date(item.added).toLocaleDateString()}${item.expiry ? ` · Expires ${new Date(item.expiry).toLocaleDateString()}` : ''}</small>
        <button data-remove="${item.id}" style="margin-top:0.5rem;">Remove</button>
      </div>
    `).join('') : '<p class="card">Pantry is empty. Add items from the Shop list or scan a receipt.</p>'}
    <p><small>Cooking a meal can deduct ingredients (foundation ready).</small></p>
  `;
  // Wire remove
  el.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pantry = state.pantry.filter(p => p.id !== btn.dataset.remove);
      saveState();
      renderPantry();
    });
  });
  // Receipt scanning
  const fileInput = document.getElementById('receipt-file');
  const scanBtn = document.getElementById('scan-receipt');
  const statusEl = document.getElementById('scan-status');
  const resultsEl = document.getElementById('scan-results');
  fileInput.addEventListener('change', () => {
    scanBtn.disabled = !fileInput.files?.length;
  });
  scanBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    statusEl.textContent = 'Scanning receipt on device…';
    scanBtn.disabled = true;
    try {
      const { data: { text } } = await Tesseract.recognize(file, 'eng', {
        logger: m => { if (m.status === 'recognizing text') statusEl.textContent = `Scanning… ${Math.round(m.progress * 100)}%`; }
      });
      const items = parseReceiptText(text);
      statusEl.textContent = `Found ${items.length} possible food items.`;
      if (items.length) {
        resultsEl.innerHTML = `
          <ul style="list-style:none; padding:0;">
            ${items.map((it, i) => `<li class="card" style="margin-bottom:0.5rem;"><label><input type="checkbox" data-idx="${i}" checked> ${it.name} <small>(${it.qty} ${it.unit})</small></label></li>`).join('')}
          </ul>
          <button id="add-selected">Add selected to pantry</button>
        `;
        document.getElementById('add-selected').addEventListener('click', () => {
          const checks = resultsEl.querySelectorAll('input[type="checkbox"]:checked');
          let added = 0;
          checks.forEach(cb => {
            const it = items[Number(cb.dataset.idx)];
            addToPantry({ name: it.name, qty: it.qty, unit: it.unit, location: 'pantry' });
            added++;
          });
          statusEl.textContent = `Added ${added} items to pantry.`;
          resultsEl.innerHTML = '';
          renderPantry();
        });
      } else {
        resultsEl.innerHTML = '<p>No clear food items detected. Try a clearer photo or add manually.</p>';
      }
    } catch (err) {
      statusEl.textContent = 'Scan failed. Try a clearer image.';
      console.error(err);
    }
    scanBtn.disabled = false;
  });
}

// Simple receipt parser: look for lines that look like food items
function parseReceiptText(text) {
  const foodKeywords = ['milk', 'eggs', 'egg', 'bread', 'chicken', 'beef', 'yogurt', 'cheese', 'apple', 'banana', 'onion', 'garlic', 'rice', 'beans', 'tomato', 'spinach', 'oats', 'oil', 'butter', 'pasta', 'salmon', 'potato', 'carrot', 'pepper', 'lettuce', 'cucumber', 'avocado', 'berry', 'berries', 'granola', 'salsa', 'tortilla', 'lentil', 'chickpea', 'bacon', 'shrimp', 'cod', 'sausage', 'farro', 'barley'];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 60);
  const items = [];
  lines.forEach(line => {
    const lower = line.toLowerCase();
    const isFood = foodKeywords.some(kw => lower.includes(kw)) || /\b(oz|lb|cup|can|pack|ct)\b/i.test(line);
    if (isFood && !/total|tax|change|cash|visa|mastercard|subtotal|balance/i.test(line)) {
      // Extract rough qty
      const qtyMatch = line.match(/(\d+\.?\d*)\s*(oz|lb|cup|can|pack|ct|g|ml)?/i);
      const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
      const unit = qtyMatch?.[2] || '';
      const name = line.replace(/\$?\d+\.?\d*/g, '').replace(/\s+/g, ' ').trim();
      if (name.length > 2) items.push({ name, qty, unit });
    }
  });
  // Dedupe by name
  const seen = new Set();
  return items.filter(it => {
    const key = it.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);
}

function renderReview() {
  const el = document.getElementById('review-content');
  const days = Object.keys(state.days || {}).length;
  const eaten = Object.values(state.days || {}).reduce((acc, day) => acc + ['breakfast','lunch','dinner'].filter(s => day[s]?.status === 'eaten').length, 0);
  const pantryCount = (state.pantry || []).length;
  const customCount = (state.customMeals || []).length;
  el.innerHTML = `
    <p>Review</p>
    <div class="card">
      <p>Days with plans: ${days}</p>
      <p>Meals marked eaten: ${eaten}</p>
      <p>Pantry items: ${pantryCount}</p>
      <p>Custom recipes: ${customCount}</p>
    </div>
    <p><small>Local-only insights. No data leaves the device.</small></p>
  `;
}

function renderWeek() {
  const daysHtml = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const day = state.days[key] || {};
    const slots = ['breakfast', 'lunch', 'dinner'].map(slot => {
      const entry = day[slot];
      const name = entry ? (getAllMeals().find(m => m.id === entry.mealId)?.name || 'Meal') : '—';
      return `<div class="meal-slot" draggable="${!!entry}" data-date="${key}" data-slot="${slot}" style="padding:0.25rem; margin:0.25rem 0; background:#f0f0f0; border-radius:4px; cursor:${entry ? 'grab' : 'default'};">${slot}: ${name}${entry?.leftover ? ' (leftover)' : ''}</div>`;
    }).join('');
    daysHtml.push(`<div class="card week-day" data-date="${key}"><strong>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong><br>${slots}<button data-copy="${key}" style="margin-top:0.5rem; font-size:0.8rem;">Copy day</button></div>`);
  }
  el.innerHTML = `<p>Week. Drag meals between slots/days. Copy a day to the next.</p><div id="week-days">${daysHtml.join('')}</div>`;
  // Meal drag-and-drop
  el.querySelectorAll('.meal-slot[draggable="true"]').forEach(slotEl => {
    slotEl.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ date: slotEl.dataset.date, slot: slotEl.dataset.slot }));
    });
  });
  el.querySelectorAll('.week-day').forEach(dayEl => {
    dayEl.addEventListener('dragover', e => e.preventDefault());
    dayEl.addEventListener('drop', e => {
      e.preventDefault();
      const data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
      const toDate = dayEl.dataset.date;
      const toSlot = e.target.closest('.meal-slot')?.dataset.slot || 'dinner';
      if (data.date && data.slot && (data.date !== toDate || data.slot !== toSlot)) {
        const fromDay = state.days[data.date];
        if (fromDay && fromDay[data.slot]) {
          pushUndo({ restore: () => { /* simple restore stub */ } });
          if (!state.days[toDate]) state.days[toDate] = { breakfast: null, lunch: null, dinner: null };
          state.days[toDate][toSlot] = fromDay[data.slot];
          fromDay[data.slot] = null;
          saveState();
          showUndoToast('Meal moved');
          renderWeek();
        }
      }
    });
  });
  el.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const from = btn.dataset.copy;
      const next = new Date(from);
      next.setDate(next.getDate() + 1);
      const to = next.toISOString().slice(0, 10);
      if (copyDay(from, to)) {
        showUndoToast('Day copied');
        renderWeek();
      }
    });
  });
}

// Basic Cook mode (P2 #14 foundation): step-by-step, Escape to close, arrow keys, simple timer
function openCookMode(meal) {
  let step = 0;
  const steps = meal.steps || ['No steps listed.'];
  const overlay = document.createElement('div');
  overlay.id = 'cook-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#f7f4ef;z-index:1000;padding:1rem;overflow:auto;';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <h2>${meal.name}</h2>
    <p>Step <span id="step-num">${step + 1}</span> of ${steps.length}</p>
    <div id="step-text" class="card" style="font-size:1.25rem;min-height:8rem;">${steps[step]}</div>
    <div style="margin-top:1rem;">
      <button id="prev-step">← Previous</button>
      <button id="next-step">Next →</button>
      <button id="start-timer">Start 5 min timer</button>
      <span id="timer-display"></span>
    </div>
    <button id="close-cook" style="margin-top:1rem;">Close (Esc)</button>
  `;
  document.body.appendChild(overlay);
  // Focus trap and initial focus
  const focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  first?.focus();
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  const stepNum = overlay.querySelector('#step-num');
  const stepText = overlay.querySelector('#step-text');
  let timerId = null;
  function updateStep() {
    stepNum.textContent = step + 1;
    stepText.textContent = steps[step];
  }
  overlay.querySelector('#prev-step').addEventListener('click', () => { if (step > 0) { step--; updateStep(); } });
  overlay.querySelector('#next-step').addEventListener('click', () => { if (step < steps.length - 1) { step++; updateStep(); } });
  overlay.querySelector('#start-timer').addEventListener('click', () => {
    let secs = 5 * 60;
    const display = overlay.querySelector('#timer-display');
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      secs--;
      display.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (secs <= 0) { clearInterval(timerId); display.textContent = 'Done!'; }
    }, 1000);
  });
  function close() {
    if (timerId) clearInterval(timerId);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  overlay.querySelector('#close-cook').addEventListener('click', close);
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && step < steps.length - 1) { step++; updateStep(); }
    if (e.key === 'ArrowLeft' && step > 0) { step--; updateStep(); }
  }
  document.addEventListener('keydown', onKey);
  // Wake Lock attempt
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}

// PWA service worker stub
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}


// Initial render
renderPage('today');
