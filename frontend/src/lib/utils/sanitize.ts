import DOMPurify from 'dompurify';

/**
 * Sanitise iTop HTML (descriptions, case log entries) before rendering it.
 * Returns an empty string outside the browser; the app renders client-side only.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html || typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  });
}
