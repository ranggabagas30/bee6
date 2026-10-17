// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { axeViolations } from "@/lib/testing/axe";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { PairForm } from "@/app/pair/PairForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const PAIR_OK = { data: { device_token: "tok-1", device_id: "dev-1", outlet_id: "outlet-7" } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => void vi.stubGlobal("localStorage", createMemoryStorage()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(props: Parameters<typeof PairForm>[0] = {}, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <PairForm {...props} />
    </LangProvider>,
  );
}
const input = () => screen.getByLabelText("6-digit code") as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement;
function submit(code: string) {
  fireEvent.change(input(), { target: { value: code } });
  fireEvent.click(submitButton());
}

describe("PairForm", () => {
  it("posts the code, stores the device keys and hands the outlet and device auth to onPaired", async () => {
    const fetchMock = vi.fn(async () => json(PAIR_OK));
    vi.stubGlobal("fetch", fetchMock);
    const onPaired = vi.fn();
    renderForm({ onPaired });
    submit("123456");
    await waitFor(() => expect(onPaired).toHaveBeenCalledTimes(1));
    expect(onPaired).toHaveBeenCalledWith({ outletId: "outlet-7", auth: { deviceToken: "tok-1", deviceId: "dev-1" } });
    expect(window.localStorage.getItem("bee6.device_token")).toBe("tok-1");
    expect(window.localStorage.getItem("bee6.device_id")).toBe("dev-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/devices/pair", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }));
  });

  it("shows the mapped error line and does not call onPaired on a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401)));
    const onPaired = vi.fn();
    renderForm({ onPaired });
    submit("123456");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Code not recognized"));
    // board P2-02: bold lead, then the way out; the lead names "expired" and the rest names the supervisor
    expect(screen.getByRole("alert").textContent).toBe("Code not recognized, expired or already used.Ask your supervisor for a new code.");
    expect(screen.getByRole("alert").classList.contains("b6-alert--red")).toBe(true);
    expect(onPaired).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-describedby")).toContain(screen.getByRole("alert").id);
    expect(input().value).toBe("123456"); // digits kept
  });

  it("starts with an initial code when given one", () => {
    renderForm({ initialCode: "000000" });
    expect(input().value).toBe("000000");
  });

  describe("Set up this device states (R-19 PR-6 §8.1)", () => {
    it("empty: ONE numeric one-time-code input (the page-2 code field), the button really disabled with the 'all 6 digits' hint", () => {
      renderForm();
      const field = input();
      expect(screen.getAllByRole("textbox")).toHaveLength(1); // the six-box overlay is gone: one field only
      expect(field.getAttribute("inputmode")).toBe("numeric");
      expect(field.getAttribute("autocomplete")).toBe("one-time-code");
      expect(field.getAttribute("pattern")).toBe("[0-9]*");
      expect(field.maxLength).toBe(6);
      expect(field.getAttribute("placeholder")).toBe("· · · · · ·");
      expect(field.classList.contains("b6-codefield")).toBe(true);
      expect(screen.queryAllByTestId("pair-box")).toHaveLength(0);
      expect(submitButton().disabled).toBe(true);
      expect(screen.getByText("Enter all 6 digits to set up.")).toBeTruthy();
    });

    it("filled: typed digits show in the field, non-digits are dropped, the hint goes away and the button enables", () => {
      renderForm();
      fireEvent.change(input(), { target: { value: "12a3" } });
      expect(input().value).toBe("123"); // non-digits dropped
      expect(submitButton().disabled).toBe(true);
      fireEvent.change(input(), { target: { value: "123456" } });
      expect(input().value).toBe("123456");
      expect(submitButton().disabled).toBe(false);
      expect(screen.queryByText("Enter all 6 digits to set up.")).toBeNull();
    });

    it("paste: six digits fill the field, spaces and dashes are stripped, extra digits are cut", () => {
      renderForm();
      fireEvent.paste(input(), { clipboardData: { getData: () => "123 456" } });
      expect(input().value).toBe("123456");
      expect(submitButton().disabled).toBe(false);
      fireEvent.paste(input(), { clipboardData: { getData: () => "98-76-54-32" } });
      expect(input().value).toBe("987654");
      fireEvent.paste(input(), { clipboardData: { getData: () => "ab" } });
      expect(input().value).toBe("");
      expect(submitButton().disabled).toBe(true);
    });

    it("paste while submitting is ignored (the field is read-only in flight)", () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
      renderForm();
      submit("123456");
      fireEvent.paste(input(), { clipboardData: { getData: () => "654321" } });
      expect(input().value).toBe("123456");
    });

    it("the label is tied to the field and the field is described by the hint until all six digits are in", () => {
      renderForm();
      expect(input().getAttribute("id")).toBe("pairing-code");
      const hint = screen.getByText("Enter all 6 digits to set up.");
      expect(input().getAttribute("aria-describedby")).toContain(hint.id);
      fireEvent.change(input(), { target: { value: "123456" } });
      expect(input().getAttribute("aria-describedby")).toBeNull();
    });

    it("submitting: the form is aria-busy and the button says Setting up…", async () => {
      let release!: (r: Response) => void;
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (release = r))));
      renderForm();
      submit("123456");
      expect(input().closest("form")!.getAttribute("aria-busy")).toBe("true");
      expect((screen.getByRole("button", { name: "Setting up…" }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => release(json(PAIR_OK)));
      expect(input().closest("form")!.getAttribute("aria-busy")).toBe("false");
    });

    it("network: the connection line, digits kept, button enabled again", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
      renderForm();
      submit("123456");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No connection."));
      expect(screen.getByRole("alert").textContent).toBe("No connection.Try again when the signal is steady.");
      expect(screen.getByRole("alert").classList.contains("b6-alert--amber")).toBe(true); // board: amber, not red
      expect(input().value).toBe("123456");
      expect(submitButton().disabled).toBe(false);
    });

    it("is in Bahasa when the language says so", () => {
      renderForm({}, "id");
      expect(screen.getByLabelText("Kode 6 digit")).toBeTruthy();
      expect(screen.getByText("Masukkan 6 digit untuk menyiapkan.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Siapkan" })).toBeTruthy();
    });

    it("axe finds no violation, empty and refused", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401)));
      const { container } = renderForm();
      expect(await axeViolations(container)).toEqual([]);
      submit("123456");
      await screen.findByRole("alert");
      expect(await axeViolations(container)).toEqual([]);
    });
  });

  describe("demoIntercept (R-18 P1)", () => {
    it("is asked first with the typed code; when it handles the code the pair route is never called", async () => {
      const fetchMock = vi.fn(async () => json(PAIR_OK));
      vi.stubGlobal("fetch", fetchMock);
      const demoIntercept = vi.fn(async () => true);
      const onPaired = vi.fn();
      renderForm({ demoIntercept, onPaired });
      submit("000000");
      await waitFor(() => expect(demoIntercept).toHaveBeenCalledWith("000000"));
      await act(async () => {});
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onPaired).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("bee6.device_token")).toBeNull();
    });

    it("falls through to the real pair route when it does not handle the code", async () => {
      const fetchMock = vi.fn(async () => json(PAIR_OK));
      vi.stubGlobal("fetch", fetchMock);
      const demoIntercept = vi.fn(async () => false);
      const onPaired = vi.fn();
      renderForm({ demoIntercept, onPaired });
      submit("123456");
      await waitFor(() => expect(onPaired).toHaveBeenCalled());
      expect(demoIntercept).toHaveBeenCalledWith("123456");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("an intercept that throws falls through to the real path rather than wedging the form", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401)));
      renderForm({ demoIntercept: async () => Promise.reject(new Error("boom")) });
      submit("123456");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Code not recognized"));
      expect(submitButton().disabled).toBe(false);
    });

    it("keeps the button busy while the intercept runs, and ignores a second submit", async () => {
      vi.stubGlobal("fetch", vi.fn());
      let release!: (v: boolean) => void;
      const demoIntercept = vi.fn(() => new Promise<boolean>((r) => (release = r)));
      renderForm({ demoIntercept });
      submit("000000");
      const form = input().closest("form")!;
      expect((screen.getByRole("button", { name: "Setting up…" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(form);
      expect(demoIntercept).toHaveBeenCalledTimes(1);
      await act(async () => release(true));
      expect(submitButton().disabled).toBe(false);
    });
  });

  describe("typing the code (R-25 fixes-2 §1, QA M-002)", () => {
    /** One digit typed the way a browser does: keydown, input with the new value, keyup. */
    function typeDigit(char: string, next: string) {
      fireEvent.keyDown(input(), { key: char });
      fireEvent.input(input(), { target: { value: next } });
      fireEvent.keyUp(input(), { key: char });
    }
    function beforeInput(inputType: string, data: string | null = null) {
      fireEvent(input(), new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
    }

    it("types six digits one by one: each digit lands, focus stays, Set up enables on the sixth", () => {
      renderForm();
      input().focus();
      let next = "";
      for (const d of "123456") {
        next += d;
        typeDigit(d, next);
        expect(input().value).toBe(next);
        expect(document.activeElement).toBe(input());
        expect(submitButton().disabled).toBe(next.length < 6);
      }
      expect(submitButton().disabled).toBe(false);
    });

    it("a seventh digit and a letter are dropped while typing", () => {
      renderForm();
      input().focus();
      fireEvent.input(input(), { target: { value: "1234567" } });
      expect(input().value).toBe("123456");
      fireEvent.input(input(), { target: { value: "12345a" } });
      expect(input().value).toBe("12345");
    });

    it("M-002: a full field selects all on focus, so the next digit replaces it", () => {
      renderForm({ initialCode: "000000" });
      fireEvent.focus(input());
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe(6);
      fireEvent.input(input(), { target: { value: "7" } });
      expect(input().value).toBe("7");
      expect(submitButton().disabled).toBe(true);
      expect(screen.getByText("Enter all 6 digits to set up.")).toBeTruthy();
    });

    it("M-002: focusing a field that is not full does not select anything", () => {
      renderForm({ initialCode: "123" });
      input().setSelectionRange(3, 3);
      fireEvent.focus(input());
      expect(input().selectionStart).toBe(3);
      expect(input().selectionEnd).toBe(3);
    });

    it("M-002: a digit typed into a full, unselected field replaces it", () => {
      renderForm({ initialCode: "000000" });
      input().focus();
      input().setSelectionRange(3, 3);
      beforeInput("insertText", "7");
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe(6);
      fireEvent.input(input(), { target: { value: "7" } });
      expect(input().value).toBe("7");
    });

    it("M-002: Backspace on a full field is untouched (no select-all)", () => {
      renderForm({ initialCode: "000000" });
      input().focus();
      input().setSelectionRange(3, 3);
      beforeInput("deleteContentBackward");
      expect(input().selectionStart).toBe(3);
      expect(input().selectionEnd).toBe(3);
      fireEvent.input(input(), { target: { value: "00000" } });
      expect(input().value).toBe("00000");
    });

    it("M-002: typing into a field that is not full does not select it", () => {
      renderForm({ initialCode: "123" });
      input().focus();
      input().setSelectionRange(3, 3);
      beforeInput("insertText", "4");
      expect(input().selectionStart).toBe(3);
      expect(input().selectionEnd).toBe(3);
    });

    it("adopts digits the browser already held when the component took the field over (hydration, §1.2b)", async () => {
      const tree = (
        <LangProvider initial="en">
          <PairForm />
        </LangProvider>
      );
      const container = document.createElement("div");
      document.body.appendChild(container);
      onTestFinished(() => container.remove()); // even when an assertion below fails
      container.innerHTML = renderToString(tree);
      const dom = container.querySelector<HTMLInputElement>("#pairing-code")!;
      dom.value = "123456"; // typed into the server-rendered field before its chunk hydrated
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, tree);
      });
      const hydrated = container.querySelector<HTMLInputElement>("#pairing-code")!;
      expect(hydrated.value).toBe("123456");
      expect((container.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
      await act(async () => root.unmount());
    });

    it("does not override an initialCode with a stale DOM value (§1.2b)", () => {
      renderForm({ initialCode: "000000" });
      expect(input().value).toBe("000000");
    });

    it("a full field: paste still replaces (own handler)", () => {
      renderForm({ initialCode: "000000" });
      fireEvent.paste(input(), { clipboardData: { getData: () => "123 456" } });
      expect(input().value).toBe("123456");
    });
  });
});
