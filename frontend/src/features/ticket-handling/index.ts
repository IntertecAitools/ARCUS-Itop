// ticket-handling: public API. Other features may import ONLY from this file.
// Priority override, duplicates, cancel and worklogs on a ticket's own screen.
export { TicketHandlingPanel } from './components/TicketHandlingPanel';
// On the new-ticket forms: likely duplicates, and server-side drafts.
export { DuplicateSuggestions } from './components/DuplicateSuggestions';
export { DraftBar } from './components/DraftBar';
export { useTicketDraft, type TicketDraftState } from './hooks/useTicketDraft';
export { MyDraftsPage } from './pages/MyDraftsPage';
export { TimeReportPage } from './pages/TimeReportPage';
export { formatMinutes, parseDuration, parseTicketRef } from './lib/format';
export type * from './types';
