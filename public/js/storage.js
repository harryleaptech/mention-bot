// This browser's own settings (theme, Live/Manual). The board works the same if storage is
// blocked; the choice just isn't remembered.

export function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked.
  }
}
