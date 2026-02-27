import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ImpersonationProvider } from "@/lib/impersonation";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Federal First Lending Portal",
  description: "Loan Workflow Management System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id;
  const dbUser = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { role: true },
      })
    : null;
  const initialRole =
    (dbUser?.role as UserRole | undefined) ||
    (session?.user?.role as UserRole | undefined) ||
    UserRole.LOAN_OFFICER;

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <ImpersonationProvider initialRole={initialRole}>
            {children}
          </ImpersonationProvider>
        </Providers>
      </body>
    </html>
  );
}
