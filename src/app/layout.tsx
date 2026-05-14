import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthBootstrap from "@/components/AuthBootstrap";
import ThemeApplier from "@/components/ThemeApplier";
import RUMInjector from "@/components/RUMInjector";
import { LanguageProvider } from "@/lib/i18n/provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://forgottenland.com"),
  title: "被遗忘之地 · 大殿",
  description:
    "ForgottenLand 玩家共济会 — 语音、直播、组队、交易行、公会、好友一站式平台。",
  applicationName: "ForgottenLand",
  authors: [{ name: "ForgottenLand Team" }],
  keywords: [
    "ForgottenLand",
    "被遗忘之地",
    "游戏公会",
    "组队",
    "交易行",
    "语音聊天",
  ],
  openGraph: {
    title: "被遗忘之地 · 大殿",
    description: "ForgottenLand 玩家共济会 — 语音、直播、组队、交易",
    url: "https://forgottenland.com",
    siteName: "ForgottenLand",
    images: [
      {
        url: "/icon-512.png",
        width: 512,
        height: 512,
        alt: "ForgottenLand Logo",
      },
    ],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "被遗忘之地 · 大殿",
    description: "ForgottenLand 玩家共济会 — 语音、直播、组队、交易",
    images: ["/icon-512.png"],
  },
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={`${inter.variable} font-sans bg-[var(--bg-darkest)] text-white antialiased`}>
        <LanguageProvider>
          <RUMInjector />
          <AuthBootstrap />
          <ThemeApplier />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
