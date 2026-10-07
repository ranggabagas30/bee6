import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as guardModule from "@/lib/http/guard";
import * as debriefStoreModule from "@/lib/firestore/debrief-store";
import type { DebriefStore } from "@/lib/debrief/service";
import type { LastEnded, Question } from "@/lib/firestore/schema";

vi.mock("@/lib/http/guard");
vi.mock("@/lib/firestore/debrief-store");

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
    ...overrides,
  };
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/questions", { method: "GET" });
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
});
