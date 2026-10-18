import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ProfileProvider } from "@/context/ProfileContext";
import AuthModal from "@/components/AuthModal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StreamPulse - Watch 30,000+ Free Live TV Channels",
  description: "Stream live sports, breaking news, movies, and entertainment worldwide. 100% legal, free IPTV powered by Next.js and HLS.js.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full dark antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#07080c] text-slate-100 selection:bg-cyan-500 selection:text-black">
        <ProfileProvider>
          {children}
          <AuthModal />
        </ProfileProvider>
      </body>
    </html>
  );
}
