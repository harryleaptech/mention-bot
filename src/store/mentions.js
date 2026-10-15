import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { changed } from '../lib/events.js';
import { readJson, writeJson } from './json-file.js';

// Mentions waiting for my decision, shared by the Discord DMs and the task board. Each one
// keeps where its reply goes (`target`), not a function, so it can still be sent after a
// restart. Nothing is posted until I press Send in one of the two places.

const FILE = config.files.mentions;
const KEEP_DECIDED = 300;

const store = readJson(FILE, { items: [] });

function save() {
  // Keep every waiting mention, and the most recent decided ones.
  const waiting = store.items.filter((m) => m.status === 'waiting');
  const decided = store.items.filter((m) => m.status !== 'waiting').slice(-KEEP_DECIDED);
  store.items = [...decided, ...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeJson(FILE, store);
  changed();
}

// ---- Where replies go -------------------------------------------------------------------

const senders = {};

/** How to post a reply for one kind of target: fn(target, text) -> url of the reply. */
export const registerSender = (kind, fn) => {
  senders[kind] = fn;
};

// ---- Who wants to know about decisions --------------------------------------------------

const listeners = [];

/** Called with the mention whenever it is sent, skipped or made into a task. */
export const onDecided = (fn) => listeners.push(fn);

const announce = (mention) =>
  listeners.forEach((fn) =>
    Promise.resolve(fn(mention)).catch((e) => console.error(`[mentions] ${e.message}`)),
  );

// ---- Reading ----------------------------------------------------------------------------

export const waitingMentions = () => store.items.filter((m) => m.status === 'waiting');
export const findMention = (id) => store.items.find((m) => m.id === id);

// ---- Changing ---------------------------------------------------------------------------

export function addMention(item) {
  const mention = {
    id: randomUUID(),
    key: item.key,
    source: item.source,
    where: item.where,
    author: item.author,
    message: item.message,
    context: item.context,
    link: item.link,
    maxLen: item.maxLen,
    target: item.target,
    draft: item.draft || '',
    error: item.error,
    status: 'waiting',
    createdAt: new Date().toISOString(),
  };
  store.items.push(mention);
  save();
  return mention;
}

export function updateMention(mention, patch) {
  Object.assign(mention, patch);
  save();
}

/** Checks a reply before sending; returns a message, or '' when it can go. */
export function replyProblem(mention, text) {
  if (!String(text || '').trim()) return 'Enter the reply';
  if (text.length > mention.maxLen) {
    return `The reply must be ${mention.maxLen} characters or fewer (it is ${text.length})`;
  }
  return '';
}

/** Posts the reply once: a second press (here or in the DM) finds it already sent. */
export async function sendMention(mention, text) {
  if (mention.status !== 'waiting') throw new Error(`Already ${mention.status}.`);
  const problem = replyProblem(mention, text);
  if (problem) throw new Error(problem);
  const send = senders[mention.target?.kind];
  if (!send) throw new Error('This mention has no reply target; open it and reply there.');

  mention.status = 'sending';
  try {
    const url = await send(mention.target, text.trim());
    updateMention(mention, {
      status: 'sent',
      draft: text.trim(),
      sentUrl: url,
      decidedAt: new Date().toISOString(),
    });
    console.log(`[sent] ${mention.key} -> ${url}`);
    announce(mention);
    return url;
  } catch (e) {
    mention.status = 'waiting';
    throw e;
  }
}

/** Closes a mention without replying: 'skipped', or 'task' when it became a task. */
export function closeMention(mention, status) {
  if (mention.status !== 'waiting') throw new Error(`Already ${mention.status}.`);
  updateMention(mention, { status, decidedAt: new Date().toISOString() });
  announce(mention);
}
