import { describe, it, expect } from "vitest";
import {
  toTimedLines,
  buildWindows,
  planLabelUnits,
  earliestLineStartMs,
  SegmentForWindowing,
  PipelineWindow,
} from "./windowing";

describe("windowing", () => {
  describe("earliestLineStartMs", () => {
    it("returns the minimum start_ms across a unit's lines, regardless of input order", () => {
      const unit = {
        lines: [
          { line_id: "a", seg_id: "s", text: "x", start_ms: 5000, end_ms: 6000 },
          { line_id: "b", seg_id: "s", text: "y", start_ms: 1000, end_ms: 2000 },
          { line_id: "c", seg_id: "s", text: "z", start_ms: 3000, end_ms: 4000 },
        ],
      };
      expect(earliestLineStartMs(unit)).toBe(1000);
    });

    it("returns the single line's start_ms for a one-line unit", () => {
      const unit = { lines: [{ line_id: "a", seg_id: "s", text: "x", start_ms: 42, end_ms: 100 }] };
      expect(earliestLineStartMs(unit)).toBe(42);
    });
  });

  describe("toTimedLines", () => {
    it("converts segments to absolute-ms timed lines", () => {
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [
            { text: "hello world", start: 0, end: 5 },
            { text: "goodbye", start: 10, end: 15 },
          ],
        },
      ];

      const result = toTimedLines(segments);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        line_id: "seg_001#0",
        seg_id: "seg_001",
        text: "hello world",
      });
      expect(result[1]).toMatchObject({
        line_id: "seg_001#1",
        seg_id: "seg_001",
        text: "goodbye",
      });
    });

    it("calculates absolute ms from device_start and line.start/end", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [{ text: "test", start: 5, end: 10 }],
        },
      ];

      const result = toTimedLines(segments);

      expect(result.length).toBeGreaterThan(0);
      if (result[0]) {
        expect(result[0].start_ms).toBe(startMs + 5000);
        expect(result[0].end_ms).toBe(startMs + 10000);
      }
    });

    it("sorts by (device_start, seg_id)", () => {
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_003",
          device_start: "2026-10-01T10:00:10Z",
          device_end: "2026-10-01T10:00:25Z",
          lines: [{ text: "c", start: 0, end: 5 }],
        },
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [{ text: "a", start: 0, end: 5 }],
        },
        {
          seg_id: "seg_002",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [{ text: "b", start: 0, end: 5 }],
        },
      ];

      const result = toTimedLines(segments);

      // Should be sorted by device_start first, then seg_id
      expect(result.length).toBeGreaterThanOrEqual(3);
      if (result[0] && result[1] && result[2]) {
        expect(result[0].text).toBe("a"); // seg_001
        expect(result[1].text).toBe("b"); // seg_002
        expect(result[2].text).toBe("c"); // seg_003
      }
    });

    it("dedupes by seg_id (keeping first occurrence)", () => {
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [{ text: "first", start: 0, end: 5 }],
        },
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [{ text: "duplicate", start: 0, end: 5 }],
        },
      ];

      const result = toTimedLines(segments);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe("first");
    });
  });

  describe("buildWindows", () => {
    it("creates a window with multiple lines from one segment", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [
            { text: "hello", start: 0, end: 5 },
            { text: "world", start: 5, end: 10 },
          ],
        },
      ];

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 150000,
      });

      expect(result.length).toBeGreaterThan(0);
      const w = result[0];
      if (w) {
        expect(w.window_id).toBe("w_seg_001");
        expect(w.device_id).toBe("device_001");
        expect(w.lines).toHaveLength(2);
        expect(w.status).toBe("closed");
        expect(w.close_reason).toBe("silence");
      }
    });

    it("closes window on >=90s silence gap between segments", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:10Z",
          lines: [{ text: "first", start: 0, end: 10 }],
        },
        {
          seg_id: "seg_002",
          device_start: "2026-10-01T10:02:00Z",
          device_end: "2026-10-01T10:02:10Z",
          lines: [{ text: "second", start: 0, end: 10 }],
        },
      ];

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 200000,
      });

      expect(result).toHaveLength(2);
      expect(result[0]?.lines.map((l) => l.text)).toEqual(["first"]);
      expect(result[1]?.lines.map((l) => l.text)).toEqual(["second"]);
    });

    it("caps window at 360s (6 min)", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:03:00Z",
          lines: [{ text: "part1", start: 0, end: 180 }],
        },
        {
          seg_id: "seg_002",
          device_start: "2026-10-01T10:03:00Z",
          device_end: "2026-10-01T10:05:30Z",
          lines: [{ text: "part2", start: 0, end: 150 }],
        },
        {
          seg_id: "seg_003",
          device_start: "2026-10-01T10:05:31Z",
          device_end: "2026-10-01T10:06:00Z",
          lines: [{ text: "part3", start: 0, end: 30 }],
        },
      ];

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 400000,
      });

      expect(result.length).toBeGreaterThanOrEqual(2);
      const firstWindow = result[0];
      if (firstWindow) {
        expect(firstWindow.status).toBe("closed");
        expect(firstWindow.close_reason).toBe("cap");
        const texts = firstWindow.lines.map((l) => l.text);
        expect(texts).not.toContain("part3");
      }
    });

    it("window_id is stable across shuffled input order", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const seg1: SegmentForWindowing = {
        seg_id: "seg_001",
        device_start: "2026-10-01T10:00:00Z",
        device_end: "2026-10-01T10:00:15Z",
        lines: [{ text: "a", start: 0, end: 5 }],
      };
      const seg2: SegmentForWindowing = {
        seg_id: "seg_002",
        device_start: "2026-10-01T10:00:15Z",
        device_end: "2026-10-01T10:00:30Z",
        lines: [{ text: "b", start: 0, end: 5 }],
      };

      const result1 = buildWindows({
        device_id: "device_001",
        segments: [seg1, seg2],
        as_of_ms: startMs + 100000,
      });

      const result2 = buildWindows({
        device_id: "device_001",
        segments: [seg2, seg1],
        as_of_ms: startMs + 100000,
      });

      expect(result1).toEqual(result2);
    });

    it("marks window as open when as_of_ms < last_line_end + silence threshold", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [
        {
          seg_id: "seg_001",
          device_start: "2026-10-01T10:00:00Z",
          device_end: "2026-10-01T10:00:15Z",
          lines: [{ text: "hello", start: 0, end: 5 }],
        },
      ];

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 30000,
      });

      expect(result.length).toBeGreaterThan(0);
      const w = result[0];
      if (w) {
        expect(w.status).toBe("open");
        expect(w.close_reason).toBeNull();
      }
    });

    it("replay with shuffled segment order produces identical windows", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const seg1: SegmentForWindowing = {
        seg_id: "seg_001",
        device_start: "2026-10-01T10:00:00Z",
        device_end: "2026-10-01T10:00:15Z",
        lines: [{ text: "a", start: 0, end: 5 }],
      };
      const seg2: SegmentForWindowing = {
        seg_id: "seg_002",
        device_start: "2026-10-01T10:00:15Z",
        device_end: "2026-10-01T10:00:30Z",
        lines: [{ text: "b", start: 0, end: 5 }],
      };
      const seg3: SegmentForWindowing = {
        seg_id: "seg_003",
        device_start: "2026-10-01T10:00:30Z",
        device_end: "2026-10-01T10:00:45Z",
        lines: [{ text: "c", start: 0, end: 5 }],
      };

      const result1 = buildWindows({
        device_id: "device_001",
        segments: [seg1, seg2, seg3],
        as_of_ms: startMs + 100000,
      });

      const result2 = buildWindows({
        device_id: "device_001",
        segments: [seg3, seg1, seg2],
        as_of_ms: startMs + 100000,
      });

      expect(result1.map((w) => w.window_id)).toEqual(
        result2.map((w) => w.window_id)
      );
      expect(result1).toEqual(result2);
    });

    it("a 0ms segment-boundary gap is never chosen as the cap cut when a real pause exists within the lookback window", () => {
      // 27 back-to-back 15s segments (0ms gaps throughout, total 405s) plus
      // one real 10s pause placed inside the 60s cap-lookback window (cap is
      // 360s, lookback starts at 300s — the pause sits at segment 21, whose
      // 0ms-gap start would otherwise be ~300s, pushed to 310s by the pause).
      // The cut must land at that real pause, never at one of the many 0ms
      // segment boundaries also inside the lookback window.
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [];
      const pauseBeforeSeg = 21; // 1-indexed; this segment starts 10s late
      let cursorS = 0;
      for (let i = 1; i <= 27; i += 1) {
        if (i === pauseBeforeSeg) cursorS += 10; // the one real pause
        const segStartS = cursorS;
        const segEndS = cursorS + 15;
        segments.push({
          seg_id: `seg_${String(i).padStart(3, "0")}`,
          device_start: new Date(startMs + segStartS * 1000).toISOString(),
          device_end: new Date(startMs + segEndS * 1000).toISOString(),
          lines: [{ text: `segment_${i}`, start: 0, end: 15 }],
        });
        cursorS = segEndS;
      }

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 500000,
      });

      expect(result.length).toBeGreaterThanOrEqual(2);
      const firstWindow = result[0];
      expect(firstWindow?.close_reason).toBe("cap");
      // The cut must land exactly after segment 20 (the last line before the
      // real pause) — not at any of the 0ms boundaries among segments 22-26
      // which also fall inside the lookback window.
      const lastLineText = firstWindow?.lines[firstWindow.lines.length - 1]?.text;
      expect(lastLineText).toBe("segment_20");
    });

    it("N back-to-back zero-gap segments spanning a cap boundary never duplicate a line_id across the resulting windows", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [];
      for (let i = 1; i <= 30; i += 1) {
        const segStartS = (i - 1) * 15;
        const segEndS = i * 15;
        segments.push({
          seg_id: `seg_${String(i).padStart(3, "0")}`,
          device_start: new Date(startMs + segStartS * 1000).toISOString(),
          device_end: new Date(startMs + segEndS * 1000).toISOString(),
          lines: [{ text: `segment_${i}`, start: 0, end: 15 }],
        });
      }

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 500000,
      });

      expect(result.length).toBeGreaterThan(1);

      const allLineIds = result.flatMap((w) => w.lines.map((l) => l.line_id));
      const uniqueLineIds = new Set(allLineIds);
      expect(allLineIds.length).toBe(uniqueLineIds.size);
      expect(allLineIds.length).toBe(30); // all 30 segments' single line, each exactly once
    });

    it("preserves lines after cap cut in new window (26 segments with pause)", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const segments: SegmentForWindowing[] = [];

      // Create 26 back-to-back 15s segments (total 390s)
      // Then a 20s pause at segment ~21-22 (around 315-335s total)
      for (let i = 1; i <= 26; i++) {
        const segStartS = (i - 1) * 15;
        const segEndS = i * 15;
        const isGapSegment = i === 21; // This segment will have a gap before it

        segments.push({
          seg_id: `seg_${String(i).padStart(3, "0")}`,
          device_start: new Date(startMs + (isGapSegment ? 335000 : segStartS * 1000)).toISOString(),
          device_end: new Date(startMs + (isGapSegment ? 350000 : segEndS * 1000)).toISOString(),
          lines: [
            {
              text: `segment_${i}`,
              start: 0,
              end: isGapSegment ? 15 : 15,
            },
          ],
        });
      }

      const result = buildWindows({
        device_id: "device_001",
        segments,
        as_of_ms: startMs + 400000, // Well after all segments
      });

      // Should have multiple windows (cap cut creates windows)
      expect(result.length).toBeGreaterThan(1);

      // Sum all lines across all windows — should equal 26 (no lines lost)
      const totalLines = result.reduce((sum, w) => sum + w.lines.length, 0);
      expect(totalLines).toBe(26);

      // Verify no window exceeds cap (360s)
      for (const w of result) {
        const duration = w.end_ms - w.start_ms;
        expect(duration).toBeLessThanOrEqual(360000);
      }
    });
  });

  describe("planLabelUnits", () => {
    it("groups closed windows with text into label units", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const windows: PipelineWindow[] = [
        {
          window_id: "w_seg_001",
          device_id: "device_001",
          start_ms: startMs,
          end_ms: startMs + 10000,
          lines: [
            {
              line_id: "seg_001#0",
              seg_id: "seg_001",
              text: "hello",
              start_ms: startMs,
              end_ms: startMs + 5000,
            },
          ],
          content_ms: 5000,
          has_text: true,
          status: "closed",
          close_reason: "silence",
        },
        {
          window_id: "w_seg_002",
          device_id: "device_001",
          start_ms: startMs + 200000,
          end_ms: startMs + 210000,
          lines: [
            {
              line_id: "seg_002#0",
              seg_id: "seg_002",
              text: "world",
              start_ms: startMs + 200000,
              end_ms: startMs + 205000,
            },
          ],
          content_ms: 5000,
          has_text: true,
          status: "closed",
          close_reason: "silence",
        },
      ];

      const units = planLabelUnits(windows, startMs + 300000);

      expect(units.length).toBeGreaterThanOrEqual(1);
      const unit = units[0];
      if (unit) {
        expect(unit.window_ids).toContain("w_seg_001");
        expect(unit.lines.length).toBeGreaterThan(0);
      }
    });

    it("excludes open windows from label units", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const windows: PipelineWindow[] = [
        {
          window_id: "w_seg_001",
          device_id: "device_001",
          start_ms: startMs,
          end_ms: startMs + 10000,
          lines: [
            {
              line_id: "seg_001#0",
              seg_id: "seg_001",
              text: "hello",
              start_ms: startMs,
              end_ms: startMs + 5000,
            },
          ],
          content_ms: 5000,
          has_text: true,
          status: "open",
          close_reason: null,
        },
      ];

      const units = planLabelUnits(windows, startMs + 30000);

      expect(units).toHaveLength(0);
    });

    it("excludes windows without text from label units", () => {
      const startMs = new Date("2026-10-01T10:00:00Z").getTime();
      const windows: PipelineWindow[] = [
        {
          window_id: "w_seg_001",
          device_id: "device_001",
          start_ms: startMs,
          end_ms: startMs + 10000,
          lines: [],
          content_ms: 0,
          has_text: false,
          status: "closed",
          close_reason: "silence",
        },
      ];

      const units = planLabelUnits(windows, startMs + 100000);

      expect(units).toHaveLength(0);
    });
  });
});
