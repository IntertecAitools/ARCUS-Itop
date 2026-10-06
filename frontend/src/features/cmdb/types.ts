/** iTop lnkFunctionalCIToTicket.impact_code */
export type CiImpactCode = 'manual' | 'computed' | 'not_impacted';

/** Entry of a ticket's functionalcis_list */
export interface LinkedCi {
  functionalci_id: string;
  functionalci_name: string;
  /** iTop finalclass, e.g. Server, WebApplication */
  functionalci_class: string;
  impact_code: CiImpactCode;
}
