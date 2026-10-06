// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import PairPage from "@/app/pair/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillCodeAndSubmit(code: string) {
  fireEvent.change(screen.getByLabelText(/6-digit code|Kode 6 digit/), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: /Set up|Pasang/ }));
}

describe("PairPage error copy", () => {
  it("maps a server error code to dictionary text and never renders the server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { code: "UNAUTHORIZED", message: "Invalid or expired pairing code" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Code not recognized or already used.",
      ),
    );
    expect(document.body.textContent).not.toContain("Invalid or expired pairing code");
  });

  it("shows the Bahasa text for a network failure when the language is id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    render(
      <LangProvider initial="id">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Tidak ada koneksi."),
    );
  });
});
