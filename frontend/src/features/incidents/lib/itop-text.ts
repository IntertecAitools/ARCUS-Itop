/**
 * iTop stores Text and CaseLog fields as HTML fragments (`<p>…</p>`).
 *
 * We render them as TEXT, never with dangerouslySetInnerHTML: the content
 * originates from end users and callers, so injecting it as markup would make
 * every ticket an XSS vector.
 *
 * Shared by the description, the resolution and the case log, because stripping
 * tags in one of the three and forgetting the others is exactly how raw markup
 * ends up on screen.
 */
export function toPlainText(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    // Collapse the blank lines the tag stripping leaves behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "in_person" -> "In person". For iTop's snake_case enum values. */
export function humanise(value: string | undefined | null): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
