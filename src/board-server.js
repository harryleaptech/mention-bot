import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { changes } from './events.js';
import nunjucks from 'nunjucks';
import {
  addCard, cards, deleteCard, findCard, folders, moveCard, resumeQueue, startCard, validate,
} from './board.js';
import {
  closeMention, findMention, replyProblem, sendMention, updateMention, waitingMentions,
} from './mentions.js';

// The task board's web pages, built with GOV.UK Frontend (components only: no crown, no
// GOV.UK name, no GDS Transport font; this is not a government service). Every page works
// without JavaScript; the script only refreshes the columns while a task runs.

const PORT = Number(process.env.BOARD_PORT) || 4747;
const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

// Every form carries this key. Another website open in my browser can't read the pages,
// so it can't post a form that starts a task here. It changes when the bot restarts.
const KEY = randomBytes(24).toString('hex');
const LOCAL = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const keyMatches = (given) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
};

const STATUS = {
  idle: { text: 'To do', classes: 'govuk-tag--grey' },
  waiting: { text: 'Waiting', classes: 'govuk-tag--blue' },
  running: { text: 'Running', classes: 'govuk-tag--yellow' },
  done: { text: 'Done', classes: 'govuk-tag--green' },
  failed: { text: 'Failed', classes: 'govuk-tag--red' },
};

const NOTICES = {
  added: 'Task added to To do',
  started: 'Task started. You get a DM when it finishes.',
  todo: 'Task moved back to To do',
  done: 'Task moved to Done',
  deleted: 'Task deleted',
  sent: 'Reply sent',
  skipped: 'Mention skipped. Nothing was sent.',
  saved: 'Draft saved',
  tasked: 'Mention made into a task in To do. Nothing was sent.',
};

function view(card) {
  const folder = folders().find((f) => f.path === card.dir);
  const status = card.column === 'done' && card.status !== 'done'
    ? { text: 'Closed', classes: 'govuk-tag--grey' }
    : STATUS[card.status] || STATUS.idle;
  return {
    ...card,
    folderName: folder ? folder.name : card.dir,
    tag: status,
    busy: card.status === 'running' || card.status === 'waiting',
    resume: card.sessionId ? `cd ${card.dir} && claude --resume ${card.sessionId}` : '',
  };
}

function viewMention(m) {
  return { ...m, title: `${m.author} on ${m.source}` };
}

function columns() {
  const all = cards().map(view);
  return [
    { id: 'mentions', title: 'Mentions', mentions: waitingMentions().map(viewMention).reverse() },
    { id: 'todo', title: 'To do', cards: all.filter((c) => c.column === 'todo') },
    { id: 'doing', title: 'Doing', cards: all.filter((c) => c.column === 'doing') },
    { id: 'done', title: 'Done', cards: all.filter((c) => c.column === 'done').reverse() },
  ];
}

const anyBusy = () => cards().some((c) => c.status === 'running' || c.status === 'waiting');

export function startBoard() {
  if (!folders().length) {
    console.log('[board] BOARD_DIRS is empty or has no existing folder: the task board is off.');
    return;
  }

  const app = express();
  app.disable('x-powered-by');

  const env = nunjucks.configure([root('views'), root('node_modules/govuk-frontend/dist')], {
    autoescape: true, express: app, noCache: false,
  });
  env.addFilter('when', (iso) => (iso ? new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(' am', 'am').replace(' pm', 'pm') : ''));
  env.addFilter('ago', (iso) => {
    if (!iso) return '';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  });
  env.addFilter('clip', (s, n) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || ''));
  // Claude answers in Markdown; a short preview reads better as plain text.
  env.addFilter('plain', (s) => String(s || '')
    .replace(/```[a-z]*\n?/gi, '')            // code fences
    .replace(/(\*\*|__)(.+?)\1/g, '$2')      // **bold**, __bold__
    .replace(/`([^`]*)`/g, '$1')              // `code`
    .replace(/^\s*(#{1,6}|>)\s*/gm, '')       // # headings, > quotes
    .replace(/^\s*[-*]\s+/gm, '• ')           // list bullets
    .replace(/\s+/g, ' ').trim());
  app.set('view engine', 'njk');

  // Only this machine, by name: stops a DNS-rebinding page from talking to the board.
  app.use((req, res, next) => (LOCAL.has(req.headers.host) ? next() : res.status(403).send('Local only')));

  app.use('/govuk', express.static(root('node_modules/govuk-frontend/dist/govuk'), {
    index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  }));
  app.use('/static', express.static(root('public'), { index: false }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // A form must come from these pages: the key, and (when the browser says) the same origin.
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.headers.origin;
    if (origin && !LOCAL.has(origin.replace(/^https?:\/\//, ''))) return res.status(403).send('Wrong origin');
    if (!keyMatches(req.body.key)) return res.status(403).render('expired.njk', { key: KEY });
    return next();
  });

  app.use((req, res, next) => {
    res.locals.key = KEY;
    res.locals.path = req.path;
    next();
  });

  const card = (req, res) => {
    const found = findCard(req.params.id);
    if (!found) res.status(404).render('not-found.njk');
    return found;
  };

  app.get('/', (req, res) => {
    res.render('board.njk', { columns: columns(), notice: NOTICES[req.query.notice], busy: anyBusy() });
  });

  // Live updates: the page keeps this open and refreshes its columns when told something
  // changed (Server-Sent Events: one-way, built into browsers, reconnects by itself).
  app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    let timer = null;
    const onChange = () => { // several saves in a row become one message
      clearTimeout(timer);
      timer = setTimeout(() => res.write('event: change\ndata: {}\n\n'), 150);
    };
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    changes.on('change', onChange);
    req.on('close', () => { changes.off('change', onChange); clearInterval(ping); clearTimeout(timer); });
  });

  // The columns alone, for the page's live refresh.
  app.get('/columns', (req, res) => {
    res.set('X-Busy', anyBusy() ? '1' : '0').render('columns.njk', { columns: columns() });
  });

  app.get('/tasks/new', (req, res) => {
    res.render('new.njk', { folders: folders(), values: { dir: folders()[0]?.path } });
  });

  app.post('/tasks', (req, res) => {
    const values = { title: req.body.title, notes: req.body.notes, dir: req.body.dir };
    const errors = validate(values);
    if (Object.keys(errors).length) return res.status(400).render('new.njk', { folders: folders(), values, errors });
    const created = addCard(values);
    if (req.body.action === 'start') {
      startCard(created);
      return res.redirect(303, '/?notice=started');
    }
    return res.redirect(303, '/?notice=added');
  });

  app.get('/tasks/:id', (req, res) => {
    const found = card(req, res);
    if (found) res.render('task.njk', { card: view(found), notice: NOTICES[req.query.notice] });
  });

  app.post('/tasks/:id/:action', (req, res) => {
    const found = card(req, res);
    if (!found) return;
    const back = req.body.back === 'task' ? `/tasks/${found.id}` : '/';
    try {
      if (req.params.action === 'start') startCard(found);
      else if (req.params.action === 'todo' || req.params.action === 'done') moveCard(found, req.params.action);
      else if (req.params.action === 'delete') {
        deleteCard(found);
        return res.redirect(303, '/?notice=deleted');
      } else return res.status(404).render('not-found.njk');
      const notice = req.params.action === 'start' ? 'started' : req.params.action;
      return res.redirect(303, `${back}?notice=${notice}`);
    } catch (e) {
      return res.status(409).render('task.njk', { card: view(found), problem: e.message });
    }
  });

  app.get('/tasks/:id/delete', (req, res) => {
    const found = card(req, res);
    if (found) res.render('delete.njk', { card: view(found) });
  });

  const mention = (req, res) => {
    const found = findMention(req.params.id);
    if (!found) res.status(404).render('not-found.njk');
    return found;
  };

  app.get('/mentions/:id', (req, res) => {
    const found = mention(req, res);
    if (found) res.render('mention.njk', { mention: viewMention(found), reply: found.draft, notice: NOTICES[req.query.notice] });
  });

  app.post('/mentions/:id/:action', async (req, res) => {
    const found = mention(req, res);
    if (!found) return;
    const reply = typeof req.body.reply === 'string' ? req.body.reply : found.draft;
    const again = (problem, code = 400) => res.status(code).render('mention.njk', { mention: viewMention(found), reply, problem });
    const back = req.body.back === 'mention' ? `/mentions/${found.id}` : '/';
    try {
      if (found.status !== 'waiting') return again(`This mention is already ${found.status}.`, 409);
      switch (req.params.action) {
        case 'save':
          updateMention(found, { draft: reply.trim(), error: undefined });
          return res.redirect(303, `/mentions/${found.id}?notice=saved`);
        case 'send': {
          const problem = replyProblem(found, reply);
          if (problem) return again(problem);
          await sendMention(found, reply);
          return res.redirect(303, '/?notice=sent');
        }
        case 'skip':
          closeMention(found, 'skipped');
          return res.redirect(303, `${back === '/' ? '/' : back}?notice=skipped`);
        case 'task': {
          const card = addCard({
            title: `Follow up: ${found.author} on ${found.where}`.slice(0, 300),
            notes: [`${found.source} mention from ${found.author} (${found.link}):`, '', found.message].join('\n'),
            dir: folders()[0].path,
          });
          closeMention(found, 'task');
          return res.redirect(303, `/tasks/${card.id}?notice=tasked`);
        }
        default:
          return res.status(404).render('not-found.njk');
      }
    } catch (e) {
      return again(`Not sent: ${e.message}`, 502);
    }
  });

  app.use((req, res) => res.status(404).render('not-found.njk'));

  app.listen(PORT, '127.0.0.1', () => console.log(`[board] http://127.0.0.1:${PORT}`));
  resumeQueue();
}
