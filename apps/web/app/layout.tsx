import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { NavBar } from "@/components/nav-bar";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "BETIA — combinadas con inteligencia",
  description:
    "BETIA busca valor en cuotas en vivo y arma combinadas con un agente de IA. Recomendaciones informativas: vos apostás donde quieras.",
};

// Clerk stays optional at runtime: without a publishable key the public pages
// still render instead of the middleware 500ing every route.
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: LayoutProps<"/">) {
  const shell = (
    <body
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} flex min-h-full flex-col`}
    >
      <NavBar clerkEnabled={clerkEnabled} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </body>
  );

  return (
    <html lang="es" className="h-full antialiased">
      {clerkEnabled ? <ClerkProvider>{shell}</ClerkProvider> : shell}
    </html>
  );
}
