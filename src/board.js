import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTask } from './claude.js';

// The task board's store and run queue. A task started from the board runs with the local
// Claude Code in its folder; when it finishes it moves to Done (or stays in Doing, failed)
// and I get a DM. The web pages are in board-server.js.

const FILE = process.env.BOARD_FILE
  ? resolve(process.env.BOARD_FILE)
  : fileURLToPath(new URL('../board.json', import.meta.url));
export const COLUMNS = ['todo', 'doing', 'done'];
const MAX_RUNS = 1;

/** The folders a task may run in (BOARD_DIRS), as { path, name }. */
export function folders() {
  return (process.env.BOARD_DIRS || '').split(',').map((d) => d.trim()).filter(Boolean)
    .map((d) => resolve(d))
    .filter((d) => existsSync(d) && statSync(d).isDirectory())
    .map((path) => ({ path, name: basename(path) }));
}

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { cards: [] };
  }
}

const board = load();
const save = () => writeFileSync(FILE, JSON.stringify(board, null, 2));

// A run the bot was doing when it stopped can't be picked up again.
for (const card of board.cards) {
  if (card.status === 'running' || card.status === 'waiting') {
    card.status = 'failed';
    card.error = 'Interrupted: the bot restarted during the run. Start it again to rerun it.';
  }
}
save();

let notify = async () => {};
/** Called with the card when a run finishes, to DM me. */
export const onTaskFinished = (fn) => { notify = fn; };

export const cards = () => board.cards;
export const findCard = (id) => board.cards.find((c) => c.id === id);

let running = 0;

function startNext() {
  if (running >= MAX_RUNS) return;
  const card = board.cards.find((c) => c.status === 'waiting');
  if (!card) return;
  running += 1;
  card.status = 'running';
  card.startedAt = new Date().toISOString();
  save();
  console.log(`[board] running "${card.title}" in ${card.dir}`);

  runTask({ title: card.title, notes: card.notes, cwd: card.dir })
    .then(({ result, sessionId }) => {
      Object.assign(card, { status: 'done', column: 'done', result, sessionId });
    })
    .catch((e) => {
      Object.assign(card, { status: 'failed', error: e.message, sessionId: e.sessionId || card.sessionId });
    })
    .finally(() => {
      running -= 1;
      card.finishedAt = new Date().toISOString();
      card.updatedAt = card.finishedAt;
      save();
      console.log(`[board] ${card.status} "${card.title}"`);
      notify(card).catch((e) => console.error(`[board] DM failed: ${e.message}`));
      startNext();
    });
}

export const resumeQueue = startNext;

/** Checks a new task's answers; returns { field: message } for each problem. */
export function validate({ title, dir }) {
  const errors = {};
  if (!String(title || '').trim()) errors.title = 'Enter what the task is';
  else if (String(title).trim().length > 300) errors.title = 'The task must be 300 characters or fewer';
  if (!folders().some((f) => f.path === dir)) errors.dir = 'Select the folder the task runs in';
  return errors;
}

export function addCard({ title, notes, dir }) {
  const now = new Date().toISOString();
  const card = {
    id: randomUUID(), column: 'todo', status: 'idle',
    title: String(title).trim(), notes: String(notes || '').slice(0, 20_000), dir,
    createdAt: now, updatedAt: now,
  };
  board.cards.push(card);
  save();
  return card;
}

/** Sends a task to Doing and queues its run (also "run again" after a failure). */
export function startCard(card) {
  if (card.status === 'running' || card.status === 'waiting') return;
  Object.assign(card, {
    column: 'doing', status: 'waiting', result: undefined, error: undefined,
    finishedAt: undefined, updatedAt: new Date().toISOString(),
  });
  save();
  startNext();
}

/** Moves a task that isn't running to To do or Done, without running it. */
export function moveCard(card, column) {
  if (card.status === 'running' || card.status === 'waiting') throw new Error('It is running; wait for it to finish.');
  if (!COLUMNS.includes(column) || column === 'doing') throw new Error('Unknown column.');
  card.column = column;
  if (column === 'todo') Object.assign(card, { status: 'idle' });
  card.updatedAt = new Date().toISOString();
  save();
}

export function deleteCard(card) {
  if (card.status === 'running' || card.status === 'waiting') throw new Error('It is running; wait for it to finish.');
  board.cards = board.cards.filter((c) => c !== card);
  save();
}
