import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// The board only answers this Mac, and only to its own pages.

/**
 * Every form carries this key. Another website open in my browser can't read the pages, so it
 * can't post a form that starts a task here. It changes when the bot restarts.
 */
export const FORM_KEY = randomBytes(24).toString('hex');

const LOCAL = new Set([`127.0.0.1:${config.board.port}`, `localhost:${config.board.port}`]);

function keyMatches(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(FORM_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only this machine, by name: stops a DNS-rebinding page from talking to the board. */
export function localOnly(req, res, next) {
  if (LOCAL.has(req.headers.host)) return next();
  return res.status(403).send('Local only');
}

/** A form must come from these pages: the key, and (when the browser says) the same origin. */
export function formsFromThesePages(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.headers.origin;
  if (origin && !LOCAL.has(origin.replace(/^https?:\/\//, ''))) return res.status(403).send('Wrong origin');
  if (!keyMatches(req.body.key)) return res.status(403).render('pages/expired.njk');
  return next();
}
