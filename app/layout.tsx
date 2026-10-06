import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LangProvider } from "@/lib/i18n/context";
import { LANG_COOKIE, parseLangCookie } from "@/lib/i18n/lang";

export const metadata: Metadata = {
  title: "bee6 — SOP Improvement Agent",
  description:
    "Listens to a small F&B shop's day, turns speech into work notes, and proposes SOP changes for supervisor and owner approval.",
};

// Async so the language cookie is read on the server: <html lang> is right on
// the first paint. Only the validated value is used; the cookie is never logged.
export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const jar = await cookies();
  const lang = parseLangCookie(jar.get(LANG_COOKIE)?.value);
  return (
    <html lang={lang}>
      <body>
        <LangProvider initial={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
