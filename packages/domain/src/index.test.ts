import { describe, expect, it } from "vitest";
import { canTransitionRoom, canTransitionRun, countsAsMove, rankRuns } from "./index.js";

describe("state transitions", () => {
  it("allows the documented room lifecycle", () => {
    expect(canTransitionRoom("waiting", "countdown")).toBe(true);
    expect(canTransitionRoom("countdown", "running")).toBe(true);
    expect(canTransitionRoom("running", "finished")).toBe(true);
    expect(canTransitionRoom("finished", "waiting")).toBe(true);
  });

  it("rejects skipping room states", () => {
    expect(canTransitionRoom("waiting", "running")).toBe(false);
    expect(canTransitionRoom("closed", "waiting")).toBe(false);
  });

  it("allows host review to disqualify a finished run", () => {
    expect(canTransitionRun("finished", "disqualified")).toBe(true);
  });
});

describe("ranking", () => {
  it("uses duration, move count, finish time, then run id", () => {
    const ranked = rankRuns([
      {
        runId: "run-c",
        status: "finished",
        durationMs: 10_000,
        moveCount: 4,
        finishedAt: "2026-07-27T06:00:10.000Z",
      },
      {
        runId: "run-b",
        status: "finished",
        durationMs: 10_000,
        moveCount: 3,
        finishedAt: "2026-07-27T06:00:10.000Z",
      },
      {
        runId: "run-a",
        status: "finished",
        durationMs: 9_999,
        moveCount: 10,
        finishedAt: "2026-07-27T06:00:09.999Z",
      },
      {
        runId: "run-d",
        status: "disqualified",
        durationMs: 1,
        moveCount: 1,
        finishedAt: "2026-07-27T06:00:00.001Z",
      },
    ]);

    expect(Object.fromEntries(ranked.map((run) => [run.runId, run.rank]))).toEqual({
      "run-a": 1,
      "run-b": 2,
      "run-c": 3,
      "run-d": null,
    });
  });
});

describe("move counting", () => {
  it("counts only verified link navigation", () => {
    expect(countsAsMove("link")).toBe(true);
    expect(countsAsMove("back")).toBe(false);
    expect(countsAsMove("forward")).toBe(false);
    expect(countsAsMove("reload")).toBe(false);
    expect(countsAsMove("direct")).toBe(false);
  });
});
