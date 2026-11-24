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
// The installation's name in the tab, and its logo as the favicon, from
// /config.js (loaded just before this file). The app sets the same once it
// runs (features/branding), and a tenant's own branding after that.
try {
  var c = window.__APP_CONFIG__ || {};
  var n = c.appName || 'Intertec';
  var p = c.platformName === undefined ? 'Servicedesk' : c.platformName;
  document.title = p ? n + ' ' + p : n;
  if (c.brandMark === 'iraops') {
    var i = document.querySelector('link[rel="icon"]');
    if (i) i.setAttribute('href', '/brand/iraops-favicon.svg');
  }
} catch (e) {}
