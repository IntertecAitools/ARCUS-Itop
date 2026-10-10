import { create } from 'zustand';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** Shown under the name in the topbar. */
  role: string;
  avatarUrl?: string;
}

interface SessionState {
  user: CurrentUser | null;
  setUser: (user: CurrentUser | null) => void;
  clear: () => void;
}

/**
 * Placeholder session until `features/auth` lands. The auth module will own
 * hydration from the BFF; the shell only ever reads `user`.
 *
 * `admin` is not arbitrary: it is the iTop account the BFF actually writes
 * through, so the name in the topbar matches who owns the change log entries
 * every edit produces. When auth lands this is replaced by the real session.
 */
export const useSessionStore = create<SessionState>((set) => ({
  user: {
    id: 'u-1',
    name: 'admin',
    email: 'admin@intertec.local',
    role: 'Administrator',
  },
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
