import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/** Both faces need latin AND latin-ext: `ő` U+0151 and `ű` U+0171 are in latin-ext only
 *  while `ö` and `á` are in latin, so neither subset alone renders a Hungarian station
 *  list, and a fallback font mid-word takes the measured line boxes with it (SPEC 2). */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "vonatinfo",
  description: "Live train map",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
