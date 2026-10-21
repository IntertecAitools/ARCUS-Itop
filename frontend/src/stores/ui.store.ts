import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';
/** The public look (landing, sign-in, portal) has its own switch: dark by default. */
export type PublicTheme = 'dark' | 'light';

interface UiState {
  sidebarCollapsed: boolean;
  theme: ThemePreference;
  publicTheme: PublicTheme;
  commandPaletteOpen: boolean;
  /** Phones and tablets: the sidebar slides in over the page. Never persisted. */
  mobileNavOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setPublicTheme: (publicTheme: PublicTheme) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'light',
      publicTheme: 'dark',
      commandPaletteOpen: false,
      mobileNavOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setTheme: (theme) => set({ theme }),
      setPublicTheme: (publicTheme) => set({ publicTheme }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
    }),
    {
      name: 'arcus.ui',
      // The palette is transient; never restore it open on reload.
      partialize: ({ sidebarCollapsed, theme, publicTheme }) => ({ sidebarCollapsed, theme, publicTheme }),
    },
  ),
);
