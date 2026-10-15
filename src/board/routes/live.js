import { Router } from 'express';
import { changes } from '../../lib/events.js';
import { anyBusy } from '../../store/tasks.js';
import { columns, NOTICES } from '../view-models.js';

// The board page, its columns alone (for live redraws), and the live update stream.

export const liveRoutes = Router();

liveRoutes.get('/', (req, res) => {
  res.render('pages/board.njk', { columns: columns(), notice: NOTICES[req.query.notice], busy: anyBusy() });
});

liveRoutes.get('/columns', (req, res) => {
  res.set('X-Busy', anyBusy() ? '1' : '0').render('partials/columns.njk', { columns: columns() });
});

/**
 * Live updates: the page keeps this open and redraws its columns when told something changed.
 * Server-Sent Events: one-way, built into browsers, and they reconnect by themselves.
 */
liveRoutes.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  let timer = null;
  const onChange = () => {
    // Several saves in a row become one message.
    clearTimeout(timer);
    timer = setTimeout(() => res.write('event: change\ndata: {}\n\n'), 150);
  };
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  changes.on('change', onChange);
  req.on('close', () => {
    changes.off('change', onChange);
    clearInterval(ping);
    clearTimeout(timer);
  });
});
