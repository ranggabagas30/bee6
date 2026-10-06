// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  UploadStatusLine,
  deriveLostLine,
  deriveRetainedUploadView,
  deriveUploadView,
  uploadLines,
  type UploadSource,
} from "@/app/capture/UploadStatusLine";

afterEach(() => {
  cleanup();
});

function src(overrides: Partial<UploadSource>): UploadSource {
  return { state: "listening", queuedCount: 0, lastUploadHttpStatus: null, ...overrides };
}

describe("deriveUploadView", () => {
  it("shows nothing when no session is running", () => {
    expect(deriveUploadView(null)).toBeNull();
    expect(deriveUploadView(undefined)).toBeNull();
  });

  it("shows uploading while segments are queued and the connection is OK", () => {
    expect(deriveUploadView(src({ queuedCount: 2, lastUploadHttpStatus: 200 }))).toEqual({
      phase: "uploading",
    });
    expect(deriveUploadView(src({ queuedCount: 1, lastUploadHttpStatus: null }))).toEqual({
      phase: "uploading",
    });
  });

  it("shows retrying when the engine reports uploads failing (offline)", () => {
    expect(
      deriveUploadView(src({ state: "offline", queuedCount: 1, lastUploadHttpStatus: null })),
    ).toEqual({ phase: "retrying" });
    expect(
      deriveUploadView(src({ state: "offline", queuedCount: 3, lastUploadHttpStatus: 503 })),
    ).toEqual({ phase: "retrying" });
  });

  it("shows succeeded after the queue empties on a 2xx upload", () => {
    expect(deriveUploadView(src({ queuedCount: 0, lastUploadHttpStatus: 200 }))).toEqual({
      phase: "succeeded",
    });
    expect(deriveUploadView(src({ queuedCount: 0, lastUploadHttpStatus: 201 }))).toEqual({
      phase: "succeeded",
    });
  });

  it("shows nothing before any upload has run, or after a non-2xx with an empty queue", () => {
    expect(deriveUploadView(src({ queuedCount: 0, lastUploadHttpStatus: null }))).toBeNull();
    expect(deriveUploadView(src({ queuedCount: 0, lastUploadHttpStatus: 400 }))).toBeNull();
  });

  it("shows nothing during a mic problem, because the engine hides its connection flag there", () => {
    expect(
      deriveUploadView(src({ state: "mic_error", queuedCount: 2, lastUploadHttpStatus: 200 })),
    ).toBeNull();
  });
});

describe("uploadLines exact strings (both languages)", () => {
  it("uploading", () => {
    expect(uploadLines({ phase: "uploading" })).toEqual({
      id: "Mengunggah",
      en: "Uploading",
    });
  });

  it("retrying, with the count when it is known", () => {
    expect(uploadLines({ phase: "retrying", failedAttempts: 1 })).toEqual({
      id: "Belum terkirim · mencoba lagi (1x)",
      en: "Not sent yet · retrying (1x)",
    });
  });

  it("retrying, without a count when the engine does not expose one", () => {
    expect(uploadLines({ phase: "retrying" })).toEqual({
      id: "Belum terkirim · mencoba lagi",
      en: "Not sent yet · retrying",
    });
  });

  it("succeeded", () => {
    expect(uploadLines({ phase: "succeeded" })).toEqual({
      id: "Unggah berhasil",
      en: "Upload succeeded",
    });
  });
});

describe("deriveRetainedUploadView (UX-03 §5.7 stop rule)", () => {
  it("keeps the retry row after a stop, while the last upload failed", () => {
    expect(deriveRetainedUploadView(src({ state: "offline", queuedCount: 1, headFailedAttempts: 2 }))).toEqual({
      phase: "retrying",
      failedAttempts: 2,
    });
  });

  it("does not carry an uploading row past a stop (nothing is in flight after stop)", () => {
    expect(deriveRetainedUploadView(src({ state: "listening", queuedCount: 2, lastUploadHttpStatus: 200 }))).toBeNull();
  });

  it("does not carry the succeeded row past a stop", () => {
    expect(deriveRetainedUploadView(src({ state: "listening", queuedCount: 0, lastUploadHttpStatus: 200 }))).toBeNull();
  });

  it("returns null for no status", () => {
    expect(deriveRetainedUploadView(null)).toBeNull();
  });
});

describe("UploadStatusLine approved retry copy (UX-03 §6 C-u-retry)", () => {
  it("renders Belum terkirim · mencoba lagi / Not sent yet · retrying in both languages", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    const node = container.querySelector('[data-testid="upload-status"]');
    const lines = Array.from(node?.querySelectorAll("p") ?? []).map((p) => p.textContent);
    expect(lines).toEqual(["Belum terkirim · mencoba lagi", "Not sent yet · retrying"]);
  });
});

describe("UploadStatusLine rendering", () => {
  it("renders the block (empty) for a null view, so it is in every mode (UX-03 §5.7)", () => {
    const { container } = render(<UploadStatusLine view={null} />);
    const node = container.querySelector('[data-testid="upload-status"]');
    expect(node).not.toBeNull();
    expect(node?.querySelectorAll("p")).toHaveLength(0);
  });

  it.each([
    [{ phase: "uploading" as const }, ["Mengunggah", "Uploading"]],
    [{ phase: "retrying" as const, failedAttempts: 1 }, ["Belum terkirim · mencoba lagi (1x)", "Not sent yet · retrying (1x)"]],
    [{ phase: "retrying" as const }, ["Belum terkirim · mencoba lagi", "Not sent yet · retrying"]],
    [{ phase: "succeeded" as const }, ["Unggah berhasil", "Upload succeeded"]],
  ])("renders %j with both the Indonesian and English line", (view, [id, en]) => {
    const { container } = render(<UploadStatusLine view={view} />);
    const node = container.querySelector('[data-testid="upload-status"]');
    expect(node?.textContent).toBe(`${id}${en}`);
    const lines = Array.from(node?.querySelectorAll("p") ?? []).map((p) => p.textContent);
    expect(lines).toEqual([id, en]);
  });
});

describe("UploadStatusLine connectivity detail (moved from the banner)", () => {
  function lines(container: HTMLElement): string[] {
    const node = container.querySelector('[data-testid="upload-status"]');
    return Array.from(node?.querySelectorAll("p") ?? []).map((p) => p.textContent ?? "");
  }

  it("shows No internet / Tidak ada internet on a retrying line when the browser reports offline", () => {
    const { container } = render(
      <UploadStatusLine view={{ phase: "retrying" }} online={false} />,
    );
    expect(lines(container)).toEqual([
      "Belum terkirim · mencoba lagi",
      "Not sent yet · retrying",
      "Tidak ada internet",
      "No internet",
    ]);
  });

  it("shows Server busy / Server sibuk on a retrying line when the browser reports online", () => {
    const { container } = render(
      <UploadStatusLine view={{ phase: "retrying" }} online={true} />,
    );
    expect(lines(container)).toEqual([
      "Belum terkirim · mencoba lagi",
      "Not sent yet · retrying",
      "Server sibuk",
      "Server busy",
    ]);
  });

  it("adds no connectivity detail when the online hint is not supplied", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    expect(lines(container)).toEqual(["Belum terkirim · mencoba lagi", "Not sent yet · retrying"]);
  });

  it("never adds connectivity detail to non-retrying lines", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "uploading" }} online={false} />);
    expect(lines(container)).toEqual(["Mengunggah", "Uploading"]);
  });
});

describe("lost line (UX-03 §5.7 row L)", () => {
  function lines(container: HTMLElement): string[] {
    const node = container.querySelector('[data-testid="upload-status"]');
    return Array.from(node?.querySelectorAll("p") ?? []).map((p) => p.textContent ?? "");
  }

  it("deriveLostLine is true only while a dropped segment is not yet cleared by a 2xx", () => {
    expect(deriveLostLine(src({ lostSinceSuccess: true }))).toBe(true);
    expect(deriveLostLine(src({ lostSinceSuccess: false }))).toBe(false);
    expect(deriveLostLine(src({}))).toBe(false);
    expect(deriveLostLine(null)).toBe(false);
  });

  it("renders the lost line first, with the warning mark, when a segment was dropped", () => {
    const { container } = render(
      <UploadStatusLine view={{ phase: "uploading" }} lost />,
    );
    const [first, second] = lines(container);
    expect(first).toContain("Sebagian suara tidak tercatat");
    expect(second).toContain("Some speech was not captured");
    expect(lines(container)).toEqual([
      expect.stringContaining("Sebagian suara tidak tercatat"),
      expect.stringContaining("Some speech was not captured"),
      "Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan.",
      "That note is now incomplete. It cannot be recovered.",
      "Mengunggah",
      "Uploading",
    ]);
    expect(container.querySelector('[data-testid="upload-status"]')?.textContent).toContain("▲");
  });

  it("shows the lost line alone (no succeeded row) while it is up", () => {
    const { container } = render(
      <UploadStatusLine view={{ phase: "succeeded" }} lost />,
    );
    expect(lines(container)).toEqual([
      expect.stringContaining("Sebagian suara tidak tercatat"),
      expect.stringContaining("Some speech was not captured"),
      "Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan.",
      "That note is now incomplete. It cannot be recovered.",
    ]);
  });

  it("shows the lost line even with no upload view", () => {
    const { container } = render(<UploadStatusLine view={null} lost />);
    expect(lines(container)).toHaveLength(4);
  });

  it("renders no rows when there is no view and nothing lost", () => {
    const { container } = render(<UploadStatusLine view={null} lost={false} />);
    expect(container.querySelector('[data-testid="upload-status"]')?.querySelectorAll("p")).toHaveLength(0);
  });
});

describe("retry count from the engine (UX-03 §5.7 row 1)", () => {
  it("deriveUploadView passes the head's failed attempt count to the retrying view", () => {
    expect(
      deriveUploadView(
        src({ state: "offline", queuedCount: 1, lastUploadHttpStatus: null, headFailedAttempts: 2 }),
      ),
    ).toEqual({ phase: "retrying", failedAttempts: 2 });
  });

  it("after two failures the retry line shows (2x)", () => {
    const view = deriveUploadView(
      src({ state: "offline", queuedCount: 1, lastUploadHttpStatus: 503, headFailedAttempts: 2 }),
    );
    const { container } = render(<UploadStatusLine view={view} />);
    const node = container.querySelector('[data-testid="upload-status"]');
    expect(node?.textContent).toBe(
      "Belum terkirim · mencoba lagi (2x)Not sent yet · retrying (2x)",
    );
  });
});

describe("lost help line (UX-03 copy key C-u-lost-help, section 5.7 row L)", () => {
  const HELP_ID = "Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan.";
  const HELP_EN = "That note is now incomplete. It cannot be recovered.";

  function lines(container: HTMLElement): string[] {
    const node = container.querySelector('[data-testid="upload-status"]');
    return Array.from(node?.querySelectorAll("p") ?? []).map((p) => p.textContent ?? "");
  }

  it("renders the helper under the lost value, in both languages", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "uploading" }} lost />);
    expect(lines(container)).toEqual([
      expect.stringContaining("Sebagian suara tidak tercatat"),
      expect.stringContaining("Some speech was not captured"),
      HELP_ID,
      HELP_EN,
      "Mengunggah",
      "Uploading",
    ]);
  });

  it("renders the helper when there is no upload view but a loss is open", () => {
    const { container } = render(<UploadStatusLine view={null} lost />);
    expect(lines(container)).toEqual([
      expect.stringContaining("Sebagian suara tidak tercatat"),
      expect.stringContaining("Some speech was not captured"),
      HELP_ID,
      HELP_EN,
    ]);
  });

  it("is absent when no loss is open", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "uploading" }} lost={false} />);
    expect(lines(container)).toEqual(["Mengunggah", "Uploading"]);
    expect(container.textContent).not.toContain(HELP_ID);
    expect(container.textContent).not.toContain(HELP_EN);
  });

  it("clears on the next success, when the loss is cleared by a 2xx upload", () => {
    const { container, rerender } = render(
      <UploadStatusLine view={{ phase: "succeeded" }} lost />,
    );
    expect(container.textContent).toContain(HELP_ID);
    rerender(<UploadStatusLine view={{ phase: "succeeded" }} lost={false} />);
    expect(lines(container)).toEqual(["Unggah berhasil", "Upload succeeded"]);
    expect(container.textContent).not.toContain(HELP_ID);
    expect(container.textContent).not.toContain(HELP_EN);
  });
});
