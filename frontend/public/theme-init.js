// Apply the stored theme before first paint so the page never flashes the
// wrong colour. Dark is the default; light only when chosen (or the system
// asks for it under "system").
// A file rather than an inline script, so the Content-Security-Policy can
// allow scripts from this origin only.
try {
  var t = localStorage.getItem('arcus.theme');
  if (t === 'light' || (t === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'light';
  }
} catch (e) {}
// The language (and so the reading direction) too, so an Arabic page never
// flashes left-to-right. lib/i18n sets the same on load.
try {
  var l = localStorage.getItem('arcus.lang');
  if (l === 'ar') {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }
} catch (e) {}
