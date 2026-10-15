import { save } from './storage.js';

/**
 * The Theme menu. The page head already applied the saved theme before drawing (see
 * layout.njk); this only switches it: `data-theme` picks the colours, the `t-modern` class turns
 * on the Modern design (themes.css).
 */
export function startThemeSwitch() {
  const select = document.getElementById('board-theme');
  if (!select) return;

  const root = document.documentElement;
  select.value = root.getAttribute('data-theme') || 'govuk';
  select.addEventListener('change', () => {
    const theme = select.value;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('t-modern', theme !== 'govuk');
    save('board-theme', theme);
  });
}
