import express from 'express';
import nunjucks from 'nunjucks';
import { config } from '../config.js';
import { folders } from '../store/tasks.js';
import { addFilters } from './filters.js';
import { liveRoutes } from './routes/live.js';
import { mentionRoutes } from './routes/mentions.js';
import { taskRoutes } from './routes/tasks.js';
import { resumeQueue } from './runner.js';
import { FORM_KEY, formsFromThesePages, localOnly } from './security.js';

// The task board's web pages, built with GOV.UK Frontend components (no crown, no GOV.UK name,
// no GDS Transport font: this is not a government service). Every page works without
// JavaScript; with it, the columns update live.

export function startBoard() {
  if (!folders().length) {
    console.log('[board] BOARD_DIRS is empty or has no existing folder: the task board is off.');
    return;
  }

  const app = express();
  app.disable('x-powered-by');

  const env = nunjucks.configure([config.root('views'), config.root('node_modules/govuk-frontend/dist')], {
    autoescape: true,
    express: app,
  });
  addFilters(env);
  app.set('view engine', 'njk');

  app.use(localOnly);
  app.use(
    '/govuk',
    express.static(config.root('node_modules/govuk-frontend/dist/govuk'), {
      index: false,
      setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
    }),
  );
  app.use('/static', express.static(config.root('public'), { index: false }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use((req, res, next) => {
    res.locals.key = FORM_KEY;
    res.locals.path = req.path;
    next();
  });
  app.use(formsFromThesePages);

  app.use(liveRoutes);
  app.use(taskRoutes);
  app.use(mentionRoutes);
  app.use((req, res) => res.status(404).render('pages/not-found.njk'));

  app.listen(config.board.port, '127.0.0.1', () =>
    console.log(`[board] http://127.0.0.1:${config.board.port}`),
  );
  resumeQueue();
}
