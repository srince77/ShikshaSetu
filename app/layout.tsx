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
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600&family=Manrope:wght@400;500;600;700&family=Hind:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
