import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CurrentUser } from '@/types';

interface SessionState {
  user: CurrentUser | null;
  token: string | null;
  /** True once the persisted session has been read from storage */
  hydrated: boolean;
  signIn: (user: CurrentUser, token: string) => void;
  signOut: () => void;
  markHydrated: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      hydrated: false,
      signIn: (user, token) => set({ user, token }),
      signOut: () => set({ user: null, token: null }),
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'arcus-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
      // Runs after reading storage (synchronously for localStorage).
      onRehydrateStorage: () => (state) => state?.markHydrated(),
    },
  ),
);
