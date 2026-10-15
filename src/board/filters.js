// Nunjucks filters for the board's templates.

/** "15 Oct, 2:21pm" */
export function when(iso) {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(' am', 'am')
    .replace(' pm', 'pm');
}

/** "just now", "5 min ago", "3 h ago", or the date */
export function ago(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const clip = (text, max) =>
  text && text.length > max ? `${text.slice(0, max).trimEnd()}…` : text || '';

/** Claude answers in Markdown; a short preview on a card reads better as plain text. */
export function plain(text) {
  return String(text || '')
    .replace(/```[a-z]*\n?/gi, '') // code fences
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // **bold**, __bold__
    .replace(/`([^`]*)`/g, '$1') // `code`
    .replace(/^\s*(#{1,6}|>)\s*/gm, '') // # headings, > quotes
    .replace(/^\s*[-*]\s+/gm, '• ') // list bullets
    .replace(/\s+/g, ' ')
    .trim();
}

export function addFilters(env) {
  Object.entries({ when, ago, clip, plain }).forEach(([name, fn]) => env.addFilter(name, fn));
}
