// The installation's names. In production nginx answers /config.js itself,
// from APP_NAME, PLATFORM_NAME, COMPANY_NAME and BRAND_MARK on the web
// container (nginx/default.conf.template), and this file is never served.
// Here (development, tests) it is empty: the VITE_* values apply (config/env.ts).
window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};
