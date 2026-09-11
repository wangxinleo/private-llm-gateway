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

const themeInit = `(function(){try{var t=localStorage.getItem("pp_theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
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
