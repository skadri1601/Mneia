import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppHeader } from '../components/AppHeader.js';
import {
  ProjectMenuProvider,
  ProjectSkipLink,
} from '../components/project-workspace/ProjectMenuProvider.js';
import { PROJECT_MENU_BOOTSTRAP } from '../components/project-workspace/project-menu-state.js';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'Mneia workspace',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${inter.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
        <head>
          <script>{PROJECT_MENU_BOOTSTRAP}</script>
        </head>
        <body>
          <ProjectMenuProvider>
            <ProjectSkipLink />
            <AppHeader />
            {children}
          </ProjectMenuProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
