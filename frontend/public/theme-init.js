// Apply the stored theme before first paint so dark mode never flashes white.
// A file rather than an inline script, so the Content-Security-Policy can
// allow scripts from this origin only.
try {
  var t = localStorage.getItem('arcus.theme');
  if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'dark';
  }
} catch (e) {}
