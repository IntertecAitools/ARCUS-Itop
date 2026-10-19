import { create } from 'zustand';

export interface CurrentUser {
  id: string;
  login: string;
  name: string;
  email: string;
  /** Shown under the name in the topbar. */
  role: string;
  isAdmin: boolean;
  avatarUrl?: string;
}

interface SessionState {
  user: CurrentUser | null;
  setUser: (user: CurrentUser | null) => void;
  clear: () => void;
}

/**
 * The signed-in user, for the shell to read.
 *
 * `features/auth` owns it: RequireAuth fills it from the BFF's /auth/me and
 * sign-out clears it. Screens read `user`; they never set it.
 */
export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
