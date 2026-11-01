/* Larder Improved — UI layer (iteration 3)
   Added validated recipe form UI, Shop pantry integration, improved Week skeleton.
   Accessible focus, labels, role=alert.
*/
import { state, saveState, MEALS, aggregateGrocery, computeCost, checkConflicts, validateRecipeForm, addToPantry, addCustomMeal, getAllMeals, getExpiringSoon, suggestUseItUp, markEatenAndDeduct, planLeftover, exportData, importData, resetData, copyDay, pushUndo, popUndo, computeDailyNutrition, getTargets } from './app.js';
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
  else if (page === 'week') renderWeek();
  else if (page === 'meals') renderMeals();
  else if (page === 'shop') renderShop();
  else if (page === 'pantry') renderPantry();
  else if (page === 'review') renderReview();
  else if (page === 'settings') renderSettings();
}

// Initial render
renderPage('today');
