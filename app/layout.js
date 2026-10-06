import { Geist, Geist_Mono } from "next/font/google";
// Inter and Orbitron are served from this site (not loaded from Google), so
// pages make no requests to other sites for fonts.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/orbitron/400.css";
import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  metadataBase: new URL("https://www.track3d.co.uk"),
  title: "TRACK3D — Awareness. Strategy. Action. Results.",
  description: "Build better routines, follow personalised fitness and nutrition plans, and track your progress with TRACK3D.",
  applicationName: "TRACK3D",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.ico" }, { url: "/icon.svg", type: "image/svg+xml" }], apple: "/icon.svg" },
  openGraph: { title: "TRACK3D", description: "Your self-improvement system for routines, fitness, nutrition and measurable progress.", url: "/", siteName: "TRACK3D", type: "website" },
};

export const viewport = { themeColor: "#080c10", colorScheme: "dark" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
