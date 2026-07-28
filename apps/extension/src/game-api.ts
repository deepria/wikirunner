import {
  type AbandonRunResult,
  abandonRunResultSchema,
  apiErrorSchema,
  type DisconnectExtensionResult,
  disconnectExtensionResultSchema,
  type NavigationEvent,
  type PairingResult,
  pairingResultSchema,
  type RoomSnapshot,
  roomSnapshotSchema,
  type SubmitNavigationEventsResult,
  serverEnvelopeSchema,
  submitNavigationEventsResultSchema,
} from "@wikirunner/contracts";
import { ensureExtensionSession } from "./supabase";

export interface GeneratedPathArticle {
  key: string;
  title: string;
}

export async function pairExtension(pairingCode: string): Promise<PairingResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await apiFetch("/v1/extension/pair", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      pairingCode,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(pairingResultSchema).parse(envelope).data;
}

export async function disconnectExtension(): Promise<DisconnectExtensionResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await apiFetch("/v1/extension/disconnect", {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(disconnectExtensionResultSchema).parse(envelope).data;
}

export async function getExtensionSnapshot(roomId: string): Promise<RoomSnapshot> {
  const envelope = await apiFetch(`/v1/rooms/${roomId}/snapshot`, {
    method: "GET",
  });
  return serverEnvelopeSchema(roomSnapshotSchema).parse(envelope).data;
}

export async function submitGeneratedRandomPath(input: {
  roomId: string;
  expectedVersion: number;
  generatedPath: GeneratedPathArticle[];
}): Promise<void> {
  const idempotencyKey = crypto.randomUUID();
  const startArticle = input.generatedPath[0];
  const targetArticle = input.generatedPath.at(-1);
  if (!startArticle || !targetArticle) {
    throw new Error("랜덤 경로가 비어 있습니다.");
  }
  await apiFetch(`/v1/rooms/${input.roomId}/generated-path`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      roomId: input.roomId,
      expectedVersion: input.expectedVersion,
      startArticle,
      targetArticle,
      generatedPath: input.generatedPath,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
}

export async function submitNavigationEvent(
  gameId: string,
  runId: string,
  event: NavigationEvent,
  idempotencyKey: string,
): Promise<SubmitNavigationEventsResult> {
  const envelope = await apiFetch(`/v1/games/${gameId}/events`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      gameId,
      runId,
      events: [event],
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(submitNavigationEventsResultSchema).parse(envelope).data;
}

export async function abandonRun(gameId: string, runId: string): Promise<AbandonRunResult> {
  const idempotencyKey = crypto.randomUUID();
  const envelope = await apiFetch(`/v1/games/${gameId}/abandon`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      gameId,
      runId,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
  return serverEnvelopeSchema(abandonRunResultSchema).parse(envelope).data;
}

export async function reportFairPlayViolation(
  gameId: string,
  runId: string,
  type: "search_attempt" | "new_tab",
): Promise<void> {
  const idempotencyKey = crypto.randomUUID();
  await apiFetch(`/v1/games/${gameId}/violations`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey,
      gameId,
      runId,
      type,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
  });
}

async function apiFetch(path: string, init: RequestInit): Promise<unknown> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("확장 프로그램 연결 정보가 설정되지 않았습니다.");
  }

  const accessToken = await ensureExtensionSession();
  const response = await fetch(`${url}/functions/v1/game-api${path}`, {
    ...init,
    headers: {
      ...init.headers,
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new Error(
      parsed.success ? parsed.data.message : "WikiRunner 서버 응답을 확인하지 못했습니다.",
    );
  }
  return payload;
}
