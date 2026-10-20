// inbox: the signed-in user's in-app notifications (iTop's newsroom).

export interface InboxItem {
  id: number;
  title: string;
  message: string;
  date: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  read: boolean;
  /** The record it is about; opened in this platform. */
  record: { type: string; id: number } | null;
}

export interface InboxList {
  items: InboxItem[];
  unread: number;
}
