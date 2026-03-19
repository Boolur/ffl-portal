import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ImpersonationProvider } from "@/lib/impersonation";
import { ThemePreference, UserRole } from "@prisma/client";
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
  const sessionUserId = session?.user?.id as string | undefined;
  const themePreference = sessionUserId
    ? (
        await prisma.user.findUnique({
          where: { id: sessionUserId },
          select: { themePreference: true },
        })
      )?.themePreference || ThemePreference.LIGHT
    : ThemePreference.LIGHT;
  const initialTheme = themePreference === ThemePreference.DARK ? "dark" : "light";
  const initialRole =
    (session?.user?.activeRole as UserRole | undefined) ||
    (session?.user?.role as UserRole | undefined) ||
    UserRole.LOAN_OFFICER;
  const availableRoles =
    ((session?.user?.roles as UserRole[] | undefined) || []).length > 0
      ? (session?.user?.roles as UserRole[])
      : [initialRole];

  return (
    <html lang="en" data-theme={initialTheme} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <ImpersonationProvider initialRole={initialRole} availableRoles={availableRoles}>
            {children}
          </ImpersonationProvider>
        </Providers>
      </body>
    </html>
  );
}
