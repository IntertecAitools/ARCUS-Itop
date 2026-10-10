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
 */
export const useSessionStore = create<SessionState>((set) => ({
  user: {
    id: 'u-1',
    name: 'Vasanth',
    email: 'vasanth@intertec.local',
    role: 'IT Operations',
  },
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
