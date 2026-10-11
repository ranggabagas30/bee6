import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/eval/csv";
import { buildEpisodeExport, type ExportThread } from "@/lib/eval/export";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";

const TZ = "Asia/Jakarta";
const at = (date: string, hm: string) => zonedTimeToEpochMs(date, hm, TZ);

function thread(over: Partial<ExportThread> & { thread_id: string }): ExportThread {
  return {
    category: "ROUTINE_OPS",
    first_line_start_ms: at("2026-10-05", "09:00"),
    lines: [{ start_ms: at("2026-10-05", "09:00"), text: "opening up" }],
    ...over,
  };
}

describe("buildEpisodeExport", () => {
  const threads: ExportThread[] = [
    thread({
      thread_id: "thr_late",
      category: "COMPLAINT",
      first_line_start_ms: at("2026-10-06", "18:30"),
      lines: [
        { start_ms: at("2026-10-06", "18:31"), text: "second line, with comma" },
        { start_ms: at("2026-10-06", "18:30"), text: 'first "quoted" line' },
      ],
    }),
    thread({ thread_id: "thr_early", category: "TRAINING", first_line_start_ms: at("2026-10-05", "07:05") }),
  ];
  const out = buildEpisodeExport(threads, TZ);

  it("orders episodes by time, aliases E0001..., and uses the stored model category", () => {
    const rows = parseCsv(out.episodesCsv);
    expect(rows[0]).toEqual(["episode", "local_date", "start_hm", "lines", "model_category", "gold", "gold_2", "notes"]);
    expect(rows[1]).toEqual(["E0001", "2026-10-05", "07:05", "opening up", "TRAINING", "", "", ""]);
    expect(rows[2]?.slice(0, 3)).toEqual(["E0002", "2026-10-06", "18:30"]);
    expect(rows[2]?.[4]).toBe("COMPLAINT");
    expect(out.count).toBe(2);
  });

  it("joins line text in time order with ' / ' and survives quotes and commas", () => {
    const rows = parseCsv(out.episodesCsv);
    expect(rows[2]?.[3]).toBe('first "quoted" line / second line, with comma');
  });

  it("never puts a thread id (or device id) in the episodes file; the map file links alias to thread id", () => {
    expect(out.episodesCsv).not.toContain("thr_");
    expect(parseCsv(out.mapCsv)).toEqual([
      ["episode", "thread_id"],
      ["E0001", "thr_early"],
      ["E0002", "thr_late"],
    ]);
  });

  it("neutralises spreadsheet formula starters and flattens newlines in line text", () => {
    const risky = buildEpisodeExport(
      [thread({ thread_id: "t", lines: [{ start_ms: 1, text: "=SUM(1)\nnext" }] })],
      TZ,
    );
    expect(parseCsv(risky.episodesCsv)[1]?.[3]).toBe("'=SUM(1) next");
  });

  it("is deterministic and stable on equal start times (tie broken by thread id)", () => {
    const t = at("2026-10-05", "10:00");
    const a = buildEpisodeExport([thread({ thread_id: "b", first_line_start_ms: t }), thread({ thread_id: "a", first_line_start_ms: t })], TZ);
    expect(parseCsv(a.mapCsv).slice(1)).toEqual([["E0001", "a"], ["E0002", "b"]]);
  });

  it("handles an empty set (header only)", () => {
    const empty = buildEpisodeExport([], TZ);
    expect(empty.count).toBe(0);
    expect(parseCsv(empty.episodesCsv)).toHaveLength(1);
  });
});
