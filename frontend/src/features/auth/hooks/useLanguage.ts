import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { changeLanguage, currentLanguage, isLanguage, type Language } from '@/lib/i18n';
import { saveLanguage } from '../api/auth.api';
import type { SessionUser } from '../types';
import { SESSION_KEY, useSession } from './useSession';

/** The interface language, and a way to change it that the account remembers. */
export function useLanguage() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: user } = useSession();
  const language: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  const setLanguage = async (next: Language) => {
    await changeLanguage(next);
    if (!user) return;
    queryClient.setQueryData<SessionUser>(SESSION_KEY, { ...user, language: next });
    // Kept on this device either way; the account follows when the BFF answers.
    await saveLanguage(next).catch(() => undefined);
  };

  return { language, setLanguage };
}

/** Applies the signed-in user's saved language, on any device they sign in from. */
export function useAccountLanguage() {
  const { data: user } = useSession();
  const saved = user?.language;
  useEffect(() => {
    if (isLanguage(saved) && saved !== currentLanguage()) void changeLanguage(saved);
  }, [saved]);
}
