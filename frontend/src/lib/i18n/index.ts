import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar as arDates, enGB } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { env } from '@/config/env';
import { ar } from './locales/ar';
import { en } from './locales/en';

/**
 * The interface languages. Adding one: a locale file beside `en.ts` with the
 * same keys, an entry here, and the BFF's LANGUAGES list
 * (backend/src/platform/auth/preferences.store.ts).
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr', dates: enGB },
  { code: 'ar', label: 'العربية', dir: 'rtl', dates: arDates },
] as const satisfies readonly { code: string; label: string; dir: 'ltr' | 'rtl'; dates: Locale }[];

export type Language = (typeof LANGUAGES)[number]['code'];

/** Where the choice is remembered before (and without) a session. */
export const LANGUAGE_STORAGE_KEY = 'arcus.lang';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage blocked: fall through to the browser's language.
  }
  const browser = typeof navigator === 'undefined' ? '' : navigator.language.slice(0, 2);
  if (isLanguage(browser)) return browser;
  return isLanguage(env.defaultLocale) ? env.defaultLocale : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes already
  returnNull: false,
});

/** `<html lang dir>` follow the language, so the whole layout mirrors in Arabic. */
export function applyDocumentLanguage(language: Language) {
  const def = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  document.documentElement.lang = def.code;
  document.documentElement.dir = def.dir;
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : 'en';
}

/** BCP 47 tag for Intl: Arabic keeps Arabic-Indic digits, as Arabic readers expect. */
export function intlLocale(language: Language = currentLanguage()): string {
  return language === 'ar' ? 'ar' : 'en-GB';
}

export function dateLocale(language: Language = currentLanguage()): Locale {
  return (LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]).dates;
}

export function isRtl(language: Language = currentLanguage()): boolean {
  return LANGUAGES.find((l) => l.code === language)?.dir === 'rtl';
}

/** Switches the interface language now, and remembers it on this device. */
export async function changeLanguage(language: Language) {
  await i18n.changeLanguage(language);
  applyDocumentLanguage(language);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Not remembered on this device; the account still keeps it.
  }
}

applyDocumentLanguage(currentLanguage());

export { i18n };
