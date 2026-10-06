import { authHandlers } from './auth';
import { changesHandlers } from './changes';
import { cmdbHandlers } from './cmdb';
import { contactsHandlers } from './contacts';
import { incidentsHandlers } from './incidents';
import { knowledgeBaseHandlers } from './knowledgeBase';
import { problemsHandlers } from './problems';
import { serviceCatalogHandlers } from './serviceCatalog';
import { userRequestsHandlers } from './userRequests';

/** The fake BFF: one handler file per feature */
export const handlers = [
  ...authHandlers,
  ...problemsHandlers,
  ...knowledgeBaseHandlers,
  ...contactsHandlers,
  ...serviceCatalogHandlers,
  ...cmdbHandlers,
  ...changesHandlers,
  ...incidentsHandlers,
  ...userRequestsHandlers,
];
