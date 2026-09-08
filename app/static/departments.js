const department = document.body.dataset.department || new URLSearchParams(location.search).get('department') || 'slurry';
const isSlitting = department === 'slitting';
