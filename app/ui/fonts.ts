import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";

/*
 * Page-2 fonts (R-19 PR-0b), self-hosted by next/font at build time.
 *
 * Each font only declares a CSS variable (--font-b6-sans / --font-b6-mono) on <html>; app/globals.css reads it through
 * --b6-font-sans / --b6-font-mono, and only .b6-* classes use those. No existing page sets a font from them, so
 * nothing restyles. preload is off so pages that do not use the fonts download nothing extra.
 */
const sans = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-b6-sans",
  display: "swap",
  preload: false,
}); // variable font, weights 200-800 (the boards use 300-800)

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-b6-mono",
  display: "swap",
  preload: false,
});

export const fontVariableClassNames = `${sans.variable} ${mono.variable}`;
