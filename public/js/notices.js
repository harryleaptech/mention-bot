/**
 * Success notices ("Reply sent", "Task started"…) fade out after 3 seconds. The notice is also
 * taken out of the address, so a reload doesn't show it again. Error messages stay.
 */
export function fadeSuccessNotice() {
  const notice = document.querySelector('.govuk-notification-banner--success');
  if (!notice) return;

  const url = new URL(window.location.href);
  if (url.searchParams.has('notice')) {
    url.searchParams.delete('notice');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  setTimeout(() => {
    notice.classList.add('board-notice--hide');
    setTimeout(() => notice.remove(), 400);
  }, 3000);
}
