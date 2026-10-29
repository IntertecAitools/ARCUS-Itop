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
  /**
   * Sidebar groups the user opened or closed by hand, by group id. Not persisted:
   * after a sign-in or reload only the group holding the current page is open.
   */
  navGroupsOpen: Record<string, boolean>;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setPublicTheme: (publicTheme: PublicTheme) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setNavGroupOpen: (id: string, open: boolean) => void;
  resetNavGroups: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      publicTheme: 'dark',
      commandPaletteOpen: false,
      mobileNavOpen: false,
      navGroupsOpen: {},
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setTheme: (theme) => set({ theme }),
      setPublicTheme: (publicTheme) => set({ publicTheme }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      setNavGroupOpen: (id, open) => set((s) => ({ navGroupsOpen: { ...s.navGroupsOpen, [id]: open } })),
      resetNavGroups: () => set({ navGroupsOpen: {} }),
    }),
    {
      name: 'arcus.ui',
      // The palette is transient; never restore it open on reload.
      partialize: ({ sidebarCollapsed, theme, publicTheme }) => ({ sidebarCollapsed, theme, publicTheme }),
    },
  ),
);
