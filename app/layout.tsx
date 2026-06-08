import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { compileThemeStylesheet, THEME_BOOTSTRAP_SCRIPT } from "@/lib/themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { AppProviders } from "@/components/AppProviders";

export const metadata: Metadata = {
  title: {
    default: "Loom",
    template: "%s · Loom",
  },
  description: "Self-hosted AI portal · OpenAI-compatible · MCP · Playground · Logs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Server-rendered theme tokens. Every registered preset emits a
            `:root[data-theme="<id>"]` block; whichever data-theme the
            bootstrap script sets below takes effect immediately. */}
        <style
          id="loom-theme-tokens"
          dangerouslySetInnerHTML={{ __html: compileThemeStylesheet() }}
        />
        {/* Runs before React hydrates: reads the persisted theme id from
            localStorage and applies data-theme to <html>. Without this,
            the page paints once with the default theme before the
            client-side ThemeApplier catches up. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
