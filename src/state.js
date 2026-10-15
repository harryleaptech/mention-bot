import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../state.json', import.meta.url));
const MAX_SEEN = 2000;

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return { seen: [] };
  }
}

const state = load();
const seen = new Set(state.seen);

export const hasSeen = (key) => seen.has(key);

/** Remembers a handled mention so it is not offered again (survives restarts). */
export function markSeen(key) {
  seen.add(key);
  // The bot and the design-check command both write this file: keep the other's keys.
  const list = [...new Set([...load().seen, ...seen])].slice(-MAX_SEEN);
  writeFileSync(FILE, JSON.stringify({ seen: list }, null, 2));
}
