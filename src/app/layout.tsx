import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Proxy",
  description: "Local privacy proxy for ccload",
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
