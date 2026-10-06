import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { App } from '@/App';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'IRAOPS', template: '%s · IRAOPS' },
  description: 'ARCUS IT service management',
};

export const viewport: Viewport = {
  // The browser chrome colour cannot reference a CSS variable; keep in sync with --color-primary.
  // eslint-disable-next-line no-restricted-syntax
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <App>{children}</App>
      </body>
    </html>
  );
}
