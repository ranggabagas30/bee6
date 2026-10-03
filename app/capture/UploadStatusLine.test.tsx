// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  UploadStatusLine,
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
      id: "Gagal unggah, coba ulang (1x)",
      en: "Upload failed, retrying (1x)",
    });
  });

  it("retrying, without a count when the engine does not expose one", () => {
    expect(uploadLines({ phase: "retrying" })).toEqual({
      id: "Gagal unggah, coba ulang",
      en: "Upload failed, retrying",
    });
  });

  it("succeeded", () => {
    expect(uploadLines({ phase: "succeeded" })).toEqual({
      id: "Unggah berhasil",
      en: "Upload succeeded",
    });
  });
});

describe("UploadStatusLine rendering", () => {
  it("renders nothing for a null view", () => {
    const { container } = render(<UploadStatusLine view={null} />);
    expect(container.querySelector('[data-testid="upload-status"]')).toBeNull();
  });

  it.each([
    [{ phase: "uploading" as const }, ["Mengunggah", "Uploading"]],
    [{ phase: "retrying" as const, failedAttempts: 1 }, ["Gagal unggah, coba ulang (1x)", "Upload failed, retrying (1x)"]],
    [{ phase: "retrying" as const }, ["Gagal unggah, coba ulang", "Upload failed, retrying"]],
    [{ phase: "succeeded" as const }, ["Unggah berhasil", "Upload succeeded"]],
  ])("renders %j with both the Indonesian and English line", (view, [id, en]) => {
    const { container } = render(<UploadStatusLine view={view} />);
    const node = container.querySelector('[data-testid="upload-status"]');
    expect(node?.textContent).toBe(`${id}${en}`);
    const lines = Array.from(node?.querySelectorAll("p") ?? []).map((p) => p.textContent);
    expect(lines).toEqual([id, en]);
  });
});
