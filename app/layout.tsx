import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LangProvider } from "@/lib/i18n/context";
import { LANG_COOKIE, parseLangCookie } from "@/lib/i18n/lang";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { DemoBarLoader } from "@/app/demo/DemoBarLoader";
import { JudgeGuideLoader } from "@/app/demo/JudgeGuideLoader";
import { DEMO_STATE_KEY } from "@/app/demo/demo-state-key";
import { fontVariableClassNames } from "@/app/ui/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "bee6 — SOP Improvement Agent",
  description:
    "Listens to a small F&B shop's day, turns speech into work notes, and proposes SOP changes for supervisor and owner approval.",
};

// Async so the language cookie is read on the server: <html lang> is right on
// the first paint. Only the validated value is used; the cookie is never logged.
// The demo bar (R-12) and the judge guide (R-19 PR-5) are mounted only when the server has DEMO_MODE
// exactly "true" (read per request, never baked in), so the pilot never renders either. The guide comes
// after the page content: its collapsed phone handle is a fixed bottom sheet that reserves its own space.
// Runs while the page is still being parsed, before anything below it paints: marks <html> when this browser
// holds a demo state so the CSS can reserve the demo bar's room (see DemoBarLoader). Reads one key, never parses
// or logs it; storage being blocked is not an error.
const DEMO_STATE_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(DEMO_STATE_KEY)}))document.documentElement.classList.add("b6-topbar-reserved")}catch(e){}`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const jar = await cookies();
  const lang = parseLangCookie(jar.get(LANG_COOKIE)?.value);
  const demo = process.env.DEMO_MODE === "true";
  const webConfig = demo ? readFirebaseWebConfig() : null;
  return (
    <html lang={lang} className={fontVariableClassNames} suppressHydrationWarning>
      <body>
        <LangProvider initial={lang}>
          {demo ? <script dangerouslySetInnerHTML={{ __html: DEMO_STATE_SCRIPT }} /> : null}
          {demo ? <DemoBarLoader config={webConfig} /> : null}
          {children}
          {demo ? <JudgeGuideLoader config={webConfig} /> : null}
        </LangProvider>
      </body>
    </html>
  );
}
