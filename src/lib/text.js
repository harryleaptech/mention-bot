/** Cuts text to `max` characters, ending with an ellipsis when it was longer. */
export const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max)}…` : text || '');
