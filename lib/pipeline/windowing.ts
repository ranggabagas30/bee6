import type { Segment } from "@/lib/firestore/schema";

/**
 * Windowing module (E3 in pipeline spec). Turns a stream of segments into
 * windows that close on 90s silence, cap at 6 min, and prefer cutting at
 * real pauses. Pure functions, no I/O, deterministic (no Date.now()).
 */

export type SegmentForWindowing = Pick<
  Segment,
  "seg_id" | "device_start" | "device_end" | "lines"
>;

export interface TimedLine {
  line_id: string; // ${seg_id}#${k}
  seg_id: string;
  text: string;
  start_ms: number; // absolute device epoch ms
  end_ms: number; // absolute device epoch ms
}

export interface PipelineWindow {
  window_id: string; // w_${first_seg_id}
  device_id: string;
  start_ms: number;
  end_ms: number;
  lines: TimedLine[];
  content_ms: number; // total duration of lines in this window
  has_text: boolean;
  status: "open" | "closed";
  close_reason: "silence" | "cap" | null;
}

export interface LabelUnit {
  unit_id: string;
  window_ids: string[];
  lines: TimedLine[];
}

export interface WindowingConfig {
  silence: number; // ms to close on silence (default 90_000)
  cap: number; // max window span in ms (default 360_000)
  capLookback: number; // lookback window for finding best pause within cap (default 60_000)
}

const DEFAULT_WINDOWING_CONFIG: WindowingConfig = {
  silence: 90_000,
  cap: 360_000,
  capLookback: 60_000,
};

/**
 * Converts segments to absolute-ms timed lines, sorted by (device_start, seg_id),
 * deduplicated by seg_id (first occurrence wins).
 */
export function toTimedLines(
  segments: readonly SegmentForWindowing[]
): TimedLine[] {
  // Sort by device_start, then seg_id (lexicographic for determinism)
  const sorted = Array.from(segments).sort((a, b) => {
    const aTime = new Date(a.device_start).getTime();
    const bTime = new Date(b.device_start).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.seg_id < b.seg_id ? -1 : a.seg_id > b.seg_id ? 1 : 0;
  });

  // Dedupe by seg_id
  const seen = new Set<string>();
  const deduped: SegmentForWindowing[] = [];
  for (const seg of sorted) {
    if (!seen.has(seg.seg_id)) {
      seen.add(seg.seg_id);
      deduped.push(seg);
    }
  }

  // Convert to timed lines with absolute ms
  const result: TimedLine[] = [];
  for (const seg of deduped) {
    const segStartMs = new Date(seg.device_start).getTime();
    for (let i = 0; i < seg.lines.length; i += 1) {
      const segLine = seg.lines[i];
      if (!segLine) continue;
      result.push({
        line_id: `${seg.seg_id}#${i}`,
        seg_id: seg.seg_id,
        text: segLine.text,
        start_ms: segStartMs + segLine.start * 1000,
        end_ms: segStartMs + segLine.end * 1000,
      });
    }
  }

  return result;
}

/**
 * Builds windows from segments and timed lines.
 * - Closes on >= 90s silence gap
 * - Caps at 360s, preferring to cut at a real pause within the last 60s
 * - Marks windows as "closed" if as_of_ms > last_line_end + silence threshold
 * - window_id is stable across input order (deterministic)
 */
export function buildWindows(
  input: {
    device_id: string;
    segments: readonly SegmentForWindowing[];
    as_of_ms: number;
  },
  cfg?: Partial<WindowingConfig>
): PipelineWindow[] {
  const config = { ...DEFAULT_WINDOWING_CONFIG, ...cfg };
  const timedLines = toTimedLines(input.segments);

  if (timedLines.length === 0) return [];

  const windows: PipelineWindow[] = [];
  let currentWindow: PipelineWindow | null = null;

  for (let i = 0; i < timedLines.length; i += 1) {
    const timedLine = timedLines[i];
    if (!timedLine) continue;

    if (!currentWindow) {
      // Start a new window
      currentWindow = {
        window_id: `w_${timedLine.seg_id}`,
        device_id: input.device_id,
        start_ms: timedLine.start_ms,
        end_ms: timedLine.end_ms,
        lines: [timedLine],
        content_ms: timedLine.end_ms - timedLine.start_ms,
        has_text: timedLine.text.length > 0,
        status: "closed",
        close_reason: null,
      };
      continue;
    }

    const gapMs = timedLine.start_ms - currentWindow.end_ms;
    const windowDurationMs = timedLine.end_ms - currentWindow.start_ms;

    // Check if gap is >= silence threshold
    if (gapMs >= config.silence) {
      // Close current window and start a new one
      finalizeWindow(currentWindow, input.as_of_ms, config);
      windows.push(currentWindow);
      currentWindow = {
        window_id: `w_${timedLine.seg_id}`,
        device_id: input.device_id,
        start_ms: timedLine.start_ms,
        end_ms: timedLine.end_ms,
        lines: [timedLine],
        content_ms: timedLine.end_ms - timedLine.start_ms,
        has_text: timedLine.text.length > 0,
        status: "closed",
        close_reason: null,
      };
      continue;
    }

    // Check if adding this line would exceed cap
    if (windowDurationMs > config.cap) {
      // Need to close the current window at or before the cap
      const discardedLines = closeWindowAtCap(currentWindow, config);
      windows.push(currentWindow);

      // Start new window with the discarded lines plus the current line
      const newWindowLines = [...discardedLines, timedLine];
      const firstNewLine = newWindowLines[0];
      if (!firstNewLine) continue; // should never happen since newWindowLines has at least timedLine

      const newWindowStart = firstNewLine.start_ms;
      const newWindowEnd = timedLine.end_ms;
      currentWindow = {
        window_id: `w_${firstNewLine.seg_id}`,
        device_id: input.device_id,
        start_ms: newWindowStart,
        end_ms: newWindowEnd,
        lines: newWindowLines,
        content_ms: newWindowEnd - newWindowStart,
        has_text: newWindowLines.some((l) => l.text.length > 0),
        status: "closed",
        close_reason: null,
      };
      continue;
    }

    // Add line to current window
    currentWindow.end_ms = timedLine.end_ms;
    currentWindow.lines.push(timedLine);
    currentWindow.content_ms = timedLine.end_ms - currentWindow.start_ms;
    currentWindow.has_text = currentWindow.has_text || timedLine.text.length > 0;
  }

  // Finalize the last window
  if (currentWindow) {
    finalizeWindow(currentWindow, input.as_of_ms, config);
    windows.push(currentWindow);
  }

  return windows;
}

function finalizeWindow(
  window: PipelineWindow,
  as_of_ms: number,
  config: WindowingConfig
): void {
  const timeSinceLastLine = as_of_ms - window.end_ms;
  if (timeSinceLastLine >= config.silence) {
    window.status = "closed";
    window.close_reason = "silence";
  } else {
    window.status = "open";
    window.close_reason = null;
  }
}

function closeWindowAtCap(
  window: PipelineWindow,
  config: WindowingConfig
): TimedLine[] {
  const capThreshold = window.start_ms + config.cap;
  const lookbackStart = capThreshold - config.capLookback;

  // Find the largest gap within [capThreshold - capLookback, capThreshold]
  // On a tie, prefer the LATER gap
  let bestGapIndex = -1;
  let bestGapSize = 0;

  for (let i = 0; i < window.lines.length - 1; i += 1) {
    const currentLine = window.lines[i];
    const nextLine = window.lines[i + 1];
    if (!currentLine || !nextLine) continue;

    const currentLineEnd = currentLine.end_ms;
    const nextLineStart = nextLine.start_ms;
    const gap = Math.max(0, nextLineStart - currentLineEnd); // clamp negative gaps to 0

    if (
      nextLineStart >= lookbackStart &&
      nextLineStart <= capThreshold &&
      gap >= bestGapSize // >= instead of > to prefer later gap on tie
    ) {
      bestGapSize = gap;
      bestGapIndex = i;
    }
  }

  let discardedLines: TimedLine[] = [];

  if (bestGapIndex >= 0) {
    // Cut at the best gap
    discardedLines = window.lines.slice(bestGapIndex + 1);
    window.lines = window.lines.slice(0, bestGapIndex + 1);
    const lastLine = window.lines[window.lines.length - 1];
    if (lastLine) {
      window.end_ms = lastLine.end_ms;
    }
  } else {
    // No gap found; cut at the last line boundary at or before cap
    let cutIndex = window.lines.findIndex(
      (lineItem) => lineItem.end_ms > capThreshold
    );
    if (cutIndex === -1) {
      // All lines are at or before cap
      cutIndex = window.lines.length;
    }
    if (cutIndex > 0) {
      discardedLines = window.lines.slice(cutIndex);
      window.lines = window.lines.slice(0, cutIndex);
      const lastLine = window.lines[window.lines.length - 1];
      if (lastLine) {
        window.end_ms = lastLine.end_ms;
      }
    } else if (cutIndex === 0) {
      // First line itself exceeds cap; still include it
      const firstLine = window.lines[0];
      if (firstLine) {
        discardedLines = window.lines.slice(1);
        window.lines = [firstLine];
        window.end_ms = firstLine.end_ms;
      }
    }
  }

  window.content_ms = window.end_ms - window.start_ms;
  window.status = "closed";
  window.close_reason = "cap";

  return discardedLines;
}

/**
 * Plans label units from windows (batching tiny windows, grouping by ready time).
 * Includes only closed windows with text. Returns units that are ready for labelling
 * (as_of_ms >= unit end time).
 */
export function planLabelUnits(
  windows: readonly PipelineWindow[],
  as_of_ms: number,
  cfg?: Partial<{ tinyMs: number; batchMs: number }>
): LabelUnit[] {
  const config = { tinyMs: 10_000, batchMs: 180_000, ...cfg };

  const eligible = windows.filter((w) => w.status === "closed" && w.has_text);

  if (eligible.length === 0) return [];

  const units: LabelUnit[] = [];
  let i = 0;

  while (i < eligible.length) {
    const startWindow = eligible[i];
    if (!startWindow) break;

    const batchFloor = Math.floor(startWindow.start_ms / config.batchMs);
    const batchEnd = (batchFloor + 1) * config.batchMs;

    // Collect windows in this batch
    const batchWindows: PipelineWindow[] = [];
    const allLines: TimedLine[] = [];

    while (i < eligible.length) {
      const w = eligible[i];
      if (!w || w.start_ms >= batchEnd) break;
      batchWindows.push(w);
      allLines.push(...w.lines);
      i += 1;
    }

    // Only include the batch if it's ready (as_of_ms >= batchEnd)
    if (as_of_ms >= batchEnd) {
      const unitId = `unit_${batchFloor}`;
      units.push({
        unit_id: unitId,
        window_ids: batchWindows.map((w) => w.window_id),
        lines: allLines,
      });
    }
  }

  return units;
}
