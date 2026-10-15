// GOV.UK Frontend's components, plus live columns: the server tells the page the moment a
// mention arrives or a task changes (Server-Sent Events on /events), and the page swaps only
// the column that changed, so it doesn't jump. A check every 60 seconds is the backup and keeps
// "5 min ago" current. Without this script every page still works; you reload to see changes.
import { initAll } from '/govuk/govuk-frontend.min.js';

initAll();

// Success notices ("Reply sent", "Task started"…) fade out after 3 seconds. The notice is also
// taken out of the address, so a reload doesn't show it again. Error messages stay.
const notice = document.querySelector('.govuk-notification-banner--success');
if (notice) {
  const url = new URL(window.location.href);
  if (url.searchParams.has('notice')) {
    url.searchParams.delete('notice');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  setTimeout(() => {
    notice.classList.add('board-notice--hide');
    setTimeout(() => notice.remove(), 400);
  }, 3000);
}

const columns = document.getElementById('columns');
const status = document.getElementById('columns-status');

// What the server last sent for each column, to compare like with like (the browser rewrites
// HTML it parses, so comparing with innerHTML would always differ).
const last = {};
const sections = (root) => [...root.querySelectorAll('.board-column')];
const idOf = (section) => section.querySelector('.board-scroll')?.dataset.col;

// Something is waiting to be shown but was held back (hidden tab, or a control in use).
let held = false;

// Only a control in use holds an update back; a focused column (after a click in it) doesn't.
const inUse = () => {
  const el = document.activeElement;
  return columns.contains(el) && el.matches('a, button, input, textarea, select');
};

async function refresh() {
  if (document.hidden || inUse()) { held = true; return; }
  held = false;
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

  // Live: changes appear by themselves. Manual: the board waits for Refresh. The choice is
  // kept in this browser only (and the board works the same if storage is blocked).
  const box = document.getElementById('board-mode');
  const liveStatus = document.getElementById('board-live-status');
  const pending = document.getElementById('board-pending');
  const refreshButton = document.getElementById('board-refresh');
  let mode = 'live';
  try { mode = localStorage.getItem('board-mode') === 'manual' ? 'manual' : 'live'; } catch { /* storage blocked */ }

  const showPending = (on) => { pending.hidden = !on; refreshButton.classList.toggle('govuk-button--secondary', !on); };
  const setMode = (next) => {
    mode = next;
    try { localStorage.setItem('board-mode', mode); } catch { /* storage blocked */ }
    document.getElementById(`mode-${mode}`).checked = true;
    refreshButton.hidden = mode !== 'manual';
    if (mode === 'live') { showPending(false); refresh(); }
  };
  box.hidden = false;
  box.addEventListener('change', (ev) => { if (ev.target.name === 'mode') setMode(ev.target.value); });
  refreshButton.addEventListener('click', async () => { showPending(false); await refresh(); });
  setMode(mode);

  const live = new EventSource('/events'); // reconnects by itself after a bot restart
  const changedNow = () => (mode === 'live' ? refresh() : showPending(true));
  live.addEventListener('change', changedNow);
  let connectedBefore = false;
  live.addEventListener('open', () => {
    liveStatus.dataset.state = 'live';
    liveStatus.textContent = 'Connected';
    if (connectedBefore) changedNow(); // a reconnect: catch up on anything missed while away
    connectedBefore = true;
  });
  live.addEventListener('error', () => {
    liveStatus.dataset.state = 'off';
    liveStatus.textContent = 'Reconnecting…';
  });

  setInterval(() => { if (mode === 'live') refresh(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (mode === 'live' && !document.hidden && held) refresh(); });
  columns.addEventListener('focusout', () => setTimeout(() => { if (mode === 'live' && held) refresh(); }, 0));
}
