import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as guardModule from "@/lib/http/guard";
import * as debriefStoreModule from "@/lib/firestore/debrief-store";
import * as dayStoreModule from "@/lib/firestore/day-store";
import type { DebriefStore } from "@/lib/debrief/service";
import type { ConfirmStore, DayStore } from "@/lib/day/service";
import type { LastEnded, Question, Thread } from "@/lib/firestore/schema";

vi.mock("@/lib/http/guard");
vi.mock("@/lib/firestore/debrief-store");
vi.mock("@/lib/firestore/day-store");
vi.mock("@/lib/day/thread-handle", async () => {
  const actual = await vi.importActual<typeof import("@/lib/day/thread-handle")>("@/lib/day/thread-handle");
  return { ...actual, readThreadHandleKey: vi.fn(() => null) };
});

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: "outlet-1",
    question_id: "q1",
    device_id: "device-1",
    thread_id: "t1",
    kind: "gate",
    status: "open",
    category: "CUSTOMER_SERVICE",
    window_start_ms: Date.UTC(2026, 9, 6, 19, 5),
    window_end_ms: Date.UTC(2026, 9, 6, 19, 10),
    created_at_ms: 0,
    ...overrides,
  };
}

function fakeStore(overrides: Partial<DebriefStore> = {}): DebriefStore {
  return {
    getLastEnded: async () => null,
    getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14 }),
    listOpenQuestions: async () => [],
    getQuestion: async () => null,
    findEndedDebrief: async () => null,
    listStaffNames: async () => [],
    transactAnswer: async () => "already_answered",
    getLatestEndedSession: async () => null,
    listSessionLines: async () => [],
    listLabelledLineIds: async () => new Set(),
    getThread: async () => null,
    ...overrides,
  };
}

// Every existing (device-branch) test below calls this helper, which now
// always sends `X-Device-Id` — a paired phone's own client always does
// (lib/capture/browser/client.ts) — so the route still dispatches each of
// them to `deviceQuestionsGet` under the new header split (R-06 Task 13.5).
// Per the task's own constraint, this is the only permitted edit to an
// existing test in this file; no assertion below changed.
function getRequest() {
  return new NextRequest("http://localhost/api/v1/questions", {
    method: "GET",
    headers: { "x-device-id": "device-1" },
  });
}

// The supervisor review-queue branch (R-06 Task 13): no `X-Device-Id` header.
function supervisorRequest(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/questions", { method: "GET", headers });
}

function fakeDayStore(overrides: Partial<DayStore> = {}): DayStore & ConfirmStore {
  const store: DayStore = {
    getOutlet: async () => ({
      outlet_id: "outlet-1",
      name: "Test Outlet",
      project_kind: "demo",
      timezone: "Asia/Jakarta",
      opening_time: "09:30",
      closing_time: "01:00",
      retention_days: 14,
      created_at: "2026-09-01T00:00:00.000Z",
    }),
    listSessions: async () => [],
    listThreads: async () => [],
    getQuestions: async () => new Map(),
    getCorrections: async () => new Map(),
    listUnlabelledQuestions: async () => [],
    countPairedDevices: async () => 0,
    listAnsweredGateQuestions: async () => [],
    getThreads: async () => new Map(),
    ...overrides,
  };
  return store as DayStore & ConfirmStore;
}

describe("GET /api/v1/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when requireDevice throws UnauthorizedError", async () => {
    const { UnauthorizedError } = await import("@/lib/http/errors");
    vi.spyOn(guardModule, "requireDevice").mockRejectedValueOnce(new UnauthorizedError("No token"));
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
  });

  it("returns 403 when the caller is not a device principal (e.g. a supervisor ID token)", async () => {
    const { ForbiddenError } = await import("@/lib/http/errors");
    vi.spyOn(guardModule, "requireDevice").mockRejectedValueOnce(new ForbiddenError("Not a device"));
    const response = await GET(getRequest());
    expect(response.status).toBe(403);
  });

  it("returns debrief: null, questions: [] when no debrief has ended for this device", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      device_id: "device-1",
      role: "device",
    });
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStore());

    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ debrief: null, questions: [] });
  });

  it("list response question items have exactly question_id, kind, category, start_hm, end_hm", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      device_id: "device-1",
      role: "device",
    });
    const lastEnded: LastEnded = {
      business_date: "2026-10-07",
      end_reason: "selesai",
      ended_at_ms: 1,
      // Always "now < ends", whatever the real wall clock is at test time.
      debrief_ends_at_ms: Date.now() + 3_600_000,
    };
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
      fakeStore({
        getLastEnded: async () => lastEnded,
        listOpenQuestions: async () => [makeQuestion()],
      }),
    );

    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.questions).toHaveLength(1);
    expect(Object.keys(body.data.questions[0]).sort()).toEqual(
      ["question_id", "kind", "category", "start_hm", "end_hm"].sort(),
    );
    expect(body.data.questions[0].category).toBe("CUSTOMER_SERVICE");
    expect(body.data.questions[0].start_hm).toBe("02:05");
    expect(body.data.questions[0].end_hm).toBe("02:10");
  });

  describe("R-19: `preparing` is in the response only on a sandbox outlet", () => {
    const activeLastEnded = (): LastEnded => ({
      business_date: "2026-10-07",
      end_reason: "selesai",
      ended_at_ms: Date.now() - 60_000,
      debrief_ends_at_ms: Date.now() + 3_600_000,
    });
    const deviceClaims = () =>
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: "outlet-1", device_id: "device-1", role: "device" });

    it("sandbox: preparing: true while an unlabelled text line of the ended session exists", async () => {
      deviceClaims();
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14, sandbox: true }),
          getLastEnded: async () => activeLastEnded(),
          getLatestEndedSession: async () => ({ session_id: "11111111-1111-4111-8111-111111111111", ended_at_ms: Date.now() - 60_000 }),
          listSessionLines: async () => [{ line_id: "s1#0", has_text: true }],
          listLabelledLineIds: async () => new Set(),
        }),
      );
      const response = await GET(getRequest());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.preparing).toBe(true);
    });

    it("pilot: no `preparing` key at all", async () => {
      deviceClaims();
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({ getLastEnded: async () => activeLastEnded() }),
      );
      const response = await GET(getRequest());
      const body = await response.json();
      expect(Object.keys(body.data).sort()).toEqual(["debrief", "questions"]);
    });
  });

  describe("demo-feedback-2 item 10: `lines` on a sandbox outlet only", () => {
    const activeLastEnded = (): LastEnded => ({
      business_date: "2026-10-07",
      end_reason: "selesai",
      ended_at_ms: Date.now() - 60_000,
      debrief_ends_at_ms: Date.now() + 3_600_000,
    });
    const deviceClaims = () =>
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: "outlet-1", device_id: "device-1", role: "device" });
    const aThread = (over: Partial<Thread> = {}): Thread => ({
      outlet_id: "outlet-1",
      thread_id: "t1",
      device_id: "device-1",
      category: "CUSTOMER_SERVICE",
      confidence: 0.6,
      line_ids: ["l0", "l1"],
      evidence_line_ids: ["l1"],
      lines: [
        { line_id: "l0", start_ms: 1, end_ms: 2, text: "Ari bilang kopi habis." },
        { line_id: "l1", start_ms: 3, end_ms: 4, text: "Pelanggan tanya roti tawar habis." },
      ],
      first_line_start_ms: 1,
      last_line_end_ms: 4,
      summary: "s",
      label_conflict: false,
      status: "open",
      gate: {
        verdict: "question",
        fired_rule: "below_threshold",
        checks: [{ rule: "invalid_label", passed: true }],
        category: "CUSTOMER_SERVICE",
        confidence: 0.6,
        threshold: 0.9,
        evidence_count: 1,
        gate_version: "1",
      },
      created_at_ms: 0,
      updated_at_ms: 0,
      ...over,
    });

    it("sandbox: the question carries the scrubbed evidence line; the store is built from the verified claims", async () => {
      deviceClaims();
      const factory = vi
        .spyOn(debriefStoreModule, "firestoreDebriefStore")
        .mockReturnValueOnce(
          fakeStore({
            getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14, sandbox: true }),
            getLastEnded: async () => activeLastEnded(),
            listOpenQuestions: async () => [makeQuestion()],
            listStaffNames: async () => ["Ari Demo"],
            getThread: async () => aThread(),
          }),
        );
      const response = await GET(getRequest());
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.questions[0].lines).toEqual(["Pelanggan tanya roti tawar habis."]);
      expect(factory).toHaveBeenCalledWith("outlet-1");
    });

    it("sandbox: a thread of another device is not returned", async () => {
      deviceClaims();
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14, sandbox: true }),
          getLastEnded: async () => activeLastEnded(),
          listOpenQuestions: async () => [makeQuestion()],
          getThread: async () => aThread({ device_id: "device-2" }),
        }),
      );
      const body = await (await GET(getRequest())).json();
      expect(body.data.questions[0]).not.toHaveProperty("lines");
    });

    it("pilot: the question keeps exactly its five keys even when a readable thread exists", async () => {
      deviceClaims();
      const getThread = vi.fn(async () => aThread());
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getLastEnded: async () => activeLastEnded(),
          listOpenQuestions: async () => [makeQuestion()],
          getThread,
        }),
      );
      const body = await (await GET(getRequest())).json();
      expect(Object.keys(body.data.questions[0]).sort()).toEqual(["category", "end_hm", "kind", "question_id", "start_hm"]);
      expect(getThread).not.toHaveBeenCalled();
    });

    it("an error response and the console never carry line text", async () => {
      deviceClaims();
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getOutletCalendar: async () => {
            throw new Error("boom: Pelanggan tanya roti tawar habis.");
          },
          getLastEnded: async () => activeLastEnded(),
          listOpenQuestions: async () => [makeQuestion()],
          getThread: async () => aThread(),
        }),
      );
      const response = await GET(getRequest());
      const text = await response.text();
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(text).not.toContain("Pelanggan");
      expect(JSON.stringify([...logSpy.mock.calls, ...errSpy.mock.calls])).not.toContain("tanya roti");
      logSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("sandbox 200 carries Cache-Control: private, no-store (the body now holds stored text)", async () => {
      deviceClaims();
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14, sandbox: true }),
          getLastEnded: async () => activeLastEnded(),
          listOpenQuestions: async () => [makeQuestion()],
          getThread: async () => aThread(),
        }),
      );
      const response = await GET(getRequest());
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("pilot 200 also carries no-store, and its body is unchanged", async () => {
      deviceClaims();
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getLastEnded: async () => activeLastEnded(),
          listOpenQuestions: async () => [makeQuestion()],
        }),
      );
      const response = await GET(getRequest());
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await response.json();
      expect(Object.keys(body.data.questions[0]).sort()).toEqual(["category", "end_hm", "kind", "question_id", "start_hm"]);
    });

    it("error responses of the device branch carry no-store too", async () => {
      const { UnauthorizedError } = await import("@/lib/http/errors");
      vi.spyOn(guardModule, "requireDevice").mockRejectedValueOnce(new UnauthorizedError("No token"));
      const response = await GET(getRequest());
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("a successful sandbox response logs counts only", async () => {
      deviceClaims();
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
        fakeStore({
          getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14, sandbox: true }),
          getLastEnded: async () => activeLastEnded(),
          listOpenQuestions: async () => [makeQuestion()],
          getThread: async () => aThread(),
        }),
      );
      await GET(getRequest());
      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logged).toContain("debrief.lines");
      expect(logged).not.toContain("roti");
      expect(logged).not.toContain("kopi");
      logSpy.mockRestore();
    });
  });

  it("with X-Device-Id present: requireDevice is called, requireClaims never is", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      device_id: "device-1",
      role: "device",
    });
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStore());
    const claimsSpy = vi.spyOn(guardModule, "requireClaims");

    await GET(getRequest());

    expect(guardModule.requireDevice).toHaveBeenCalledTimes(1);
    expect(claimsSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/questions — supervisor review queue (R-06 Task 13.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("without X-Device-Id: requireClaims is called, requireDevice never is", async () => {
    vi.spyOn(guardModule, "requireClaims").mockResolvedValueOnce({
      outlet_id: "outlet-1",
      role: "supervisor",
    });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeDayStore());
    const deviceSpy = vi.spyOn(guardModule, "requireDevice");

    const response = await GET(supervisorRequest("Bearer good-token"));

    expect(response.status).toBe(200);
    expect(guardModule.requireClaims).toHaveBeenCalledTimes(1);
    expect(deviceSpy).not.toHaveBeenCalled();
  });

  it("401 when requireClaims rejects (no/bad/expired token)", async () => {
    const { UnauthorizedError } = await import("@/lib/http/errors");
    vi.spyOn(guardModule, "requireClaims").mockRejectedValueOnce(new UnauthorizedError("Invalid token"));
    const response = await GET(supervisorRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("403 for an owner principal (no questions:read)", async () => {
    vi.spyOn(guardModule, "requireClaims").mockResolvedValueOnce({ outlet_id: "outlet-1", role: "owner" });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeDayStore());
    const response = await GET(supervisorRequest("Bearer owner-token"));
    expect(response.status).toBe(403);
  });

  it("403 for a staff principal (no day:read:evidence)", async () => {
    vi.spyOn(guardModule, "requireClaims").mockResolvedValueOnce({ outlet_id: "outlet-1", role: "staff" });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeDayStore());
    const response = await GET(supervisorRequest("Bearer staff-token"));
    expect(response.status).toBe(403);
  });

  it("404 when the outlet doc is missing", async () => {
    vi.spyOn(guardModule, "requireClaims").mockResolvedValueOnce({ outlet_id: "outlet-1", role: "supervisor" });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeDayStore({ getOutlet: async () => null }));
    const response = await GET(supervisorRequest("Bearer sup-token"));
    expect(response.status).toBe(404);
  });

  it("200 with the empty queue shape and Cache-Control: private, no-store", async () => {
    vi.spyOn(guardModule, "requireClaims").mockResolvedValueOnce({ outlet_id: "outlet-1", role: "supervisor" });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeDayStore());
    const response = await GET(supervisorRequest("Bearer sup-token"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data).toEqual({ view: "supervisor_queue", items: [], truncated: false });
  });

  it("firestoreDayStore is constructed with the caller's own outlet_id", async () => {
    vi.spyOn(guardModule, "requireClaims").mockResolvedValueOnce({ outlet_id: "outlet-42", role: "supervisor" });
    const spy = vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(
      fakeDayStore({ getOutlet: async () => ({
        outlet_id: "outlet-42",
        name: "Test Outlet",
        project_kind: "demo",
        timezone: "Asia/Jakarta",
        opening_time: "09:30",
        closing_time: "01:00",
        retention_days: 14,
        created_at: "2026-09-01T00:00:00.000Z",
      }) }),
    );
    await GET(supervisorRequest("Bearer sup-token"));
    expect(spy).toHaveBeenCalledWith("outlet-42");
  });
});
