import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { config } from '../config.js';
import { changed } from '../lib/events.js';
import { readJson, writeJson } from './json-file.js';

// The task board's cards, kept in board.json. Running them is board/runner.js.

const FILE = config.files.tasks;
export const COLUMNS = ['todo', 'doing', 'done'];

const board = readJson(FILE, { cards: [] });

export function saveTasks() {
  writeJson(FILE, board);
  changed();
}

// A run the bot was doing when it stopped can't be picked up again.
for (const card of board.cards) {
  if (card.status === 'running' || card.status === 'waiting') {
    card.status = 'failed';
    card.error = 'Interrupted: the bot restarted during the run. Start it again to rerun it.';
  }
}
saveTasks();

/** The folders a task may run in (BOARD_DIRS), as { path, name }. */
export const folders = () =>
  config.board.dirs
    .filter((d) => existsSync(d) && statSync(d).isDirectory())
    .map((path) => ({ path, name: basename(path) }));

export const cards = () => board.cards;
export const findCard = (id) => board.cards.find((c) => c.id === id);
export const isBusy = (card) => card.status === 'running' || card.status === 'waiting';
export const anyBusy = () => board.cards.some(isBusy);

/** Checks a new task's answers; returns { field: message } for each problem. */
export function validate({ title, dir }) {
  const errors = {};
  const text = String(title || '').trim();
  if (!text) errors.title = 'Enter what the task is';
  else if (text.length > 300) errors.title = 'The task must be 300 characters or fewer';
  if (!folders().some((f) => f.path === dir)) errors.dir = 'Select the folder the task runs in';
  return errors;
}

export function addCard({ title, notes, dir }) {
  const now = new Date().toISOString();
  const card = {
    id: randomUUID(),
    column: 'todo',
    status: 'idle',
    title: String(title).trim(),
    notes: String(notes || '').slice(0, 20_000),
    dir,
    createdAt: now,
    updatedAt: now,
  };
  board.cards.push(card);
  saveTasks();
  return card;
}

/** Moves a task that isn't running to To do or Done, without running it. */
export function moveCard(card, column) {
  if (isBusy(card)) throw new Error('It is running; wait for it to finish.');
  if (!COLUMNS.includes(column) || column === 'doing') throw new Error('Unknown column.');
  card.column = column;
  if (column === 'todo') card.status = 'idle';
  card.updatedAt = new Date().toISOString();
  saveTasks();
}

export function deleteCard(card) {
  if (isBusy(card)) throw new Error('It is running; wait for it to finish.');
  board.cards = board.cards.filter((c) => c !== card);
  saveTasks();
}
