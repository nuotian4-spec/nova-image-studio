import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Script from "next/script";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";
import { EmbedBridge } from "@/components/EmbedBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "麦迅工坊 - 生图与 Agent 工作台",
  description: "Maixun Studio · 生图与 Agent 工作台",
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/icon-192.png',
  },
  manifest: '/manifest.json',
  other: {
    'theme-color': '#1a1a2e',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var params = new URLSearchParams(window.location.search);
                  if (params.get('embedded') === '1') {
                    document.documentElement.setAttribute('data-nova-embedded', '1');
                  }
                  if (params.get('embedded') === '1' && window.parent && window.parent !== window) {
                    var parentRoot = window.parent.document.documentElement;
                    var parentTheme = parentRoot.getAttribute('data-theme') || parentRoot.getAttribute('data-dark') || '';
                    if (parentRoot.classList.contains('dark') || parentTheme === 'dark') {
                      document.documentElement.setAttribute('data-theme', 'dark');
                      return;
                    }
                    if (parentRoot.classList.contains('light') || parentTheme === 'light') {
                      document.documentElement.setAttribute('data-theme', 'light');
                      return;
                    }
                  }
                  const theme = window.localStorage.getItem('theme');
                  if (theme === 'dark' || theme === 'light') {
                    document.documentElement.setAttribute('data-theme', theme);
                  } else {
                    document.documentElement.removeAttribute('data-theme');
                  }
                } catch {
                  document.documentElement.removeAttribute('data-theme');
                }
              })();
            `,
          }}
        />
        <Script
          id="embed-queue-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  window.__novaEmbedQueue = window.__novaEmbedQueue || [];
                  window.addEventListener('message', function(ev) {
                    if (!ev || ev.origin !== window.location.origin) return;
                    if (!ev.data || typeof ev.data !== 'object') return;
                    var t = ev.data.type;
                    if (t !== 'sub2api:nova-studio-config' && t !== 'sub2api:nova-studio-revoke') return;
                    if (typeof window.__novaEmbedIngest === 'function') {
                      window.__novaEmbedIngest(ev.data);
                    } else {
                      window.__novaEmbedQueue.push(ev.data);
                    }
                  });
                } catch {}
              })();
            `,
          }}
        />
        <Script
          id="wide-mode-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = window.localStorage.getItem('nova-wide-mode');
                  var wide = stored === 'enabled' && window.innerWidth >= 1280;
                  if (wide) {
                    document.documentElement.setAttribute('data-wide-mode', '');
                  }
                } catch {}
              })();
            `,
          }}
        />
      </head>
      <body
        className="antialiased min-h-screen bg-background text-foreground"
      >
        <div id="app-boot-loader" className="fixed inset-0 z-[99999] flex items-center justify-center bg-background" suppressHydrationWarning>
          <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <TooltipProvider>
          <ServiceWorkerManager />
          <EmbedBridge />
          <ErrorBoundary>
            <main>
              {children}
            </main>
          </ErrorBoundary>
        </TooltipProvider>
      </body>
    </html>
  );
}
