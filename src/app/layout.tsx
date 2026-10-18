import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ProfileProvider } from "@/context/ProfileContext";
import { ThemeProvider } from "@/context/ThemeContext";
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
  description:
    "Stream live sports, breaking news, movies, and entertainment worldwide. A free, account-only live TV experience built on Next.js and HLS.js.",
};

/**
 * Applies the stored theme before first paint so users never see a flash of
 * the wrong palette. Kept inline and dependency-free on purpose.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("streampulse_theme");var d=document.documentElement;if(t==="light"){d.classList.add("light");d.classList.remove("dark");}else{d.classList.add("dark");d.classList.remove("light");}}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-app text-ink selection:bg-cyan-500 selection:text-black">
        <ThemeProvider>
          <ProfileProvider>
            {children}
            <AuthModal />
          </ProfileProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
