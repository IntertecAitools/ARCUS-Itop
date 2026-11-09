/**
 * Users never see iTop: it is the hidden system of record behind Servicedesk.
 * Messages the BFF passes on (its own errors, and iTop's own wording when iTop
 * refuses something) name the product users know instead.
 *
 * Case-sensitive on purpose: settings such as ITOP_USER keep their names.
 */
export function publicText(message: string): string {
  return message
    .replace(/\b[Tt]his iTop\b/g, "Servicedesk")
    .replace(/\biTop\b/g, "Servicedesk");
}
