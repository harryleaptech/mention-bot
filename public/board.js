// GOV.UK Frontend's components, plus a refresh of the columns: every 4 seconds while a task
// runs, every 12 seconds otherwise (new mentions arrive any time). Only a column whose content
// changed is swapped, so the board doesn't jump. Without this script every page still works;
// you reload to see changes.
import { initAll } from '/govuk/govuk-frontend.min.js';

initAll();

const columns = document.getElementById('columns');
const status = document.getElementById('columns-status');

// What the server last sent for each column, to compare like with like (the browser rewrites
// HTML it parses, so comparing with innerHTML would always differ).
const last = {};
const sections = (root) => [...root.querySelectorAll('.board-column')];
const idOf = (section) => section.querySelector('.board-scroll')?.dataset.col;

async function refresh() {
  // Don't swap the columns out from under someone using them, or while the tab is hidden.
  if (document.hidden) return;
  if (columns.contains(document.activeElement) && document.activeElement !== document.body) return;
  try {
    const res = await fetch('/columns', { headers: { Accept: 'text/html' } });
    if (!res.ok) return;
    const wasBusy = columns.dataset.busy === '1';
    columns.dataset.busy = res.headers.get('X-Busy') === '1' ? '1' : '0';

    const fresh = document.createElement('template');
    fresh.innerHTML = await res.text();
    const current = Object.fromEntries(sections(columns).map((s) => [idOf(s), s]));
    const first = !Object.keys(last).length;
    for (const section of sections(fresh.content)) {
      const id = idOf(section);
      const html = section.innerHTML;
      if (first) { last[id] = html; continue; } // the page already shows this
      if (!current[id] || last[id] === html) continue;
      const scroll = current[id].querySelector('.board-scroll');
      const top = scroll ? scroll.scrollTop : 0;
      current[id].innerHTML = html;
      const again = current[id].querySelector('.board-scroll');
      if (again) {
        again.style.scrollBehavior = 'auto'; // put it back where it was without animating
        again.scrollTop = top;
        again.style.scrollBehavior = '';
      }
      initAll({ scope: current[id] });
      last[id] = html;
    }
    if (wasBusy && columns.dataset.busy === '0') status.textContent = 'All tasks have finished.';
  } catch { /* the bot is restarting: try again next tick */ }
}

if (columns) {
  // The first fetch only records what the server sends; nothing is swapped unless it changed.
  refresh();
  let tick = 0;
  setInterval(() => {
    tick += 1;
    if (columns.dataset.busy === '1' || tick % 3 === 0) refresh();
  }, 4000);
}
