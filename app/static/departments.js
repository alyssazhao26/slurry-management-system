const department = document.body.dataset.department || new URLSearchParams(location.search).get(
  'department') || 'slurry';
// Coating intentionally reuses the complete Slitting workflow and UI.
const isSlitting = department === 'slitting' || department === 'coating';
