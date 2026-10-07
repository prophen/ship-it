import './globals.css';

export const metadata = {
  title: 'Ship It',
  description: 'Approval queue for the publishing agent. Nothing ships without a tap.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
