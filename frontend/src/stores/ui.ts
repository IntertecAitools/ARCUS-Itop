import { create } from 'zustand';

export type ToastTone = 'success' | 'danger' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface UiState {
  mobileNavOpen: boolean;
  toasts: ToastMessage[];
  setMobileNavOpen: (open: boolean) => void;
  pushToast: (toast: Omit<ToastMessage, 'id'>) => string;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>()((set) => ({
  mobileNavOpen: false,
  toasts: [],
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  pushToast: (toast) => {
    toastSeq += 1;
    const id = `toast-${toastSeq}`;
    // Keep the newest 4; identical consecutive messages are not stacked.
    set((state) => {
      const last = state.toasts[state.toasts.length - 1];
      if (last && last.title === toast.title && last.description === toast.description) return state;
      return { toasts: [...state.toasts.slice(-3), { ...toast, id }] };
    });
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers so hooks and query callbacks can raise toasts. */
export const toast = {
  success: (title: string, description?: string) => useUiStore.getState().pushToast({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useUiStore.getState().pushToast({ tone: 'danger', title, description }),
  info: (title: string, description?: string) => useUiStore.getState().pushToast({ tone: 'info', title, description }),
  warning: (title: string, description?: string) => useUiStore.getState().pushToast({ tone: 'warning', title, description }),
};
