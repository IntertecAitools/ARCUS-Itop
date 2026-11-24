/**
 * Users never see iTop: it is the hidden system of record behind the product.
 * Messages the BFF passes on (its own errors, and iTop's own wording when iTop
 * refuses something) name the product users know instead: "Servicedesk", or
 * PUBLIC_NAME (setPublicName, at start).
 *
 * Case-sensitive on purpose: settings such as ITOP_USER keep their names.
 */
let publicName = "Servicedesk";

export function setPublicName(name: string): void {
  publicName = name;
}

export function publicText(message: string): string {
  return message
    .replace(/\b[Tt]his iTop\b/g, publicName)
    .replace(/\biTop\b/g, publicName);
}
