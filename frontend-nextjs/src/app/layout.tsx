import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jubilant Ingrevia - AI-powered Information Assistant",
  description: "Operational Readiness Platform for Jubilant Ingrevia",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-full`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
