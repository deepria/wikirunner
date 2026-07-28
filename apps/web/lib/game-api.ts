"use client";

import {
  apiErrorSchema,
  type CountdownResult,
  countdownResultSchema,
  type EndGameResult,
  endGameResultSchema,
  type GameRoutesResult,
  gameRoutesResultSchema,
  type PairingCodeResult,
  type PrepareNextGameResult,
  pairingCodeResultSchema,
  prepareNextGameResultSchema,
  type RandomDifficulty,
  type ReadyResult,
  type RoomCommandResult,
  type RoomSettingsResult,
  type RoomSnapshot,
  readyResultSchema,
  roomCommandResultSchema,
  roomSettingsResultSchema,
  roomSnapshotSchema,
  serverEnvelopeSchema,
} from "@wikirunner/contracts";
import { ensureAnonymousSession } from "./supabase";

export class GameApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "GameApiError";
  }
}

export async function createRoom(input: {
  nickname: string;
  maxPlayers: number;
}): Promise<RoomCommandResult> {
  const idempotencyKey = crypto.randomUUID();
  return commandRequest(
    "/v1/rooms",
    {
      schemaVersion: 1,
      idempotencyKey,
      nickname: input.nickname,
      maxPlayers: input.maxPlayers,
    },
    idempotencyKey,
  );
}

export async function joinRoom(input: {
  inviteCode: string;
  nickname: string;
}): Promise<RoomCommandResult> {
  const idempotencyKey = crypto.randomUUID();
  return commandRequest(
    "/v1/rooms/join",
    {
      schemaVersion: 1,
      idempotencyKey,
      inviteCode: input.inviteCode,
      nickname: input.nickname,
    },
    idempotencyKey,
  );
}

export async function getRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  const envelope = await gameApiFetch(`/v1/rooms/${roomId}/snapshot`, {
    method: "GET",
  });
  return serverEnvelopeSchema(roomSnapshotSchema).parse(envelope).data;
}

export async function updateRoomSettings(input: {
  roomId: string;
  expectedVersion: number;
  maxPlayers: number;
  startArticleTitle: string;
  targetArticleTitle: string;
}): Promise<RoomSettingsResult> {
  const idempotencyKey = crypto.randomUUID();
  const startArticleTitle = input.startArticleTitle.trim().normalize("NFC");
  const targetArticleTitle = input.targetArticleTitle.trim().normalize("NFC");
  const envelope = await gameApiFetch(`/v1/rooms/${input.roomId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      roomId: input.roomId,
      expectedVersion: input.expectedVersion,
      maxPlayers: input.maxPlayers,
      startArticle: {
        key: startArticleTitle,
        title: startArticleTitle,
      },
      targetArticle: {
        key: targetArticleTitle,
        title: targetArticleTitle,
      },
      articleSource: "host",
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(roomSettingsResultSchema).parse(envelope).data;
}

export async function generateRandomRoomPath(input: {
  roomId: string;
  expectedVersion: number;
  difficulty: RandomDifficulty;
}): Promise<RoomSettingsResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await gameApiFetch(`/v1/rooms/${input.roomId}/random-path`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      roomId: input.roomId,
      expectedVersion: input.expectedVersion,
      difficulty: input.difficulty,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(roomSettingsResultSchema).parse(envelope).data;
}

export async function issuePairingCode(playerId: string): Promise<PairingCodeResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await gameApiFetch(`/v1/players/${playerId}/pairing-code`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      playerId,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(pairingCodeResultSchema).parse(envelope).data;
}

export async function setPlayerReady(playerId: string, ready: boolean): Promise<ReadyResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await gameApiFetch(`/v1/players/${playerId}/ready`, {
    method: "PUT",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      playerId,
      ready,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(readyResultSchema).parse(envelope).data;
}

export async function startCountdown(
  roomId: string,
  expectedVersion: number,
): Promise<CountdownResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await gameApiFetch(`/v1/rooms/${roomId}/countdown`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      roomId,
      expectedVersion,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(countdownResultSchema).parse(envelope).data;
}

export async function prepareNextGame(
  roomId: string,
  expectedVersion: number,
): Promise<PrepareNextGameResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await gameApiFetch(`/v1/rooms/${roomId}/next-game`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      roomId,
      expectedVersion,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(prepareNextGameResultSchema).parse(envelope).data;
}

export async function endGame(gameId: string): Promise<EndGameResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await gameApiFetch(`/v1/games/${gameId}/end`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      gameId,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(endGameResultSchema).parse(envelope).data;
}

export async function getGameRoutes(gameId: string): Promise<GameRoutesResult> {
  const envelope = await gameApiFetch(`/v1/games/${gameId}/routes`, {
    method: "GET",
  });
  return serverEnvelopeSchema(gameRoutesResultSchema).parse(envelope).data;
}

async function commandRequest(
  path: string,
  body: unknown,
  idempotencyKey: string,
): Promise<RoomCommandResult> {
  const envelope = await gameApiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(roomCommandResultSchema).parse(envelope).data;
}

async function gameApiFetch(path: string, init: RequestInit): Promise<unknown> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new GameApiError(
      "CONFIG_REQUIRED",
      "Supabase 연결 정보가 없습니다. 설정 후 다시 시도해 주세요.",
    );
  }

  const accessToken = await ensureAnonymousSession();
  const response = await fetch(`${supabaseUrl}/functions/v1/game-api${path}`, {
    ...init,
    headers: {
      ...init.headers,
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      throw new GameApiError(
        parsedError.data.code,
        parsedError.data.message,
        parsedError.data.requestId,
      );
    }
    throw new GameApiError("NETWORK_ERROR", "서버 응답을 확인하지 못했습니다.");
  }

  return payload;
}
