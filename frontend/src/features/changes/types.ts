/** Change option from /changes?open=true (only Changes not closed may be related) */
export interface ChangeOption {
  id: string;
  label: string;
  /** e.g. "NormalChange · planned" */
  hint?: string;
}
