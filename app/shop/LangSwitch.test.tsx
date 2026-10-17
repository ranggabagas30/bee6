// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider, useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { LangSwitch } from "@/app/shop/LangSwitch";
import type { Lang } from "@/lib/i18n/lang";

function Probe() {
  const { lang } = useLang();
  return <p data-testid="probe">{t(lang, "C-h-listening")}</p>;
}

const ID_NAME = /^ID\b.*Bahasa Indonesia/;
const EN_NAME = /^EN\b.*English/;

function renderSwitch(initial: Lang) {
  return render(
    <LangProvider initial={initial}>
      <LangSwitch />
      <Probe />
    </LangProvider>,
  );
}

beforeEach(() => {
  document.cookie = "bee6_lang=; Path=/; Max-Age=0";
  document.documentElement.lang = "en";
});

afterEach(() => cleanup());

describe("LangSwitch", () => {
  it("names the group in the current language", () => {
    renderSwitch("en");
    expect(screen.getByRole("group", { name: "Choose language" })).toBeTruthy();
    cleanup();
    renderSwitch("id");
    expect(screen.getByRole("group", { name: "Pilih bahasa" })).toBeTruthy();
  });

  it("shows the codes ID and EN as the visible text in both modes", () => {
    renderSwitch("id");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.childNodes[0]?.textContent)).toEqual(["ID", "EN"]);
  });

  it("starts each accessible name with the visible code and ends it with the untranslated endonym", () => {
    renderSwitch("id");
    expect(screen.getByRole("button", { name: ID_NAME })).toBeTruthy();
    expect(screen.getByRole("button", { name: EN_NAME })).toBeTruthy();
    cleanup();
    renderSwitch("en");
    expect(screen.getByRole("button", { name: ID_NAME })).toBeTruthy();
    expect(screen.getByRole("button", { name: EN_NAME })).toBeTruthy();
  });

  it("marks each endonym span with its own language", () => {
    renderSwitch("en");
    const idSpan = screen.getByRole("button", { name: ID_NAME }).querySelector("span");
    const enSpan = screen.getByRole("button", { name: EN_NAME }).querySelector("span");
    expect(idSpan?.getAttribute("lang")).toBe("id");
    expect(idSpan?.textContent).toBe("Bahasa Indonesia");
    expect(enSpan?.getAttribute("lang")).toBe("en");
    expect(enSpan?.textContent).toBe("English");
  });

  it("marks only the current language as pressed", () => {
    renderSwitch("en");
    expect(screen.getByRole("button", { name: EN_NAME }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: ID_NAME }).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses native buttons in tab order, styled as the page-2 segmented control", () => {
    renderSwitch("en");
    const group = screen.getByRole("group", { name: "Choose language" });
    expect(group.classList.contains("b6-seg")).toBe(true);
    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      expect(button.classList.contains("b6-seg__item")).toBe(true);
      expect(button.hasAttribute("style")).toBe(false); // the 38 px item size lives in the shared class, not inline
    }
  });

  it("switches copy, cookie and html lang on a tap, and announces in the new language", () => {
    renderSwitch("en");
    expect(screen.getByTestId("probe").textContent).toBe("Listening");
    fireEvent.click(screen.getByRole("button", { name: ID_NAME }));
    expect(screen.getByTestId("probe").textContent).toBe("Mendengarkan");
    expect(screen.getByRole("group", { name: "Pilih bahasa" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("id");
    expect(document.cookie).toContain("bee6_lang=id");
    expect(screen.getByRole("status").textContent).toBe("Bahasa Indonesia dipilih.");
  });

  it("does nothing when the pressed option is tapped", () => {
    renderSwitch("en");
    fireEvent.click(screen.getByRole("button", { name: EN_NAME }));
    expect(document.cookie).not.toContain("bee6_lang=");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("keeps the same button element and focus after a switch", () => {
    renderSwitch("en");
    const target = screen.getByRole("button", { name: ID_NAME });
    target.focus();
    act(() => {
      fireEvent.click(target);
    });
    const after = screen.getByRole("button", { name: ID_NAME });
    expect(after).toBe(target);
    expect(document.activeElement).toBe(target);
  });
});
