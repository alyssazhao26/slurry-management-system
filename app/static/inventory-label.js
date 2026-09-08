document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('#print-label')?.addEventListener('click', () => window.print());
  document.querySelector('#close-label')?.addEventListener('click', () => window.close());
});
