import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ZachnologyHR | Your employee profile', description: 'Your Zachnology employee directory profile.' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
