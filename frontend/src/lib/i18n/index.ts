import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

export const namespaces = ['common', 'nav', 'auth', 'dashboard', 'tickets', 'problems', 'knowledgeBase'] as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en'],
    ns: namespaces,
    defaultNS: 'common',
    resources: { en },
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
}

export { i18n };
