import { readFileSync, writeFileSync } from 'node:fs';

/** Reads a JSON file, or returns `empty` when it is missing or unreadable. */
export function readJson(path, empty) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return empty;
  }
}

export const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));
