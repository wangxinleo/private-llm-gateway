import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Privacy Proxy",
  description: "Local privacy proxy for upstream LLM services",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Privacy Proxy",
    description: "Local privacy proxy for upstream LLM services",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
