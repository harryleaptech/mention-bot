import { config } from '../config.js';
import { readJson, writeJson } from './json-file.js';

// Keys of mentions (and design-check posts) already handled, so none is offered twice. Kept
// in state.json across restarts.

const FILE = config.files.seen;
const MAX_SEEN = 2000;

const load = () => readJson(FILE, { seen: [] });
const seen = new Set(load().seen);

export const hasSeen = (key) => seen.has(key);

export function markSeen(key) {
  seen.add(key);
  // The bot and the design-check command both write this file: keep the other's keys.
  const all = [...new Set([...load().seen, ...seen])].slice(-MAX_SEEN);
  writeJson(FILE, { seen: all });
}
