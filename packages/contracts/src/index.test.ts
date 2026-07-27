import { describe, expect, it } from "vitest";
import {
  abandonRunResultSchema,
  canonicalNavigationEventHashInput,
  createRoomCommandSchema,
  pairingCodeSchema,
  roomCodeSchema,
  serverEnvelopeSchema,
  updateRoomSettingsCommandSchema,
} from "./index.js";

const idempotencyKey = "019fa265-5f23-7260-9a6d-2978554d7152";

describe("roomCodeSchema", () => {
  it("normalizes a six-character room code", () => {
    expect(roomCodeSchema.parse(" ab12cd ")).toBe("AB12CD");
  });

  it("rejects an invalid room code", () => {
    expect(roomCodeSchema.safeParse("ABC-12").success).toBe(false);
  });
});

describe("room commands", () => {
  it("applies the default room capacity", () => {
    expect(
      createRoomCommandSchema.parse({
        schemaVersion: 1,
        idempotencyKey,
        nickname: "링크러너",
      }).maxPlayers,
    ).toBe(4);
  });

  it("rejects identical start and target articles", () => {
    expect(
      updateRoomSettingsCommandSchema.safeParse({
        schemaVersion: 1,
        idempotencyKey,
        roomId: "019fa265-5f23-7260-9a6d-2978554d7153",
        expectedVersion: 1,
        maxPlayers: 4,
        startArticle: { key: "축구", title: "축구" },
        targetArticle: { key: "축구", title: "축구" },
        articleSource: "host",
      }).success,
    ).toBe(false);
  });
});

describe("server envelopes", () => {
  it("requires an offset-aware server timestamp", () => {
    const schema = serverEnvelopeSchema(roomCodeSchema);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        serverNow: "2026-07-27T06:00:00.000Z",
        data: "ABC123",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        serverNow: "2026-07-27 06:00:00",
        data: "ABC123",
      }).success,
    ).toBe(false);
  });
});

describe("extension protocol", () => {
  it("normalizes a human-formatted pairing code", () => {
    expect(pairingCodeSchema.parse(" abcd-2345 ")).toBe("ABCD2345");
  });

  it("builds a stable navigation hash payload", () => {
    expect(
      canonicalNavigationEventHashInput({
        sequence: 2,
        type: "link",
        fromArticleKey: "Cafe\u0301",
        toArticleKey: "목표",
        clientObservedAt: "2026-07-27T07:01:02.345+00:00",
        previousHash: "a".repeat(64),
      }),
    ).toBe(`2\nlink\nCafé\n목표\n2026-07-27T07:01:02.345Z\n${"a".repeat(64)}`);
  });

  it("accepts an abandoned run result", () => {
    expect(
      abandonRunResultSchema.safeParse({
        runId: "019fa265-5f23-7260-9a6d-2978554d7154",
        status: "abandoned",
        abandonedAt: "2026-07-27T07:02:03.000Z",
        gameStatus: "cancelled",
        roomStatus: "finished",
      }).success,
    ).toBe(true);
  });
});
