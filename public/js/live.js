import { initAll } from '/govuk/govuk-frontend.min.js';
import { load, save } from './storage.js';

// Live columns. The server tells the page the moment a mention arrives or a task changes
// (Server-Sent Events on /events), and the page redraws only the column that changed, so it
// doesn't jump. Live mode does that by itself; Manual mode shows "New updates" and waits for
// Refresh. A check every 60 seconds is the backup and keeps "5 min ago" current.

const sections = (root) => [...root.querySelectorAll('.board-column')];
const idOf = (section) => section.querySelector('.board-scroll')?.dataset.col;

/** Fetches the columns and swaps the ones whose content changed. */
function makeRefresher(columns) {
  const status = document.getElementById('columns-status');
  // What the server last sent for each column: compare like with like (the browser rewrites
  // HTML it parses, so comparing with innerHTML would always differ).
  const last = {};
  const state = { held: false };

  // Only a control in use holds an update back; a focused column (after a click in it) doesn't.
  const inUse = () => {
    const el = document.activeElement;
    return columns.contains(el) && el.matches('a, button, input, textarea, select');
  };

  function swap(section, html) {
    const scroll = section.querySelector('.board-scroll');
    const top = scroll ? scroll.scrollTop : 0;
    section.innerHTML = html;
    const again = section.querySelector('.board-scroll');
    if (again) {
      again.style.scrollBehavior = 'auto'; // back where it was, without animating
      again.scrollTop = top;
      again.style.scrollBehavior = '';
    }
    initAll({ scope: section });
  }

  async function refresh() {
    if (document.hidden || inUse()) {
      state.held = true;
      return;
    }
    state.held = false;
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
        if (!first && current[id] && last[id] !== html) swap(current[id], html);
        last[id] = html; // on the first fetch the page already shows this
      }
      if (wasBusy && columns.dataset.busy === '0') status.textContent = 'All tasks have finished.';
    } catch {
      // The bot is restarting: try again next time.
    }
  }

  return { refresh, state };
}

export function startLiveColumns() {
  const columns = document.getElementById('columns');
  if (!columns) return;

  const { refresh, state } = makeRefresher(columns);
  refresh();

  // ---- Live / Manual ----
  const box = document.getElementById('board-mode');
  const liveStatus = document.getElementById('board-live-status');
  const pending = document.getElementById('board-pending');
  const refreshButton = document.getElementById('board-refresh');
  let mode = load('board-mode') === 'manual' ? 'manual' : 'live';

  const showPending = (on) => {
    pending.hidden = !on;
    refreshButton.classList.toggle('govuk-button--secondary', !on);
  };
  const setMode = (next) => {
    mode = next;
    save('board-mode', mode);
    document.getElementById(`mode-${mode}`).checked = true;
    refreshButton.hidden = mode !== 'manual';
    if (mode === 'live') {
      showPending(false);
      refresh();
    }
  };

  box.hidden = false;
  box.addEventListener('change', (ev) => {
    if (ev.target.name === 'mode') setMode(ev.target.value);
  });
  refreshButton.addEventListener('click', async () => {
    showPending(false);
    await refresh();
  });
  setMode(mode);

  // ---- The live stream ----
  const somethingChanged = () => (mode === 'live' ? refresh() : showPending(true));
  const stream = new EventSource('/events'); // reconnects by itself after a bot restart
  let connectedBefore = false;
  stream.addEventListener('change', somethingChanged);
  stream.addEventListener('open', () => {
    liveStatus.dataset.state = 'live';
    liveStatus.textContent = 'Connected';
    if (connectedBefore) somethingChanged(); // a reconnect: catch up on what was missed
    connectedBefore = true;
  });
  stream.addEventListener('error', () => {
    liveStatus.dataset.state = 'off';
    liveStatus.textContent = 'Reconnecting…';
  });

  // ---- Catching up on what was held back ----
  const catchUp = () => {
    if (mode === 'live' && state.held) refresh();
  };
  setInterval(() => mode === 'live' && refresh(), 60_000);
  document.addEventListener('visibilitychange', () => !document.hidden && catchUp());
  columns.addEventListener('focusout', () => setTimeout(catchUp, 0));
}
