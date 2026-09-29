import { Geist, Geist_Mono } from "next/font/google";
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
