import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdMate Ad Vision",
  description: "디지털 광고 게재면 캡처 자동화 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
