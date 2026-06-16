import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Proxy",
  description: "Local privacy proxy for upstream LLM services",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
