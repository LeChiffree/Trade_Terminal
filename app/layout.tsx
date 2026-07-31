import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost ?? requestHeaders.get("host") ?? "localhost";
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(requestHost) ? requestHost : "localhost";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host.startsWith("localhost")
      ? "http"
      : "https";
  const origin = new URL(`${protocol}://${host}`);
  const imageUrl = new URL("/og.png", origin).toString();
  const description = "Canlı çoklu zaman dilimli teknik analiz, quant skoru, Gemini second approver ve akıllı alarm terminali.";

  return {
    metadataBase: origin,
    title: "QuantScope Trade Terminal",
    description,
    applicationName: "QuantScope",
    robots: { index: false, follow: false },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "tr_TR",
      siteName: "QuantScope",
      title: "QuantScope Trade Terminal",
      description,
      url: origin,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "QuantScope Trade Terminal" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "QuantScope Trade Terminal",
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
