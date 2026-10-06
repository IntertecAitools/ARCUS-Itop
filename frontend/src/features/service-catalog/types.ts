/** iTop Service as returned by /services */
export interface ServiceOption {
  id: string;
  label: string;
  hint?: string;
}

/** iTop ServiceSubcategory (filtered by service) */
export interface SubcategoryOption {
  id: string;
  label: string;
  hint?: string;
}
