import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Codex Gateway',
  description: 'Console for the Codex agent running behind the gateway',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
