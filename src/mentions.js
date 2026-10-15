import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changed } from './events.js';

// Mentions waiting for my decision, shared by the Discord DMs and the task board. Each one
// keeps where its reply goes (`target`), not a function, so it can still be sent after a
// restart. Nothing is posted until I press Send in one of the two places.

const FILE = process.env.MENTIONS_FILE
  ? resolve(process.env.MENTIONS_FILE)
  : fileURLToPath(new URL('../mentions.json', import.meta.url));
const KEEP = 300;

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { items: [] };
  }
}

const store = load();
const save = () => {
  // Keep every waiting one, and the most recent decided ones.
  const waiting = store.items.filter((m) => m.status === 'waiting');
  const decided = store.items.filter((m) => m.status !== 'waiting').slice(-KEEP);
  store.items = [...decided, ...waiting].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  writeFileSync(FILE, JSON.stringify(store, null, 2));
  changed();
};

const senders = {};
/** How to post a reply for one kind of target: fn(target, text) -> url. */
export const registerSender = (kind, fn) => { senders[kind] = fn; };

const listeners = [];
/** Called with the mention whenever it is sent, skipped or turned into a task. */
export const onDecided = (fn) => listeners.push(fn);
const decided = (m) => listeners.forEach((fn) => Promise.resolve(fn(m)).catch((e) => console.error(`[mentions] ${e.message}`)));

export const waitingMentions = () => store.items.filter((m) => m.status === 'waiting');
export const findMention = (id) => store.items.find((m) => m.id === id);

export function addMention(item) {
  const mention = {
    id: randomUUID(),
    key: item.key, source: item.source, where: item.where, author: item.author,
    message: item.message, context: item.context, link: item.link, maxLen: item.maxLen,
    target: item.target, draft: item.draft || '', error: item.error,
    status: 'waiting', createdAt: new Date().toISOString(),
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
  if (text.length > mention.maxLen) return `The reply must be ${mention.maxLen} characters or fewer (it is ${text.length})`;
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
    updateMention(mention, { status: 'sent', draft: text.trim(), sentUrl: url, decidedAt: new Date().toISOString() });
    console.log(`[sent] ${mention.key} -> ${url}`);
    decided(mention);
    return url;
  } catch (e) {
    mention.status = 'waiting';
    throw e;
  }
}

export function closeMention(mention, status) {
  if (mention.status !== 'waiting') throw new Error(`Already ${mention.status}.`);
  updateMention(mention, { status, decidedAt: new Date().toISOString() });
  decided(mention);
}
