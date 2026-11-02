/* Larder — UI layer (iteration 4)
   Routes: #planner (week/month calendar + today summary), #recipes, #recipe/<id>,
   #shop (live from visible planner week), #pantry, #review, #settings ("More").
   Old routes (#today, #week, #meals) redirect.
*/
import {
  state, saveState, aggregateGrocery, computeCost, checkConflicts, validateRecipeForm, addToPantry, addCustomMeal,
  getAllMeals, findMeal, ensureDay, setSlot, swapSlots, getExpiringSoon, suggestUseItUp, markEatenAndDeduct, planLeftover,
  exportData, importData, resetData, copyDay, pushUndo, popUndo, computeDailyNutrition, getTargets, getHouseholdSize,
  dateKey, parseDateKey, addDays, weekStartOf, weekDays, SLOTS, subtractPantry, getRecipeSource, isFavorite, toggleFavorite,
  updateCustomMeal, deleteCustomMeal, restoreCustomMeal, parseIngredientLine, smartNumber, formatQuantity
} from './app.js';
import { searchIngredients, estimateFromDb } from './ingredients-db.js';
import { normalizeIngredient, computeNutritionFromIngredients } from './data.js';

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
function getTodayKey() { return dateKey(new Date()); }
function fmtDay(key, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseDateKey(key).toLocaleDateString('en-US', opts);
}
function mealName(entry) {
  if (!entry) return '';
  return findMeal(entry.mealId)?.name || entry.custom?.name || 'Missing recipe';
}
const SOURCE_LABEL = { builtin: 'Built-in', custom: 'Custom', imported: 'Imported' };
function allergenHits(meal) {
  return (state.profile.allergens || []).filter(a => (meal.allergens || []).includes(a));
}
function mealNutrition(meal) {
  const nut = meal.protein != null ? meal : computeNutritionFromIngredients(meal.ingredients || [], meal.servings || 1);
  const calories = nut.calories || Math.round((nut.protein || 0) * 4 + (nut.carbs || 0) * 4 + (nut.fat || 0) * 9);
  return { calories, protein: nut.protein || 0, carbs: nut.carbs || 0, fat: nut.fat || 0, fiber: nut.fiber || 0 };
}

/* ---------- toast (fixed: inline display:flex used to override [hidden], so it never went away) ---------- */
let toastTimer = null;
function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  const toast = document.getElementById('undo-toast');
  if (toast) { toast.classList.remove('show'); toast.setAttribute('aria-hidden', 'true'); }
}
/** showUndoToast(message, onUndo?) — onUndo omitted => plain notice with no Undo button */
function showUndoToast(message, onUndo) {
  let toast = document.getElementById('undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  clearTimeout(toastTimer);
  toast.innerHTML = `<span class="toast-msg"></span>${onUndo ? '<button type="button" class="toast-undo">Undo</button>' : ''}`;
  toast.querySelector('.toast-msg').textContent = message;
  toast.querySelector('.toast-undo')?.addEventListener('click', () => {
    hideToast();
    onUndo();
  });
  toast.removeAttribute('aria-hidden');
  // force reflow so re-showing restarts the transition cleanly
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(hideToast, onUndo ? 5000 : 3500);
}
// Undo for plan (days + pantry) changes recorded with pushUndo
function undoPlanChange() {
  if (popUndo()) rerender();
}
function planChange(label, mutate, message) {
  pushUndo({ label });
  const ok = mutate();
  if (ok === false) { popUndo(); return false; }
  saveState();
  showUndoToast(message, undoPlanChange);
  rerender();
  return true;
}

/* ---------- routing ---------- */
const ROUTE_ALIASES = { today: 'planner', week: 'planner', meals: 'recipes', more: 'settings', book: 'recipes' };
const PAGES = ['planner', 'recipes', 'shop', 'pantry', 'review', 'settings'];
let currentPage = 'planner';
let currentParam = null;

function parseHash() {
  let h = decodeURIComponent(location.hash.slice(1) || '');
  let param = null;
  if (h.startsWith('recipe/')) { param = h.slice(7); h = 'recipes'; }
  const page = ROUTE_ALIASES[h] || (PAGES.includes(h) ? h : 'planner');
  return { page, param, redirected: page !== h && !param };
}
function route() {
  const { page, param, redirected } = parseHash();
  if (redirected) history.replaceState(null, '', '#' + page);
  const changed = page !== currentPage || param !== currentParam;
  currentPage = page; currentParam = param;
  closeSheet(true);
  showPage(page, changed);
  renderPage(page, param);
  if (changed) window.scrollTo(0, 0);
}
function rerender() { renderPage(currentPage, currentParam); }

function showPage(id, moveFocus) {
  document.querySelectorAll('.page').forEach(p => p.hidden = p.id !== id);
  document.querySelectorAll('nav a[data-page]').forEach(a => {
    const pages = a.dataset.page.split(' ');
    if (pages.includes(id)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (moveFocus) document.getElementById(id)?.querySelector('h2')?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

function renderPage(page, param) {
  if (page === 'planner') renderPlanner();
  if (page === 'recipes') param ? renderRecipeDetail(param) : renderRecipes();
  if (page === 'shop') renderShop();
  if (page === 'settings') renderSettings();
  if (page === 'pantry') renderPantry();
  if (page === 'review') renderReview();
}

/* ---------- bottom sheet ---------- */
let sheetReturnFocus = null;
function openSheet(title, html, wire) {
  const sheet = document.getElementById('meal-sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  if (sheet.hidden) sheetReturnFocus = document.activeElement;
  document.getElementById('sheet-title').textContent = title;
  const actions = document.getElementById('sheet-actions');
  actions.innerHTML = html;
  sheet.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add('sheet-open');
  wire?.(actions);
  (actions.querySelector('[autofocus]') || actions.querySelector('button, input, select'))?.focus();
}
function closeSheet(silent) {
  const sheet = document.getElementById('meal-sheet');
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  document.getElementById('sheet-backdrop').hidden = true;
  document.body.classList.remove('sheet-open');
  if (!silent && sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus();
  sheetReturnFocus = null;
}
document.getElementById('sheet-close')?.addEventListener('click', () => closeSheet());
document.getElementById('sheet-backdrop')?.addEventListener('click', () => closeSheet());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('meal-sheet').hidden) closeSheet();
});

/* ---------- planner ---------- */
let plannerWeekStart = weekStartOf(getTodayKey());
let monthCursor = getTodayKey().slice(0, 8) + '01';
let monthSelected = null;
let swapSource = null; // { date, slot }
const isTouch = () => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function plannerView() { return state.ui?.plannerView === 'month' ? 'month' : 'week'; }
function setPlannerView(v) {
  state.ui = state.ui || {};
  state.ui.plannerView = v;
  saveState();
}
function weekLabel(start) {
  const end = addDays(start, 6);
  return `${fmtDay(start, { month: 'short', day: 'numeric' })} – ${fmtDay(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function slotHtml(date, slot, today) {
  const entry = state.days[date]?.[slot];
  const has = !!entry;
  const status = entry?.status;
  const cls = ['meal-slot', has ? 'filled' : '', status === 'eaten' ? 'eaten' : '', status === 'skipped' ? 'skipped' : '',
    swapSource && swapSource.date === date && swapSource.slot === slot ? 'selected' : '',
    swapSource && !(swapSource.date === date && swapSource.slot === slot) ? 'drop-target' : ''].filter(Boolean).join(' ');
  const name = has ? escapeHtml(mealName(entry)) : 'Add a meal';
  const extra = [entry?.leftover ? 'leftover' : '', status === 'eaten' ? 'eaten' : '', status === 'skipped' ? 'skipped' : '', entry?.servings ? `${entry.servings} serv.` : ''].filter(Boolean).join(' · ');
  return `<div class="${cls}" role="button" tabindex="0" draggable="${has && !isTouch()}" data-date="${date}" data-slot="${slot}"
      aria-label="${cap(slot)}, ${fmtDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${has ? name : 'empty'}${extra ? ', ' + extra : ''}">
    <span class="slot-label">${slot}</span>
    <span class="slot-name${has ? '' : ' slot-empty'}">${name}${extra ? ` <small class="slot-extra">· ${extra}</small>` : ''}</span>
  </div>`;
}

function todaySummaryHtml() {
  const today = getTodayKey();
  const day = state.days[today] || {};
  const entries = SLOTS.map(s => day[s]).filter(e => e && e.status !== 'skipped');
  const meals = entries.map(e => findMeal(e.mealId));
  const pairs = entries.map((e, i) => [e, meals[i]]).filter(([, m]) => m);
  const nut = computeDailyNutrition(pairs.map(p => p[1]), getHouseholdSize(state.profile), pairs.map(p => p[0]));
  const targets = getTargets(state.profile);
  const cost = computeCost(pairs.map(p => p[1]), getHouseholdSize(state.profile), state.prices || {});
  const bar = (label, v, t, unit = '') => {
    const pct = t ? Math.min(100, Math.round((v / t) * 100)) : 0;
    return `<div class="macro"><div class="macro-top"><span>${label}</span><span><strong>${v}${unit}</strong> / ${t}${unit}</span></div>
      <div class="meter" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${t}" aria-valuenow="${v}"><span style="width:${pct}%"></span></div></div>`;
  };
  const rows = SLOTS.map(slot => {
    const e = day[slot];
    if (!e) return `<li class="today-row"><span class="slot-label">${slot}</span><span class="slot-name slot-empty">Open</span>
      <button type="button" class="secondary small" data-today-add="${slot}">Add</button></li>`;
    const st = e.status === 'eaten' ? '<span class="badge ok">Eaten</span>' : e.status === 'skipped' ? '<span class="badge muted">Skipped</span>' : '';
    return `<li class="today-row"><span class="slot-label">${slot}</span>
      <button type="button" class="linkish slot-name" data-today-open="${slot}">${escapeHtml(mealName(e))}</button> ${st}
      <span class="today-actions">${e.status === 'planned' || !e.status ? `<button type="button" class="small" data-today-ate="${slot}">We ate this</button>
      <button type="button" class="secondary small" data-today-skip="${slot}">Skip</button>` : `<button type="button" class="secondary small" data-today-reset="${slot}">Undo status</button>`}</span></li>`;
  }).join('');
  return `<section class="card today-card" aria-labelledby="today-h">
    <h3 id="today-h">Today · ${fmtDay(today, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
    <p class="muted">${cap(state.profile.goal)} · ${getHouseholdSize(state.profile)} ${getHouseholdSize(state.profile) === 1 ? 'person' : 'people'}</p>
    <ul class="today-list">${rows}</ul>
    <div class="macros">${bar('Calories', nut.calories, targets.calories)}${bar('Protein', nut.protein, targets.protein, 'g')}${bar('Carbs', nut.carbs, targets.carbs, 'g')}${bar('Fat', nut.fat, targets.fat, 'g')}</div>
    <p class="muted">Cost $${cost.total.toFixed(2)} ${cost.label}</p>
    ${SLOTS.some(s => !day[s]) ? '<button type="button" id="suggest-btn" class="secondary">Suggest open meals</button>' : ''}
  </section>`;
}

function renderPlanner() {
  const el = document.getElementById('planner-content');
  const today = getTodayKey();
  const view = plannerView();
  let body = '';
  let rangeLabel = '';
  if (view === 'week') {
    rangeLabel = weekLabel(plannerWeekStart);
    body = `<div id="week-days">${weekDays(plannerWeekStart).map(key => `
      <div class="week-day${key === today ? ' is-today' : ''}" data-date="${key}">
        <div class="week-day-header">${fmtDay(key)}${key === today ? ' <span class="badge">Today</span>' : ''}</div>
        ${SLOTS.map(s => slotHtml(key, s, today)).join('')}
        <div class="week-actions"><button type="button" class="secondary" data-copy="${key}" aria-label="Copy ${fmtDay(key)} to the next day">Copy to next day</button></div>
      </div>`).join('')}</div>`;
  } else {
    const first = parseDateKey(monthCursor);
    rangeLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const gridStart = weekStartOf(monthCursor);
    const month = first.getMonth();
    const cells = [];
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(first.getFullYear(), month + 1, 0).getDate();
    const total = Math.ceil((offset + daysInMonth) / 7) * 7;
    for (let i = 0; i < total; i++) {
      const key = addDays(gridStart, i);
      const d = parseDateKey(key);
      const day = state.days[key] || {};
      const lines = SLOTS.filter(s => day[s]).map(s => `<span class="mini ${day[s].status || ''}"><b>${s[0].toUpperCase()}</b> ${escapeHtml(mealName(day[s]))}</span>`).join('');
      const count = SLOTS.filter(s => day[s]).length;
      cells.push(`<button type="button" class="month-day${d.getMonth() !== month ? ' other' : ''}${key === today ? ' is-today' : ''}${key === monthSelected ? ' selected-day' : ''}" data-day="${key}"
        aria-label="${fmtDay(key, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} of 3 meals planned" aria-pressed="${key === monthSelected}">
        <span class="month-num">${d.getDate()}</span>
        <span class="dots" aria-hidden="true">${SLOTS.map(s => `<i class="${day[s] ? 'on' : ''}"></i>`).join('')}</span>
        <span class="mini-list">${lines}</span></button>`);
    }
    const sel = monthSelected;
    body = `<div class="month-grid" role="grid" aria-label="${rangeLabel}">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="month-dow" aria-hidden="true">${d}</div>`).join('')}
        ${cells.join('')}</div>
      ${sel ? `<div class="week-day expanded-day${sel === today ? ' is-today' : ''}" data-date="${sel}" id="expanded-day">
          <div class="week-day-header">${fmtDay(sel, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          ${SLOTS.map(s => slotHtml(sel, s, today)).join('')}
          <div class="week-actions"><button type="button" class="secondary" id="open-week">Open this week</button></div>
        </div>` : '<p class="muted">Tap a day to see and edit its meals.</p>'}`;
  }
  el.innerHTML = `
    ${todaySummaryHtml()}
    <div class="planner-toolbar">
      <div class="segmented" role="group" aria-label="Calendar view">
        <button type="button" data-view="week" aria-pressed="${view === 'week'}">Week</button>
        <button type="button" data-view="month" aria-pressed="${view === 'month'}">Month</button>
      </div>
      <div class="range-nav">
        <button type="button" class="secondary icon" id="prev-range" aria-label="Previous ${view}">‹</button>
        <span class="range-label" aria-live="polite">${rangeLabel}</span>
        <button type="button" class="secondary icon" id="next-range" aria-label="Next ${view}">›</button>
        <button type="button" class="secondary small" id="today-range">Today</button>
      </div>
    </div>
    ${swapSource ? `<div class="move-hint" role="status">Tap the slot to swap with <strong>${escapeHtml(mealName(state.days[swapSource.date]?.[swapSource.slot]) || 'empty ' + swapSource.slot)}</strong>. <button type="button" id="cancel-move" class="secondary small">Cancel</button></div>`
      : `<p class="muted hint">Tap a slot to choose, swap or remove a meal.${isTouch() ? '' : ' You can also drag meals between slots.'}</p>`}
    ${body}`;
  wirePlanner(el);
}

function wirePlanner(el) {
  const today = getTodayKey();
  // Today summary
  el.querySelectorAll('[data-today-add]').forEach(b => b.addEventListener('click', () => openRecipePicker(today, b.dataset.todayAdd)));
  el.querySelectorAll('[data-today-open]').forEach(b => b.addEventListener('click', () => openSlotSheet(today, b.dataset.todayOpen)));
  el.querySelectorAll('[data-today-ate]').forEach(b => b.addEventListener('click', () =>
    planChange('ate', () => markEatenAndDeduct(today, b.dataset.todayAte), 'Marked eaten and deducted from pantry')));
  el.querySelectorAll('[data-today-skip]').forEach(b => b.addEventListener('click', () =>
    planChange('skip', () => { state.days[today][b.dataset.todaySkip].status = 'skipped'; }, 'Meal skipped')));
  el.querySelectorAll('[data-today-reset]').forEach(b => b.addEventListener('click', () =>
    planChange('reset', () => { state.days[today][b.dataset.todayReset].status = 'planned'; }, 'Status cleared')));
  el.querySelector('#suggest-btn')?.addEventListener('click', () => planChange('suggest', () => {
    const day = ensureDay(today);
    const pantryIds = new Set((state.pantry || []).filter(p => p.name).map(p => normalizeIngredient(p.name).id));
    const ok = m => !allergenHits(m).length && !(state.profile.goal === 'keto' && m.keto === false);
    let filled = 0;
    SLOTS.forEach(slot => {
      if (day[slot]) return;
      const all = getAllMeals();
      const meal = all.find(m => m.slot === slot && ok(m) && m.ingredients?.some(i => i.name && pantryIds.has(normalizeIngredient(i.name).id)))
        || all.find(m => m.slot === slot && ok(m));
      if (meal) { day[slot] = { mealId: meal.id, status: 'planned' }; filled++; }
    });
    return filled > 0;
  }, 'Suggested meals added'));

  // Toolbar
  el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'month') {
      const inWeek = weekDays(plannerWeekStart).includes(today);
      monthSelected = monthSelected && weekDays(plannerWeekStart).includes(monthSelected) ? monthSelected : (inWeek ? today : plannerWeekStart);
      monthCursor = monthSelected.slice(0, 8) + '01';
    }
    setPlannerView(v);
    renderPlanner();
    el.querySelector(`[data-view="${v}"]`)?.focus();
  }));
  const shift = dir => {
    if (plannerView() === 'week') plannerWeekStart = addDays(plannerWeekStart, 7 * dir);
    else {
      const d = parseDateKey(monthCursor);
      d.setMonth(d.getMonth() + dir);
      monthCursor = dateKey(d);
      monthSelected = null;
    }
    renderPlanner();
  };
  el.querySelector('#prev-range')?.addEventListener('click', () => { shift(-1); el.querySelector('#prev-range')?.focus(); });
  el.querySelector('#next-range')?.addEventListener('click', () => { shift(1); el.querySelector('#next-range')?.focus(); });
  el.querySelector('#today-range')?.addEventListener('click', () => {
    plannerWeekStart = weekStartOf(today);
    monthCursor = today.slice(0, 8) + '01';
    monthSelected = plannerView() === 'month' ? today : null;
    renderPlanner();
  });
  el.querySelector('#cancel-move')?.addEventListener('click', () => { swapSource = null; renderPlanner(); });
  el.querySelector('#open-week')?.addEventListener('click', () => {
    plannerWeekStart = weekStartOf(monthSelected);
    setPlannerView('week');
    renderPlanner();
  });

  // Month cells
  el.querySelectorAll('.month-day').forEach(b => b.addEventListener('click', () => {
    monthSelected = b.dataset.day;
    plannerWeekStart = weekStartOf(monthSelected); // keeps Shop in sync with what you're looking at
    const d = parseDateKey(monthSelected);
    if (d.getMonth() !== parseDateKey(monthCursor).getMonth()) monthCursor = monthSelected.slice(0, 8) + '01';
    renderPlanner();
    const exp = document.getElementById('expanded-day');
    exp?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    exp?.querySelector('.meal-slot')?.focus({ preventScroll: true });
  }));

  // Slots: tap opens sheet, or completes a swap
  el.querySelectorAll('.meal-slot').forEach(slotEl => {
    const activate = () => {
      const { date, slot } = slotEl.dataset;
      if (swapSource) {
        const from = swapSource;
        swapSource = null;
        if (from.date === date && from.slot === slot) { renderPlanner(); return; }
        planChange('swap', () => swapSlots(from, { date, slot }), 'Meals swapped');
        return;
      }
      openSlotSheet(date, slot);
    };
    slotEl.addEventListener('click', activate);
    slotEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });

  // Desktop drag and drop (swap)
  if (!isTouch()) {
    el.querySelectorAll('.meal-slot[draggable="true"]').forEach(s => {
      s.addEventListener('dragstart', e => {
        s.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ date: s.dataset.date, slot: s.dataset.slot }));
      });
      s.addEventListener('dragend', () => {
        s.classList.remove('dragging');
        el.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
      });
    });
    el.querySelectorAll('.meal-slot').forEach(t => {
      t.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; t.classList.add('drop-target'); });
      t.addEventListener('dragleave', () => t.classList.remove('drop-target'));
      t.addEventListener('drop', e => {
        e.preventDefault();
        t.classList.remove('drop-target');
        let data = {};
        try { data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch {}
        if (!data.date) return;
        if (data.date === t.dataset.date && data.slot === t.dataset.slot) return;
        planChange('move', () => swapSlots(data, { date: t.dataset.date, slot: t.dataset.slot }), 'Meal moved');
      });
    });
  }

  el.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const from = btn.dataset.copy;
    const day = state.days[from];
    if (!day || !SLOTS.some(s => day[s])) { showUndoToast('Nothing to copy on that day'); return; }
    planChange('copy', () => copyDay(from, addDays(from, 1)), `Copied to ${fmtDay(addDays(from, 1))}`);
  }));
}

function openSlotSheet(date, slot) {
  const entry = state.days[date]?.[slot];
  const meal = entry ? findMeal(entry.mealId) : null;
  const title = `${cap(slot)} · ${fmtDay(date)}`;
  const html = entry ? `
      <p class="sheet-meal">${escapeHtml(mealName(entry))}${entry.status && entry.status !== 'planned' ? ` <span class="badge">${entry.status}</span>` : ''}</p>
      <button type="button" data-act="choose">Choose recipe</button>
      <button type="button" data-act="swap">Swap with another slot</button>
      ${meal ? '<button type="button" data-act="view" class="secondary">View recipe</button>' : ''}
      ${meal ? '<button type="button" data-act="cook" class="secondary">Cook</button>' : ''}
      ${entry.status !== 'eaten' ? '<button type="button" data-act="ate" class="secondary">We ate this</button>' : ''}
      ${entry.status !== 'skipped' ? '<button type="button" data-act="skip" class="secondary">Skip</button>' : ''}
      <button type="button" data-act="leftover" class="secondary">Leftover tomorrow</button>
      <div class="inline-field"><label for="sheet-servings">Servings for this meal</label>
        <input id="sheet-servings" type="number" min="1" inputmode="numeric" value="${entry.servings || ''}" placeholder="${getHouseholdSize(state.profile)} (household)">
        <button type="button" data-act="servings" class="secondary">Set</button></div>
      <button type="button" data-act="remove" class="danger">Remove</button>`
    : `<p class="sheet-meal muted">Nothing planned.</p>
      <button type="button" data-act="choose">Choose recipe</button>
      <button type="button" data-act="swap" class="secondary">Swap with another slot</button>`;
  openSheet(title, html, actions => {
    actions.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'choose') return openRecipePicker(date, slot);
      if (act === 'servings') {
        const s = Number(actions.querySelector('#sheet-servings').value);
        closeSheet();
        return planChange('servings', () => { if (s > 0) entry.servings = s; else delete entry.servings; }, 'Servings updated');
      }
      closeSheet();
      if (act === 'swap') {
        swapSource = { date, slot };
        if (currentPage !== 'planner') location.hash = '#planner'; else renderPlanner();
        document.querySelector('.move-hint')?.scrollIntoView({ block: 'nearest' });
      } else if (act === 'view') location.hash = '#recipe/' + encodeURIComponent(meal.id);
      else if (act === 'cook') openCookMode(meal);
      else if (act === 'ate') planChange('ate', () => markEatenAndDeduct(date, slot), 'Marked eaten and deducted from pantry');
      else if (act === 'skip') planChange('skip', () => { entry.status = 'skipped'; }, 'Meal skipped');
      else if (act === 'leftover') planChange('leftover', () => planLeftover(date, slot), `Leftover planned for ${fmtDay(addDays(date, 1))}`);
      else if (act === 'remove') planChange('remove', () => { state.days[date][slot] = null; }, 'Meal removed');
    }));
  });
}

function openRecipePicker(date, slot) {
  const html = `
    <label for="picker-q" class="sr-only">Search recipes</label>
    <input id="picker-q" type="search" placeholder="Search name or ingredient" autocomplete="off" autofocus>
    <label class="check"><input type="checkbox" id="picker-all"> Show all meal types</label>
    <div id="picker-list" class="picker-list" role="list"></div>
    <button type="button" class="secondary" id="picker-back">Back</button>`;
  openSheet(`Choose ${slot} · ${fmtDay(date)}`, html, actions => {
    const q = actions.querySelector('#picker-q');
    const allBox = actions.querySelector('#picker-all');
    const list = actions.querySelector('#picker-list');
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      const all = getAllMeals().filter(m => (allBox.checked || term || m.slot === slot) && recipeMatches(m, term));
      all.sort((a, b) => (b.slot === slot) - (a.slot === slot) || isFavorite(b.id) - isFavorite(a.id) || a.name.localeCompare(b.name));
      list.innerHTML = all.slice(0, 80).map(m => {
        const warn = allergenHits(m);
        return `<button type="button" role="listitem" class="picker-item" data-pick="${escapeHtml(m.id)}">
          <span>${isFavorite(m.id) ? '★ ' : ''}${escapeHtml(m.name)}</span>
          <small>${cap(m.slot)}${m.totalMin ? ` · ${m.totalMin} min` : ''} · ${SOURCE_LABEL[getRecipeSource(m)]}${warn.length ? ` · ⚠ ${escapeHtml(warn.join(', '))}` : ''}</small></button>`;
      }).join('') || '<p class="empty"><strong>No recipes match</strong>Try another search.</p>';
      list.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        const m = findMeal(b.dataset.pick);
        closeSheet();
        planChange('choose', () => setSlot(date, slot, m.id), `${m.name} planned for ${slot}`);
      }));
    };
    q.addEventListener('input', draw);
    allBox.addEventListener('change', draw);
    actions.querySelector('#picker-back').addEventListener('click', () => state.days[date]?.[slot] ? openSlotSheet(date, slot) : closeSheet());
    draw();
  });
}

/* ---------- shop (live from the visible planner week) ---------- */
let shopIncludeEaten = false;
function renderShop() {
  const el = document.getElementById('shop-content');
  const days = weekDays(plannerWeekStart);
  const planned = [];
  days.forEach(key => SLOTS.forEach(slot => { const e = state.days[key]?.[slot]; if (e?.mealId) planned.push(e); }));
  const active = planned.filter(p => p.status !== 'skipped' && (shopIncludeEaten || p.status !== 'eaten'));
  const list = aggregateGrocery(planned, { excludeEaten: !shopIncludeEaten });
  const { need, have } = subtractPantry(list, state.pantry || []);
  const meals = active.map(p => findMeal(p.mealId)).filter(Boolean);
  const total = computeCost(meals, getHouseholdSize(state.profile), state.prices || {});
  state.shopChecked = state.shopChecked || {};
  const checked = new Set(state.shopChecked[plannerWeekStart] || []);
  const manual = state.manualItems || [];
  let lastAisle = null;
  const rows = need.map((item, idx) => {
    const head = item.aisle !== lastAisle ? `<li class="aisle-head">${escapeHtml(cap(item.aisle || 'other'))}</li>` : '';
    lastAisle = item.aisle;
    const id = item.canon.id;
    return `${head}<li class="shop-item${checked.has(id) ? ' done' : ''}">
      <label class="check"><input type="checkbox" data-check="${escapeHtml(id)}" ${checked.has(id) ? 'checked' : ''}>
        <span><strong>${escapeHtml(item.display)}</strong> ${escapeHtml(item.canon.name)}${item.partial ? ' <span class="badge muted">after pantry</span>' : ''}</span></label>
      <small class="muted">${escapeHtml(item.expanded)}${item.pantryNote ? ` · have ${escapeHtml(item.pantryNote)} in pantry` : ''}</small>
      <div class="shop-item-actions">
        <button type="button" class="secondary small" data-add-pantry="${idx}">Add to pantry</button>
        <label class="price"><span class="sr-only">Price for ${escapeHtml(item.canon.name)}</span>$<input type="number" inputmode="decimal" data-price="${escapeHtml(id)}" placeholder="est." step="0.01" min="0" value="${state.prices?.[id] != null ? (state.prices[id] / 100).toFixed(2) : ''}"></label>
      </div></li>`;
  }).join('');
  el.innerHTML = `
    <div class="planner-toolbar">
      <div class="range-nav">
        <button type="button" class="secondary icon" id="shop-prev" aria-label="Previous week">‹</button>
        <span class="range-label">Week of ${weekLabel(plannerWeekStart)}</span>
        <button type="button" class="secondary icon" id="shop-next" aria-label="Next week">›</button>
      </div>
    </div>
    <p class="muted">Covers the planner week ${weekLabel(plannerWeekStart)} · ${active.length} meal${active.length === 1 ? '' : 's'} · $${total.total.toFixed(2)} ${total.label} Pantry items are subtracted automatically.</p>
    ${planned.length ? '' : '<div class="empty"><strong>No meals planned this week</strong><a href="#planner">Open the planner</a> to add some — the list fills in automatically.</div>'}
    ${need.length ? `<ul class="shop-list">${rows}</ul>` : planned.length ? '<div class="empty"><strong>List is clear</strong>Everything for this week is already in your pantry.</div>' : ''}
    <div class="card">
      <h3>Extra items</h3>
      <ul class="shop-list">${manual.map((m, i) => `<li class="shop-item"><span>${escapeHtml(m.name)}</span> <button type="button" class="secondary small" data-del-manual="${i}" aria-label="Remove ${escapeHtml(m.name)}">Remove</button></li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
      <form id="manual-form" class="inline-field"><label for="manual-name" class="sr-only">Extra item</label>
        <input id="manual-name" placeholder="e.g. paper towels" autocomplete="off"><button type="submit">Add</button></form>
    </div>
    ${have.length ? `<details class="card"><summary>Already in pantry (${have.length})</summary><ul>${have.map(i => `<li>${escapeHtml(i.display)} ${escapeHtml(i.canon.name)}</li>`).join('')}</ul></details>` : ''}
    <div class="button-row">
      <button type="button" id="copy-list">Copy list</button>
      <button type="button" id="share-list" class="secondary">Share</button>
    </div>
    <label class="check"><input type="checkbox" id="include-eaten" ${shopIncludeEaten ? 'checked' : ''}> Include meals already eaten</label>
  `;
  const textList = () => [...need.map(i => `${i.display} ${i.canon.name}`), ...manual.map(m => m.name)].join('\n');
  el.querySelector('#shop-prev').addEventListener('click', () => { plannerWeekStart = addDays(plannerWeekStart, -7); renderShop(); });
  el.querySelector('#shop-next').addEventListener('click', () => { plannerWeekStart = addDays(plannerWeekStart, 7); renderShop(); });
  el.querySelectorAll('[data-check]').forEach(cb => cb.addEventListener('change', () => {
    const set = new Set(state.shopChecked[plannerWeekStart] || []);
    cb.checked ? set.add(cb.dataset.check) : set.delete(cb.dataset.check);
    state.shopChecked[plannerWeekStart] = [...set];
    saveState();
    cb.closest('.shop-item')?.classList.toggle('done', cb.checked);
  }));
  el.querySelectorAll('[data-add-pantry]').forEach(btn => btn.addEventListener('click', () => {
    const item = need[Number(btn.dataset.addPantry)];
    const entry = addToPantry({ name: item.canon.name, qty: item.qty, unit: item.unit, location: item.aisle });
    showUndoToast(`${item.canon.name} added to pantry`, () => {
      state.pantry = state.pantry.filter(p => p.id !== entry.id); saveState(); rerender();
    });
    renderShop();
  }));
  el.querySelectorAll('[data-price]').forEach(input => input.addEventListener('change', () => {
    const val = parseFloat(input.value);
    state.prices = state.prices || {};
    if (input.value === '') delete state.prices[input.dataset.price];
    else if (!isNaN(val) && val >= 0) state.prices[input.dataset.price] = Math.round(val * 100);
    else return;
    saveState();
    renderShop();
  }));
  el.querySelectorAll('[data-del-manual]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.delManual);
    const [removed] = state.manualItems.splice(i, 1);
    saveState();
    renderShop();
    showUndoToast(`Removed ${removed.name}`, () => { state.manualItems.splice(i, 0, removed); saveState(); rerender(); });
  }));
  el.querySelector('#manual-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = el.querySelector('#manual-name').value.trim();
    if (!name) return;
    state.manualItems = state.manualItems || [];
    state.manualItems.push({ name, qty: 1, unit: '' });
    saveState();
    renderShop();
    document.getElementById('manual-name')?.focus();
  });
  const copy = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); showUndoToast(msg); }
    catch { showUndoToast('Could not access the clipboard'); }
  };
  el.querySelector('#copy-list').addEventListener('click', () => copy(textList(), 'List copied'));
  el.querySelector('#share-list').addEventListener('click', () => {
    const text = textList();
    if (navigator.share) navigator.share({ title: 'Grocery list', text }).catch(() => {});
    else copy(text, 'Sharing not available — list copied instead');
  });
  el.querySelector('#include-eaten').addEventListener('change', e => { shopIncludeEaten = e.target.checked; renderShop(); });
}

/* ---------- recipes ---------- */
const recipeFilter = { q: '', source: 'all', slot: 'all' };
let editingId = null; // null = closed, '' = new, id = editing
function recipeMatches(m, term) {
  if (!term) return true;
  return m.name.toLowerCase().includes(term) || (m.ingredients || []).some(i => (i.name || '').toLowerCase().includes(term));
}
function filteredRecipes() {
  const term = recipeFilter.q.trim().toLowerCase();
  return getAllMeals().filter(m => {
    if (!recipeMatches(m, term)) return false;
    const src = getRecipeSource(m);
    if (recipeFilter.source === 'favorites' && !isFavorite(m.id)) return false;
    if (['builtin', 'custom', 'imported'].includes(recipeFilter.source) && src !== recipeFilter.source) return false;
    if (recipeFilter.slot !== 'all' && m.slot !== recipeFilter.slot) return false;
    return true;
  });
}
function recipeCardHtml(m) {
  const src = getRecipeSource(m);
  return `<li><a class="card recipe-card" href="#recipe/${encodeURIComponent(m.id)}">
    <span class="recipe-card-top"><strong>${escapeHtml(m.name)}</strong>${isFavorite(m.id) ? '<span class="fav-mark" aria-label="Favorite">★</span>' : ''}</span>
    ${m.blurb ? `<span class="recipe-blurb">${escapeHtml(m.blurb)}</span>` : ''}
    <span class="tags"><span class="badge">${cap(m.slot || 'dinner')}</span>${src !== 'builtin' ? `<span class="badge accent">${SOURCE_LABEL[src]}</span>` : ''}
      <span class="muted">${m.totalMin ? `${m.totalMin} min · ` : ''}$${((m.centsPerServing || 200) / 100).toFixed(2)}/serving est.</span></span>
  </a></li>`;
}
function drawRecipeResults() {
  const list = filteredRecipes();
  const box = document.getElementById('recipe-results');
  const count = document.getElementById('recipe-count');
  if (!box) return;
  count.textContent = `${list.length} of ${getAllMeals().length} recipes`;
  box.innerHTML = list.length ? `<ul class="recipe-list">${list.map(recipeCardHtml).join('')}</ul>`
    : `<div class="empty"><strong>No recipes match</strong>${recipeFilter.source === 'favorites' && !recipeFilter.q ? 'Tap ☆ on a recipe to add it to Favorites.' : recipeFilter.source === 'imported' && !recipeFilter.q ? 'Use “Import” to bring in a recipe from a URL or pasted text.' : 'Try a different search or filter.'}</div>`;
}
function chip(group, value, label) {
  return `<button type="button" class="chip" data-chip-group="${group}" data-chip="${value}" aria-pressed="${recipeFilter[group] === value}">${label}</button>`;
}
function recipeFormHtml(m) {
  const v = m || { name: '', slot: 'dinner', servings: 2, blurb: '', ingredients: [], steps: [] };
  const ingText = (v.ingredients || []).map(i => `${i.qty != null ? smartNumber(i.qty) : ''} ${i.unit || ''} ${i.name}`.replace(/\s+/g, ' ').trim()).join('\n');
  return `<div id="recipe-form" class="card">
    <h3>${m ? 'Edit recipe' : 'New recipe'}</h3>
    <form id="recipe-form-el" novalidate>
      <div id="form-errors" role="alert" hidden></div>
      <label>Name <input name="name" required value="${escapeHtml(v.name)}"></label><div class="error" data-field="name"></div>
      <label>Meal
        <select name="slot">${SLOTS.map(s => `<option value="${s}" ${v.slot === s ? 'selected' : ''}>${cap(s)}</option>`).join('')}</select>
      </label>
      <label>Servings <input name="servings" type="number" min="1" inputmode="numeric" value="${escapeHtml(v.servings || 1)}"></label><div class="error" data-field="servings"></div>
      <label>Total minutes (optional) <input name="totalMin" type="number" min="0" inputmode="numeric" value="${escapeHtml(v.totalMin || '')}"></label>
      <label>Calories per serving (optional) <input name="calories" type="number" min="0" inputmode="numeric" value="${escapeHtml(v.calories || '')}"></label><div class="error" data-field="calories"></div>
      <label>Protein g per serving (optional) <input name="protein" type="number" min="0" inputmode="numeric" value="${escapeHtml(v.protein || '')}"></label><div class="error" data-field="protein"></div>
      <label>Blurb <textarea name="blurb" rows="2">${escapeHtml(v.blurb || '')}</textarea></label>
      <label>Ingredients (one per line, e.g. “1 1/2 cup rolled oats”) <textarea name="ingredients" rows="5">${escapeHtml(ingText)}</textarea></label>
      <label>Steps (one per line) <textarea name="steps" rows="5">${escapeHtml((v.steps || []).join('\n'))}</textarea></label>
      <div class="button-row"><button type="submit">Save recipe</button> <button type="button" class="secondary" id="cancel-recipe">Cancel</button></div>
    </form></div>`;
}
function wireRecipeForm(root, existing, onDone) {
  root.querySelector('#cancel-recipe')?.addEventListener('click', () => onDone(null));
  root.querySelector('#recipe-form-el')?.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const result = validateRecipeForm(data);
    const errorSummary = root.querySelector('#form-errors');
    root.querySelectorAll('.error').forEach(x => x.textContent = '');
    if (!result.valid) {
      errorSummary.hidden = false;
      errorSummary.textContent = 'Please fix the errors below.';
      Object.entries(result.errors).forEach(([field, msg]) => {
        const errEl = root.querySelector(`.error[data-field="${field}"]`);
        if (errEl) errEl.textContent = msg;
      });
      root.querySelector(`[name="${Object.keys(result.errors)[0]}"]`)?.focus();
      return;
    }
    errorSummary.hidden = true;
    const ingredients = String(data.ingredients || '').split('\n').map(l => l.trim()).filter(Boolean).map(parseIngredientLine).filter(i => i.name)
      .map(i => {
        const old = existing?.ingredients?.find(o => o.name === i.name);
        return old?.aisle ? { ...i, aisle: old.aisle } : i;
      });
    const patch = {
      name: data.name.trim(),
      slot: data.slot,
      servings: Number(data.servings),
      totalMin: Number(data.totalMin) || undefined,
      blurb: data.blurb || '',
      ingredients,
      steps: String(data.steps || '').split('\n').map(s => s.trim()).filter(Boolean),
      calories: Number(data.calories) || undefined,
      protein: data.protein === '' ? undefined : Number(data.protein)
    };
    if (patch.protein == null) delete patch.protein;
    let saved;
    if (existing) saved = updateCustomMeal(existing.id, patch);
    else saved = addCustomMeal({ ...patch, source: 'custom', centsPerServing: 200 });
    showUndoToast(existing ? 'Recipe updated' : 'Recipe saved');
    onDone(saved);
  });
}

function renderRecipes() {
  const el = document.getElementById('recipes-content');
  document.getElementById('recipes-title').textContent = 'Recipes';
  el.innerHTML = `
    <div class="button-row">
      <button type="button" id="new-recipe">Write a recipe</button>
      <button type="button" id="import-recipe" class="secondary">Import from URL / text</button>
    </div>
    <div id="recipe-form-slot"></div>
    <div id="import-panel" class="card" hidden>
      <h3>Import recipe</h3>
      <p>Paste a recipe URL, raw text, or the page HTML (schema.org/Recipe preferred).</p>
      <label for="import-text" class="sr-only">Recipe URL or text</label>
      <textarea id="import-text" rows="4" placeholder="https://example.com/recipe or paste recipe text"></textarea>
      <div class="button-row"><button type="button" id="do-import">Import</button> <button type="button" class="secondary" id="cancel-import">Cancel</button></div>
      <div id="import-result" aria-live="polite"></div>
    </div>
    <label for="meal-search" class="sr-only">Search recipes</label>
    <input id="meal-search" type="search" placeholder="Search name or ingredient" value="${escapeHtml(recipeFilter.q)}" autocomplete="off">
    <div class="chips" role="group" aria-label="Filter by source">
      ${chip('source', 'all', 'All')}${chip('source', 'builtin', 'Built-in')}${chip('source', 'custom', 'Custom')}${chip('source', 'imported', 'Imported')}${chip('source', 'favorites', '★ Favorites')}
    </div>
    <div class="chips" role="group" aria-label="Filter by meal">
      ${chip('slot', 'all', 'Any meal')}${chip('slot', 'breakfast', 'Breakfast')}${chip('slot', 'lunch', 'Lunch')}${chip('slot', 'dinner', 'Dinner')}
    </div>
    <p id="recipe-count" class="muted" aria-live="polite"></p>
    <div id="recipe-results"></div>`;
  drawRecipeResults();
  // Search re-renders only the results so the input keeps focus (old version rebuilt the whole page per keystroke)
  el.querySelector('#meal-search').addEventListener('input', e => { recipeFilter.q = e.target.value; drawRecipeResults(); });
  el.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
    recipeFilter[b.dataset.chipGroup] = b.dataset.chip;
    el.querySelectorAll(`[data-chip-group="${b.dataset.chipGroup}"]`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    drawRecipeResults();
  }));
  const formSlot = el.querySelector('#recipe-form-slot');
  el.querySelector('#new-recipe').addEventListener('click', () => {
    el.querySelector('#import-panel').hidden = true;
    formSlot.innerHTML = recipeFormHtml(null);
    formSlot.querySelector('[name="name"]').focus();
    wireRecipeForm(formSlot, null, saved => {
      formSlot.innerHTML = '';
      if (saved) location.hash = '#recipe/' + encodeURIComponent(saved.id); else drawRecipeResults();
    });
  });
  el.querySelector('#import-recipe').addEventListener('click', () => {
    formSlot.innerHTML = '';
    el.querySelector('#import-panel').hidden = false;
    el.querySelector('#import-text').focus();
  });
  el.querySelector('#cancel-import').addEventListener('click', () => { el.querySelector('#import-panel').hidden = true; });
  el.querySelector('#do-import').addEventListener('click', () => runImport(el));
}

async function runImport(el) {
  const text = el.querySelector('#import-text').value.trim();
  const resultEl = el.querySelector('#import-result');
  if (!text) { resultEl.textContent = 'Please paste a URL or recipe text.'; return; }
  resultEl.innerHTML = '<p>Importing…</p>';
  let parsed;
  try { parsed = await parseRecipeImport(text); } catch { parsed = null; }
  if (!parsed || !parsed.name) {
    resultEl.innerHTML = '<p>Could not extract a recipe. Try pasting the full recipe text, or a different site.</p>';
    return;
  }
  const sourceUrl = /^https?:\/\//i.test(text) ? text : undefined;
  resultEl.innerHTML = `
    <div class="card">
      <h4>Review import</h4>
      <label>Name <input id="imp-name" value="${escapeHtml(parsed.name)}"></label>
      <label>Meal <select id="imp-slot">${SLOTS.map(s => `<option value="${s}" ${s === 'dinner' ? 'selected' : ''}>${cap(s)}</option>`).join('')}</select></label>
      <label>Servings <input id="imp-servings" type="number" min="1" value="${escapeHtml(parsed.servings || 2)}"></label>
      <label>Blurb <textarea id="imp-blurb" rows="2">${escapeHtml(parsed.blurb || '')}</textarea></label>
      <p><strong>Ingredients (${parsed.ingredients.length})</strong></p>
      <ul>${parsed.ingredients.map(i => `<li>${escapeHtml(smartNumber(i.qty || 1))} ${escapeHtml(i.unit || '')} ${escapeHtml(i.name)}</li>`).join('')}</ul>
      <p><strong>Steps (${(parsed.steps || []).length})</strong></p>
      <ol>${(parsed.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      <div class="button-row"><button type="button" id="save-import">Save recipe</button> <button type="button" class="secondary" id="cancel-import-review">Cancel</button></div>
    </div>`;
  resultEl.querySelector('#cancel-import-review').addEventListener('click', () => { el.querySelector('#import-panel').hidden = true; resultEl.innerHTML = ''; });
  resultEl.querySelector('#save-import').addEventListener('click', () => {
    const name = resultEl.querySelector('#imp-name').value.trim() || parsed.name;
    const servings = Number(resultEl.querySelector('#imp-servings').value) || 2;
    const blurb = resultEl.querySelector('#imp-blurb').value.trim();
    const est = estimateFromDb(parsed.ingredients);
    for (const raw of est.unmatched) {
      const picks = searchIngredients(raw.split(' ').pop(), 5);
      if (!picks.length) continue;
      const choice = prompt(`No nutrition match for "${raw}". Pick a number, or Cancel to keep as is:\n` + picks.map((p, i) => `${i + 1}. ${p.name}`).join('\n'));
      if (choice && picks[Number(choice) - 1]) {
        const ing = parsed.ingredients.find(i => i.name === raw);
        if (ing) ing.name = picks[Number(choice) - 1].name;
      }
    }
    const final = estimateFromDb(parsed.ingredients);
    const saved = addCustomMeal({
      name, slot: resultEl.querySelector('#imp-slot').value, servings,
      blurb: blurb || 'Imported', source: 'imported', sourceUrl,
      ingredients: parsed.ingredients,
      steps: parsed.steps && parsed.steps.length ? parsed.steps : ['Review and edit.'],
      centsPerServing: Math.round(final.costCents / Math.max(1, servings)) || 200,
      calories: Math.round(final.calories / servings), protein: Math.round(final.protein / servings),
      carbs: Math.round(final.carbs / servings), fat: Math.round(final.fat / servings), fiber: Math.round(final.fiber / servings)
    });
    showUndoToast(`Imported with ${final.matched} matched ingredients`);
    location.hash = '#recipe/' + encodeURIComponent(saved.id);
  });
}

const detailServings = {};
function renderRecipeDetail(id) {
  const el = document.getElementById('recipes-content');
  const meal = findMeal(id);
  if (!meal) {
    document.getElementById('recipes-title').textContent = 'Recipes';
    el.innerHTML = '<div class="empty"><strong>Recipe not found</strong>It may have been deleted. <a href="#recipes">Back to all recipes</a></div>';
    return;
  }
  document.getElementById('recipes-title').textContent = meal.name;
  const src = getRecipeSource(meal);
  const editable = src !== 'builtin';
  const base = meal.servings || 1;
  const servings = detailServings[id] || base;
  const nut = mealNutrition(meal);
  const fav = isFavorite(id);
  const warn = allergenHits(meal);
  const today = getTodayKey();
  if (editingId === id) {
    el.innerHTML = `<a href="#recipe/${encodeURIComponent(id)}" class="back-link" id="cancel-edit-link">← Back to recipe</a>${recipeFormHtml(meal)}`;
    el.querySelector('#cancel-edit-link').addEventListener('click', () => { editingId = null; });
    wireRecipeForm(el, meal, () => { editingId = null; renderRecipeDetail(id); });
    el.querySelector('[name="name"]').focus();
    return;
  }
  el.innerHTML = `
    <a href="#recipes" class="back-link">← All recipes</a>
    <article class="card recipe-detail">
      <div class="detail-head">
        <div class="tags"><span class="badge">${cap(meal.slot)}</span><span class="badge ${src !== 'builtin' ? 'accent' : 'muted'}">${SOURCE_LABEL[src]}</span>${warn.length ? `<span class="badge warn">Contains ${escapeHtml(warn.join(', '))}</span>` : ''}</div>
        <button type="button" class="secondary fav-btn" id="fav-btn" aria-pressed="${fav}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}">${fav ? '★ Favorite' : '☆ Favorite'}</button>
      </div>
      ${meal.blurb ? `<p class="blurb">${escapeHtml(meal.blurb)}</p>` : ''}
      ${meal.sourceUrl ? `<p class="muted small-text">Source: <a href="${escapeHtml(meal.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(meal.sourceUrl)}</a></p>` : ''}
      <dl class="facts">
        <div><dt>Prep</dt><dd>${meal.prepMin ? meal.prepMin + ' min' : '—'}</dd></div>
        <div><dt>Total</dt><dd>${meal.totalMin ? meal.totalMin + ' min' : '—'}</dd></div>
        <div><dt>Makes</dt><dd>${base} serving${base === 1 ? '' : 's'}</dd></div>
        <div><dt>Cost</dt><dd>$${((meal.centsPerServing || 200) / 100).toFixed(2)}/serving est.</dd></div>
      </dl>
      <h3>Nutrition per serving</h3>
      <p class="nutrition-bar"><span><strong>${nut.calories}</strong> kcal</span><span><strong>${nut.protein}g</strong> protein</span><span><strong>${nut.carbs}g</strong> carbs</span><span><strong>${nut.fat}g</strong> fat</span><span><strong>${nut.fiber}g</strong> fiber</span></p>
      <div class="scale-row">
        <h3 id="ing-h">Ingredients</h3>
        <div class="stepper" role="group" aria-label="Scale servings">
          <button type="button" class="secondary icon" id="serv-minus" aria-label="Fewer servings">−</button>
          <label for="serv-input" class="sr-only">Servings</label>
          <input id="serv-input" type="number" min="1" inputmode="numeric" value="${servings}">
          <span class="muted">servings</span>
          <button type="button" class="secondary icon" id="serv-plus" aria-label="More servings">+</button>
        </div>
      </div>
      <ul class="ingredients" id="ing-list" aria-labelledby="ing-h" aria-live="polite"></ul>
      <p class="muted" id="scaled-cost"></p>
      <h3>Steps</h3>
      ${(meal.steps || []).length ? `<ol class="steps">${meal.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : '<p class="muted">No steps yet.</p>'}
    </article>
    <section class="card" aria-labelledby="plan-h">
      <h3 id="plan-h">Add to planner</h3>
      <div class="plan-form">
        <label>Day <input type="date" id="plan-date" value="${today}"></label>
        <label>Meal <select id="plan-slot">${SLOTS.map(s => `<option value="${s}" ${meal.slot === s ? 'selected' : ''}>${cap(s)}</option>`).join('')}</select></label>
        <button type="button" id="plan-add">Add to planner</button>
      </div>
      <p class="muted small-text" id="plan-note"></p>
    </section>
    <div class="button-row">
      <button type="button" id="cook-btn">Start cook mode</button>
      ${editable ? '<button type="button" class="secondary" id="edit-btn">Edit</button><button type="button" class="danger" id="delete-btn">Delete</button>' : ''}
    </div>`;
  const input = el.querySelector('#serv-input');
  const drawIngredients = () => {
    const s = Math.max(1, Number(input.value) || base);
    detailServings[id] = s;
    const scale = s / base;
    el.querySelector('#ing-list').innerHTML = (meal.ingredients || []).map(i =>
      `<li>${i.qty != null ? `<strong>${escapeHtml(formatQuantity((i.qty || 0) * scale, i.unit || ''))}</strong> ` : ''}${escapeHtml(i.name)}</li>`).join('') || '<li class="muted">No ingredients listed.</li>';
    el.querySelector('#scaled-cost').textContent = `About $${(((meal.centsPerServing || 200) * s) / 100).toFixed(2)} for ${s} serving${s === 1 ? '' : 's'} (est.)`;
  };
  drawIngredients();
  input.addEventListener('input', drawIngredients);
  el.querySelector('#serv-minus').addEventListener('click', () => { input.value = Math.max(1, (Number(input.value) || base) - 1); drawIngredients(); });
  el.querySelector('#serv-plus').addEventListener('click', () => { input.value = (Number(input.value) || base) + 1; drawIngredients(); });
  const noteSlot = () => {
    const d = el.querySelector('#plan-date').value, s = el.querySelector('#plan-slot').value;
    const cur = d && state.days[d]?.[s];
    el.querySelector('#plan-note').textContent = cur ? `Replaces ${mealName(cur)} (you can undo).` : '';
  };
  el.querySelector('#plan-date').addEventListener('change', noteSlot);
  el.querySelector('#plan-slot').addEventListener('change', noteSlot);
  noteSlot();
  el.querySelector('#plan-add').addEventListener('click', () => {
    const d = el.querySelector('#plan-date').value;
    const s = el.querySelector('#plan-slot').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { el.querySelector('#plan-note').textContent = 'Pick a day first.'; return; }
    const chosen = Number(input.value) || base;
    planChange('plan', () => {
      setSlot(d, s, id);
      if (chosen !== base) state.days[d][s].servings = chosen;
    }, `Planned for ${s}, ${fmtDay(d)}`);
    plannerWeekStart = weekStartOf(d);
  });
  el.querySelector('#fav-btn').addEventListener('click', () => {
    const now = toggleFavorite(id);
    showUndoToast(now ? 'Added to favorites' : 'Removed from favorites');
    renderRecipeDetail(id);
    document.getElementById('fav-btn')?.focus();
  });
  el.querySelector('#cook-btn').addEventListener('click', () => openCookMode(meal));
  el.querySelector('#edit-btn')?.addEventListener('click', () => { editingId = id; renderRecipeDetail(id); });
  el.querySelector('#delete-btn')?.addEventListener('click', () => {
    if (!confirm(`Delete “${meal.name}”? You can undo right after.`)) return;
    const removed = deleteCustomMeal(id);
    if (!removed) return;
    location.hash = '#recipes';
    showUndoToast(`Deleted ${meal.name}`, () => {
      restoreCustomMeal(removed);
      location.hash = '#recipe/' + encodeURIComponent(id);
      rerender();
    });
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
      <label>Allergens (comma-separated) <input name="allergens" value="${escapeHtml((state.profile.allergens || []).join(', '))}"></label>
      <button type="submit">Save goal & allergens</button>
    </form>
    <div class="card">
      <h3>Household (${size})</h3>
      <p>Each person has their own biometrics. Targets and serving scaling use these.</p>
      <div id="members-list">
        ${members.map((m, i) => `
          <div class="card" style="margin-bottom:0.5rem; padding:0.75rem;">
            <strong>${escapeHtml(m.name || 'Person ' + (i+1))}</strong>
            <form data-member="${i}" style="margin-top:0.5rem;">
              <label>Name <input name="name" value="${escapeHtml(m.name || '')}"></label>
              <label>Sex
                <select name="sex">
                  <option value="female" ${m.sex === 'female' ? 'selected' : ''}>Female</option>
                  <option value="male" ${m.sex === 'male' ? 'selected' : ''}>Male</option>
                </select>
              </label>
              <label>Age <input type="number" name="age" value="${m.age || 30}" min="1" max="120"></label>
              <label>Height <input type="number" name="heightFt" value="${m.heightFt || 5}" min="3" max="8" style="width:70px;" aria-label="Feet"> ft
                <input type="number" name="heightIn" value="${m.heightIn || 6}" min="0" max="11" style="width:70px;" aria-label="Inches"> in</label>
              <label>Weight (lb) <input type="number" name="weightLb" value="${m.weightLb || 150}" min="50" max="500"></label>
              <label>Activity
                <select name="activity">
                  <option value="sedentary" ${m.activity === 'sedentary' ? 'selected' : ''}>Sedentary</option>
                  <option value="light" ${m.activity === 'light' ? 'selected' : ''}>Light</option>
                  <option value="moderate" ${m.activity === 'moderate' ? 'selected' : ''}>Moderate</option>
                  <option value="active" ${m.activity === 'active' ? 'selected' : ''}>Active</option>
                  <option value="very" ${m.activity === 'very' ? 'selected' : ''}>Very active</option>
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
      <h3>More</h3>
      <p><a href="#review">Review your history →</a></p>
      <p><a href="#recipes">Recipes →</a></p>
    </div>
    <div class="card">
      <h3>Data</h3>
      <button id="export-btn" type="button">Export JSON backup</button>
      <button id="import-btn" type="button" class="secondary">Import JSON</button>
      <input type="file" id="import-file" accept=".json" hidden>
      <button id="reset-btn" class="danger">Reset all data</button>
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
    const conflicts = checkConflicts(state, state.profile).filter(c => c.date >= getTodayKey());
    const box = document.getElementById('conflicts');
    showUndoToast('Settings saved');
    if (conflicts.length && box) {
      box.hidden = false;
      box.innerHTML = `<h3>Planned meals that now conflict</h3><ul>${conflicts.map(c => `<li>${fmtDay(c.date)} ${c.slot}: ${escapeHtml(c.name)} (${c.reasons.join(', ')})</li>`).join('')}</ul><p><a href="#planner">Open planner</a></p>`;
    }
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
      showUndoToast('Saved');
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
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById('import-btn')?.addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      e.target.value = '';
      if (importData(reader.result)) { renderSettings(); showUndoToast('Backup imported'); }
      else showUndoToast('Import failed — not a Larder backup');
    };
    reader.readAsText(file);
  });
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset all data? This cannot be undone.')) { resetData(); renderSettings(); showUndoToast('All data reset'); }
  });
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
        name = String(recipe.name || name).trim();
        blurb = String(recipe.description || blurb).replace(/<[^>]+>/g, '').trim();
        servings = parseInt([].concat(recipe.recipeYield || [])[0]) || servings;
        const ings = recipe.recipeIngredient || recipe.ingredients || [];
        ingredients = ings.map(parseIngredientLine).filter(i => i.name);
        const instr = recipe.recipeInstructions || recipe.instructions || [];
        steps = (Array.isArray(instr) ? instr : [instr]).flatMap(s => {
          if (typeof s === 'string') return [s];
          if (s.itemListElement) return s.itemListElement.map(i => i.text || i).filter(x => typeof x === 'string');
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


function renderPantry() {
  const el = document.getElementById('pantry-content');
  const items = state.pantry || [];
  const expiring = getExpiringSoon(3);
  const suggestions = suggestUseItUp();
  el.innerHTML = `
    <p>${items.length} items in pantry.</p>
    ${expiring.length ? `<div class="card notice" role="status"><strong>Expiring soon:</strong> ${expiring.map(e => escapeHtml(e.name)).join(', ')}</div>` : ''}
    ${suggestions.length ? `<div class="card"><strong>Use it up:</strong> ${suggestions.map(s => `<a href="#recipe/${encodeURIComponent(s.id)}">${escapeHtml(s.name)}</a>`).join(', ')}</div>` : ''}
    <form class="card" id="pantry-add-form">
      <h3>Add an item</h3>
      <div class="plan-form">
        <label>Item <input name="name" required placeholder="e.g. rolled oats" autocomplete="off"></label>
        <label>Qty <input name="qty" type="number" min="0" step="any" inputmode="decimal" value="1"></label>
        <label>Unit <input name="unit" placeholder="cup, lb, can…" autocomplete="off"></label>
        <label>Expires (optional) <input name="expiry" type="date"></label>
        <button type="submit">Add to pantry</button>
      </div>
    </form>
    <div class="card">
      <h3>Cook from what I have</h3>
      <p>Select ingredients in your pantry. Meals that use them will be ranked by how many you already have.</p>
      ${items.length ? `
        <div id="pantry-select" style="margin:0.5rem 0;">
          ${items.map(item => `<label style="display:inline-flex;align-items:center;margin:0.25rem 0.5rem 0.25rem 0;"><input type="checkbox" data-pantry-id="${item.id}" checked> ${escapeHtml(item.name)}</label>`).join('')}
        </div>
        <button id="find-meals" type="button">Find meals</button>
        <div id="pantry-results" style="margin-top:0.75rem;"></div>
      ` : '<p>Add items to your pantry first.</p>'}
    </div>
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
        <strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(smartNumber(item.qty || 0))} ${escapeHtml(item.unit || '')}
        <br><small>Location: ${escapeHtml(item.location || 'pantry')} · Added ${new Date(item.added).toLocaleDateString()}${item.expiry ? ` · Expires ${/^\d{4}-\d{2}-\d{2}$/.test(item.expiry) ? parseDateKey(item.expiry).toLocaleDateString() : new Date(item.expiry).toLocaleDateString()}` : ''}</small>
        <button type="button" class="secondary small" data-remove="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
      </div>
    `).join('') : '<div class="empty"><strong>Pantry is empty</strong>Add an item above, from Shop, or scan a receipt.</div>'}
    <p><small>Marking a meal “We ate this” deducts its ingredients from the pantry.</small></p>
  `;
  el.querySelector('#pantry-add-form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    addToPantry({ name, qty: Number(fd.get('qty')) || 1, unit: String(fd.get('unit') || '').trim(), location: 'pantry', expiry: fd.get('expiry') || null });
    showUndoToast(`${name} added`);
    renderPantry();
    document.querySelector('#pantry-add-form [name="name"]')?.focus();
  });
  document.getElementById('find-meals')?.addEventListener('click', () => {
    const selected = new Set([...el.querySelectorAll('#pantry-select input:checked')].map(cb => cb.dataset.pantryId));
    const selectedIds = new Set((state.pantry || []).filter(p => selected.has(p.id) && p.name).map(p => normalizeIngredient(p.name).id));
    const allMeals = getAllMeals();
    const scored = allMeals.map(meal => {
      const ings = meal.ingredients || [];
      const matchCount = ings.filter(ing => ing.name && selectedIds.has(normalizeIngredient(ing.name).id)).length;
      const coverage = ings.length ? matchCount / ings.length : 0;
      return { meal, matchCount, coverage };
    }).filter(s => s.matchCount > 0).sort((a, b) => b.coverage - a.coverage || b.matchCount - a.matchCount).slice(0, 8);
    const resultsEl = document.getElementById('pantry-results');
    if (!selectedIds.size) { resultsEl.innerHTML = '<p>Select at least one ingredient.</p>'; return; }
    if (!scored.length) {
      resultsEl.innerHTML = '<p>No meals match the selected ingredients.</p>';
      return;
    }
    resultsEl.innerHTML = scored.map(s => `
      <div class="card" style="margin-bottom:0.5rem;">
        <a href="#recipe/${encodeURIComponent(s.meal.id)}"><strong>${escapeHtml(s.meal.name)}</strong></a>
        <p style="margin:0.25rem 0;font-size:0.9rem;">Uses ${s.matchCount} of ${s.meal.ingredients.length} selected ingredients (${Math.round(s.coverage*100)}%)</p>
        <button data-plan="${s.meal.id}" data-slot="${s.meal.slot}" style="font-size:0.85rem;">Plan for next open ${s.meal.slot}</button>
      </div>
    `).join('');
    resultsEl.querySelectorAll('[data-plan]').forEach(btn => {
      btn.addEventListener('click', () => {
        const meal = allMeals.find(m => m.id === btn.dataset.plan);
        if (!meal) return;
        // next open slot of this meal type, starting today (up to 2 weeks out)
        let target = null;
        for (let i = 0; i < 14 && !target; i++) {
          const k = addDays(getTodayKey(), i);
          if (!state.days[k]?.[meal.slot]) target = k;
        }
        if (!target) { showUndoToast(`No open ${meal.slot} in the next two weeks`); return; }
        planChange('plan', () => setSlot(target, meal.slot, meal.id), `Planned ${meal.name} for ${fmtDay(target)}`);
      });
    });
  });
  // Wire remove
  el.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = state.pantry.findIndex(p => p.id === btn.dataset.remove);
      if (idx < 0) return;
      const [removed] = state.pantry.splice(idx, 1);
      saveState();
      renderPantry();
      showUndoToast(`Removed ${removed.name}`, () => { state.pantry.splice(idx, 0, removed); saveState(); rerender(); });
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
    if (typeof Tesseract === 'undefined') {
      statusEl.textContent = 'Receipt scanning needs a connection the first time (the OCR library could not load).';
      return;
    }
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
            ${items.map((it, i) => `<li class="card" style="margin-bottom:0.5rem;"><label><input type="checkbox" data-idx="${i}" checked> ${escapeHtml(it.name)} <small>(${escapeHtml(it.qty)} ${escapeHtml(it.unit)})</small></label></li>`).join('')}
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
  const days = Object.values(state.days || {}).filter(d => d && SLOTS.some(s => d[s])).length;
  const eaten = Object.values(state.days || {}).reduce((acc, day) => acc + ['breakfast','lunch','dinner'].filter(s => day[s]?.status === 'eaten').length, 0);
  const pantryCount = (state.pantry || []).length;
  const customCount = (state.customMeals || []).length;
  // Last 14 days of eaten meals for a simple trend
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const key = addDays(getTodayKey(), -i);
    const day = state.days[key] || {};
    const count = ['breakfast','lunch','dinner'].filter(s => day[s]?.status === 'eaten').length;
    trend.push(count);
  }
  const max = Math.max(1, ...trend);
  const bars = trend.map(c => `<div style="flex:1;background:var(--primary);height:${(c/max)*60}px;border-radius:3px 3px 0 0;min-width:8px;" title="${c}"></div>`).join('');
  el.innerHTML = `
    <div class="card">
      <p>Days with plans: <strong>${days}</strong></p>
      <p>Meals marked eaten: <strong>${eaten}</strong></p>
      <p>Pantry items: <strong>${pantryCount}</strong></p>
      <p>Custom recipes: <strong>${customCount}</strong></p>
    </div>
    <div class="card">
      <h3>Eaten meals (last 14 days)</h3>
      <div style="display:flex;align-items:flex-end;gap:4px;height:70px;" role="img" aria-label="Meals eaten per day over the last 14 days: ${trend.join(', ')}">${bars}</div>
      <p style="font-size:0.85rem;color:var(--muted);margin-top:0.5rem;">Each bar is one day.</p>
    </div>
    <p><small>Local-only insights. No data leaves the device.</small></p>
  `;
}


// Basic Cook mode (P2 #14 foundation): step-by-step, Escape to close, arrow keys, simple timer
function openCookMode(meal) {
  document.getElementById('cook-overlay')?.remove();
  const returnFocus = document.activeElement;
  let step = 0;
  const steps = (meal.steps && meal.steps.length) ? meal.steps : ['No steps listed.'];
  const overlay = document.createElement('div');
  overlay.id = 'cook-overlay';
    overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cook-title');
  overlay.innerHTML = `
    <h2 id="cook-title">${escapeHtml(meal.name)}</h2>
    <p>Step <span id="step-num">${step + 1}</span> of ${steps.length}</p>
    <div id="step-text" class="card" aria-live="polite">${escapeHtml(steps[step])}</div>
    <div class="button-row">
      <button type="button" id="prev-step" class="secondary">← Previous</button>
      <button type="button" id="next-step">Next →</button>
      <button type="button" id="start-timer" class="secondary">Start 5 min timer</button>
      <span id="timer-display" role="timer" aria-live="off"></span>
    </div>
    <button type="button" id="close-cook" class="secondary">Close (Esc)</button>
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
    display.textContent = '5:00';
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      secs--;
      display.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (secs <= 0) { clearInterval(timerId); display.textContent = 'Done!'; }
    }, 1000);
  });
  let wakeLock = null;
  function close() {
    if (timerId) clearInterval(timerId);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    wakeLock?.release?.().catch(() => {});
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }
  overlay.querySelector('#close-cook').addEventListener('click', close);
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && step < steps.length - 1) { step++; updateStep(); }
    if (e.key === 'ArrowLeft' && step > 0) { step--; updateStep(); }
  }
  document.addEventListener('keydown', onKey);
  // Wake Lock attempt
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
}


// PWA service worker (not needed inside the native app shell)
if ('serviceWorker' in navigator && !window.Capacitor) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Initial render (also handles old #today/#week/#meals links)
route();
