import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ShikshaSetu',
  description:
    'An AI-powered personalised learning platform: describe a topic or upload study material, and get a full interactive lesson back.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
