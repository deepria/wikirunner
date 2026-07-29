import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const SCHEMA_VERSION = 1;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, idempotency-key, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
};

const commandSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  idempotencyKey: z.string().uuid(),
});

const createRoomSchema = commandSchema.extend({
  nickname: z.string().trim().min(1).max(20),
  maxPlayers: z.number().int().min(2).max(12),
});

const joinRoomSchema = commandSchema.extend({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/),
  nickname: z.string().trim().min(1).max(20),
});

const updateRoomSettingsSchema = commandSchema
  .extend({
    roomId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    maxPlayers: z.number().int().min(2).max(12),
    startArticle: z.object({
      key: z.string().trim().min(1).max(300),
      title: z.string().trim().min(1).max(300),
    }),
    targetArticle: z.object({
      key: z.string().trim().min(1).max(300),
      title: z.string().trim().min(1).max(300),
    }),
    articleSource: z.enum(["host", "pool", "random"]),
    rankingCriterion: z.enum(["moves", "time"]).default("time"),
  })
  .refine((value) => value.startArticle.key !== value.targetArticle.key, {
    path: ["targetArticle"],
    message: "시작 문서와 목표 문서는 달라야 합니다.",
  });

const issuePairingCodeSchema = commandSchema.extend({
  playerId: z.string().uuid(),
});

const redeemPairingCodeSchema = commandSchema.extend({
  pairingCode: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/[^A-Z0-9]/g, ""))
    .pipe(z.string().length(8)),
});

const disconnectExtensionSchema = commandSchema;

const setReadySchema = commandSchema.extend({
  playerId: z.string().uuid(),
  ready: z.boolean(),
});
const leaveOrKickPlayerSchema = commandSchema.extend({ playerId: z.string().uuid() });

const startCountdownSchema = commandSchema.extend({
  roomId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});

const prepareNextGameSchema = commandSchema.extend({
  roomId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});

const generateRandomPathSchema = commandSchema.extend({
  roomId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  difficulty: z.enum(["easy", "normal", "hard"]).default("easy"),
});

const submitGeneratedRandomPathSchema = commandSchema.extend({
  roomId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  startArticle: z.object({
    key: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(300),
  }),
  targetArticle: z.object({
    key: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(300),
  }),
  generatedPath: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(300),
        title: z.string().trim().min(1).max(300),
      }),
    )
    .min(2)
    .max(9),
});

const endGameSchema = commandSchema.extend({
  gameId: z.string().uuid(),
});

const navigationEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  clientEventId: z.string().uuid(),
  sequence: z.number().int().positive(),
  type: z.enum(["link", "back", "forward", "reload", "direct", "tab_resume"]),
  fromArticleKey: z.string().trim().min(1).max(300),
  toArticleKey: z.string().trim().min(1).max(300),
  clientObservedAt: z.string().datetime({ offset: true }),
  previousHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const submitNavigationEventsSchema = commandSchema.extend({
  gameId: z.string().uuid(),
  runId: z.string().uuid(),
  events: z.array(navigationEventSchema).min(1).max(20),
});

const abandonRunSchema = commandSchema.extend({
  gameId: z.string().uuid(),
  runId: z.string().uuid(),
});

const reportFairPlayViolationSchema = commandSchema.extend({
  gameId: z.string().uuid(),
  runId: z.string().uuid(),
  type: z.enum(["search_attempt", "new_tab"]),
});

const roomIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "ROOM_NOT_FOUND"
  | "GAME_NOT_FOUND"
  | "ROOM_NOT_JOINABLE"
  | "ROOM_NOT_CONFIGURABLE"
  | "ROOM_FULL"
  | "NICKNAME_TAKEN"
  | "ALREADY_IN_ROOM"
  | "HOST_REQUIRED"
  | "VERSION_CONFLICT"
  | "PLAYER_ACCESS_DENIED"
  | "PAIRING_CODE_INVALID"
  | "PAIRING_CODE_EXPIRED"
  | "PAIRING_CODE_USED"
  | "EXTENSION_REQUIRED"
  | "EXTENSION_NOT_CONNECTED"
  | "EXTENSION_DISCONNECT_NOT_ALLOWED"
  | "ROOM_NOT_READYABLE"
  | "ROOM_NOT_LEAVABLE"
  | "HOST_CANNOT_LEAVE"
  | "ROOM_NOT_STARTABLE"
  | "NEXT_GAME_NOT_AVAILABLE"
  | "GAME_NOT_ACTIVE"
  | "ROOM_SETTINGS_REQUIRED"
  | "PLAYERS_NOT_READY"
  | "RANDOM_ROUTE_UNAVAILABLE"
  | "NAMUWIKI_SOURCE_UNAVAILABLE"
  | "RANDOM_REROLL_LIMIT"
  | "RUN_ACCESS_DENIED"
  | "GAME_NOT_STARTED"
  | "RUN_NOT_ACTIVE"
  | "SEQUENCE_GAP"
  | "ARTICLE_CHAIN_MISMATCH"
  | "HASH_CHAIN_MISMATCH"
  | "EVENT_HASH_MISMATCH"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

interface RoomRow {
  id: string;
  invite_code: string;
  host_player_id: string;
  status: "waiting" | "countdown" | "running" | "finished" | "closed";
  max_players: number;
  current_game_id: string | null;
  draft_start_article_key: string | null;
  draft_start_article_title: string | null;
  draft_target_article_key: string | null;
  draft_target_article_title: string | null;
  draft_article_source: "host" | "pool" | "random";
  draft_ranking_criterion: "moves" | "time";
  draft_random_generation_count: number;
  expires_at: string;
  version: number;
}

interface PlayerRow {
  id: string;
  nickname: string;
  ready_at: string | null;
  connection_status: "online" | "offline" | "left";
  extension_connected_at: string | null;
  last_seen_at: string;
  joined_at: string;
}

interface GameRow {
  id: string;
  status: "countdown" | "running" | "finished" | "cancelled";
  scheduled_at: string;
  start_article_key: string;
  start_article_title: string;
  target_article_key: string;
  target_article_title: string;
  article_source: "host" | "pool" | "random";
  ranking_criterion: "moves" | "time";
  generated_path: unknown;
}

interface RunRow {
  id: string;
  player_id: string;
  status: "waiting" | "running" | "finished" | "abandoned" | "flagged" | "disqualified";
  duration_ms: number | null;
  move_count: number | null;
  rank: number | null;
  last_sequence: number;
  last_article_key: string | null;
  last_event_hash: string | null;
  violation_status: "clear" | "warned" | "reviewed";
}

interface GameAccessRow {
  id: string;
  room_id: string;
}

interface RouteRunRow {
  id: string;
  player_id: string;
}

interface NavigationEventRow {
  run_id: string;
  sequence: number;
  event_type: "link" | "back" | "forward" | "reload" | "direct" | "tab_resume";
  from_article_key: string;
  to_article_key: string;
  counts_as_move: boolean;
  server_received_at: string;
  validation_status: "accepted" | "accepted_with_warning";
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("AUTH_REQUIRED", "인증이 필요합니다.", requestId, 401);
    }

    const supabase = createUserClient(authHeader);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse("AUTH_REQUIRED", "인증 세션이 유효하지 않습니다.", requestId, 401);
    }

    const path = routePath(new URL(request.url).pathname);
    let response: Response;

    if (request.method === "POST" && path === "/v1/rooms") {
      response = await createRoom(request, supabase, requestId);
    } else if (request.method === "POST" && path === "/v1/rooms/join") {
      response = await joinRoom(request, supabase, requestId);
    } else if (request.method === "PATCH" && path.match(/^\/v1\/rooms\/[^/]+\/settings$/)) {
      response = await updateRoomSettings(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/rooms\/[^/]+\/random-path$/)) {
      response = await generateRandomPath(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/rooms\/[^/]+\/generated-path$/)) {
      response = await submitGeneratedRandomPath(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/players\/[^/]+\/pairing-code$/)) {
      response = await issuePairingCode(request, path, user.id, supabase, requestId);
    } else if (request.method === "POST" && path === "/v1/extension/pair") {
      response = await redeemPairingCode(request, supabase, requestId);
    } else if (request.method === "POST" && path === "/v1/extension/disconnect") {
      response = await disconnectExtension(request, supabase, requestId);
    } else if (request.method === "PUT" && path.match(/^\/v1\/players\/[^/]+\/ready$/)) {
      response = await setPlayerReady(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/players\/[^/]+\/leave$/)) {
      response = await leaveOrKickPlayer(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/rooms\/[^/]+\/countdown$/)) {
      response = await startCountdown(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/rooms\/[^/]+\/next-game$/)) {
      response = await prepareNextGame(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/games\/[^/]+\/end$/)) {
      response = await endGame(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/games\/[^/]+\/events$/)) {
      response = await submitNavigationEvents(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/games\/[^/]+\/abandon$/)) {
      response = await abandonRun(request, path, supabase, requestId);
    } else if (request.method === "POST" && path.match(/^\/v1\/games\/[^/]+\/violations$/)) {
      response = await reportFairPlayViolation(request, path, supabase, requestId);
    } else if (request.method === "GET" && path.match(/^\/v1\/rooms\/[^/]+\/snapshot$/)) {
      response = await getRoomSnapshot(path, supabase, requestId);
    } else if (request.method === "GET" && path.match(/^\/v1\/games\/[^/]+\/routes$/)) {
      response = await getGameRoutes(path, supabase, requestId);
    } else {
      response = errorResponse(
        "METHOD_NOT_ALLOWED",
        "지원하지 않는 API 경로 또는 메서드입니다.",
        requestId,
        405,
      );
    }

    console.info(
      JSON.stringify({
        requestId,
        method: request.method,
        path,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        requestId,
        code: "INTERNAL_ERROR",
        errorType: error instanceof Error ? error.name : "UnknownError",
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    return errorResponse(
      "INTERNAL_ERROR",
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
      500,
    );
  }
});

function createUserClient(authorization: string): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase function environment is not configured.");
  }

  return createClient(supabaseUrl, publishableKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function issuePairingCode(
  request: Request,
  path: string,
  authUserId: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathPlayerId = path.split("/")[3];
  if (!pathPlayerId || !roomIdPattern.test(pathPlayerId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 플레이어 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, issuePairingCodeSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.playerId !== pathPlayerId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 플레이어 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const secret = pairingSecret();
  const pairingCode = await derivePairingCode(secret, authUserId, input.idempotencyKey);
  const codeHash = await hmacHex(secret, pairingCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("issue_pairing_code", {
    p_player_id: input.playerId,
    p_code_hash: codeHash,
    p_expires_at: expiresAt,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse({
    ...asRecord(data),
    pairingCode,
  });
}

async function redeemPairingCode(
  request: Request,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const input = await parseCommand(request, redeemPairingCodeSchema, requestId);
  if (input instanceof Response) {
    return input;
  }

  const codeHash = await hmacHex(pairingSecret(), input.pairingCode);
  const { data, error } = await supabase.rpc("redeem_pairing_code", {
    p_code_hash: codeHash,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function disconnectExtension(
  request: Request,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const input = await parseCommand(request, disconnectExtensionSchema, requestId);
  if (input instanceof Response) {
    return input;
  }

  const { data, error } = await supabase.rpc("disconnect_extension", {
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function setPlayerReady(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathPlayerId = path.split("/")[3];
  if (!pathPlayerId || !roomIdPattern.test(pathPlayerId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 플레이어 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, setReadySchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.playerId !== pathPlayerId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 플레이어 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("set_player_ready", {
    p_player_id: input.playerId,
    p_ready: input.ready,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function leaveOrKickPlayer(
  request: Request, path: string, supabase: SupabaseClient, requestId: string,
): Promise<Response> {
  const playerId = path.split("/")[3];
  if (!playerId || !roomIdPattern.test(playerId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 플레이어 ID입니다.", requestId, 400);
  }
  const input = await parseCommand(request, leaveOrKickPlayerSchema, requestId);
  if (input instanceof Response) return input;
  if (input.playerId !== playerId) {
    return errorResponse("INVALID_REQUEST", "요청 경로와 본문의 플레이어 ID가 일치하지 않습니다.", requestId, 400);
  }
  const { data, error } = await supabase.rpc("leave_or_kick_player", {
    p_player_id: input.playerId, p_idempotency_key: input.idempotencyKey,
  });
  if (error) return databaseErrorResponse(error, requestId);
  return successResponse(data);
}

async function startCountdown(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathRoomId = path.split("/")[3];
  if (!pathRoomId || !roomIdPattern.test(pathRoomId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 방 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, startCountdownSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.roomId !== pathRoomId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 방 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("start_room_countdown", {
    p_room_id: input.roomId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data, 201);
}

async function prepareNextGame(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathRoomId = path.split("/")[3];
  if (!pathRoomId || !roomIdPattern.test(pathRoomId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 방 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, prepareNextGameSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.roomId !== pathRoomId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 방 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("prepare_next_game", {
    p_room_id: input.roomId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function endGame(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathGameId = path.split("/")[3];
  if (!pathGameId || !roomIdPattern.test(pathGameId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 경기 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, endGameSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.gameId !== pathGameId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 경기 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("end_game", {
    p_game_id: input.gameId,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function submitNavigationEvents(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathGameId = path.split("/")[3];
  if (!pathGameId || !roomIdPattern.test(pathGameId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 경기 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, submitNavigationEventsSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.gameId !== pathGameId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 경기 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const events = input.events.map((event) => ({
    ...event,
    clientObservedAt: new Date(event.clientObservedAt).toISOString(),
  }));
  const { data, error } = await supabase.rpc("submit_navigation_events", {
    p_game_id: input.gameId,
    p_run_id: input.runId,
    p_events: events,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function abandonRun(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathGameId = path.split("/")[3];
  if (!pathGameId || !roomIdPattern.test(pathGameId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 경기 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, abandonRunSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.gameId !== pathGameId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 경기 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("abandon_run", {
    p_game_id: input.gameId,
    p_run_id: input.runId,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function reportFairPlayViolation(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathGameId = path.split("/")[3];
  if (!pathGameId || !roomIdPattern.test(pathGameId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 경기 ID입니다.", requestId, 400);
  }
  const input = await parseCommand(request, reportFairPlayViolationSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.gameId !== pathGameId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 경기 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }
  const { data, error } = await supabase.rpc("report_fair_play_violation", {
    p_game_id: input.gameId,
    p_run_id: input.runId,
    p_type: input.type,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return databaseErrorResponse(error, requestId);
  }
  return successResponse(data);
}

async function updateRoomSettings(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathRoomId = path.split("/")[3];
  if (!pathRoomId || !roomIdPattern.test(pathRoomId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 방 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, updateRoomSettingsSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.roomId !== pathRoomId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 방 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("update_room_settings", {
    p_room_id: input.roomId,
    p_expected_version: input.expectedVersion,
    p_max_players: input.maxPlayers,
    p_start_article_key: input.startArticle.key,
    p_start_article_title: input.startArticle.title,
    p_target_article_key: input.targetArticle.key,
    p_target_article_title: input.targetArticle.title,
    p_article_source: input.articleSource,
    p_ranking_criterion: input.rankingCriterion,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function generateRandomPath(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathRoomId = path.split("/")[3];
  if (!pathRoomId || !roomIdPattern.test(pathRoomId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 방 ID입니다.", requestId, 400);
  }

  const input = await parseCommand(request, generateRandomPathSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.roomId !== pathRoomId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 방 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  let generatedPath: Article[];
  try {
    generatedPath = await generateNamuWikiPath(input.difficulty);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error(
      JSON.stringify({
        requestId,
        operation: "generate_random_path",
        reason,
      }),
    );
    if (reason !== "path_not_found") {
      return errorResponse(
        "NAMUWIKI_SOURCE_UNAVAILABLE",
        "나무위키가 현재 경로 생성 요청에 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.",
        requestId,
        502,
      );
    }
    return errorResponse(
      "RANDOM_ROUTE_UNAVAILABLE",
      "지금은 랜덤 경로를 찾지 못했습니다. 다시 추첨해 주세요.",
      requestId,
      503,
    );
  }

  const startArticle = generatedPath[0];
  const targetArticle = generatedPath.at(-1);
  if (!startArticle || !targetArticle) {
    return errorResponse(
      "RANDOM_ROUTE_UNAVAILABLE",
      "지금은 랜덤 경로를 찾지 못했습니다. 다시 추첨해 주세요.",
      requestId,
      503,
    );
  }

  const { data, error } = await supabase.rpc("set_random_room_path", {
    p_room_id: input.roomId,
    p_expected_version: input.expectedVersion,
    p_start_article_key: startArticle.key,
    p_start_article_title: startArticle.title,
    p_target_article_key: targetArticle.key,
    p_target_article_title: targetArticle.title,
    p_generated_path: generatedPath,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data);
}

async function submitGeneratedRandomPath(
  request: Request,
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const pathRoomId = path.split("/")[3];
  if (!pathRoomId || !roomIdPattern.test(pathRoomId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 방 ID입니다.", requestId, 400);
  }
  const input = await parseCommand(request, submitGeneratedRandomPathSchema, requestId);
  if (input instanceof Response) {
    return input;
  }
  if (input.roomId !== pathRoomId) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 경로와 본문의 방 ID가 일치하지 않습니다.",
      requestId,
      400,
    );
  }
  if (
    input.generatedPath[0]?.key !== input.startArticle.key ||
    input.generatedPath.at(-1)?.key !== input.targetArticle.key
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "생성 경로의 시작·목표 문서가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  const { data, error } = await supabase.rpc("set_random_room_path", {
    p_room_id: input.roomId,
    p_expected_version: input.expectedVersion,
    p_start_article_key: input.startArticle.key,
    p_start_article_title: input.startArticle.title,
    p_target_article_key: input.targetArticle.key,
    p_target_article_title: input.targetArticle.title,
    p_generated_path: input.generatedPath,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    return databaseErrorResponse(error, requestId);
  }
  return successResponse(data);
}

type Article = { key: string; title: string };
type RandomDifficulty = "easy" | "normal" | "hard";

const NAMUWIKI_ORIGIN = "https://namu.wiki";
const NAMUWIKI_ARTICLE_PREFIX = "/w/";
const RANDOM_PATH_DEPTHS: Record<RandomDifficulty, readonly number[]> = {
  easy: [3, 4],
  normal: [5, 6],
  hard: [7, 8],
};

async function generateNamuWikiPath(difficulty: RandomDifficulty): Promise<Article[]> {
  const targetDepth = pickRandom(RANDOM_PATH_DEPTHS[difficulty]);
  let lastFailure = "path_not_found";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const start = await fetchRandomNamuWikiArticle();
      const path = [start];
      const seenKeys = new Set([start.key]);
      let current = start;

      for (let step = 0; step < targetDepth; step += 1) {
        const links = await fetchNamuWikiLinks(current);
        const nextCandidates = links.filter((article) => !seenKeys.has(article.key));
        if (nextCandidates.length === 0) {
          break;
        }
        current = pickRandom(nextCandidates);
        path.push(current);
        seenKeys.add(current.key);
      }

      if (path.length === targetDepth + 1 && path[0].key !== path.at(-1)?.key) {
        return path;
      }
    } catch (error) {
      // 개별 문서 오류나 임시 차단은 다음 랜덤 출발지에서 다시 시도한다.
      lastFailure = error instanceof Error ? error.message : lastFailure;
    }
  }

  throw new Error(lastFailure);
}

async function fetchRandomNamuWikiArticle(): Promise<Article> {
  const response = await fetch(`${NAMUWIKI_ORIGIN}/random`, {
    redirect: "follow",
    headers: { "User-Agent": "WikiRunner/0.1 (random path generator)" },
  });
  if (!response.ok) {
    throw new Error(`random_page_${response.status}`);
  }
  const article = articleFromUrl(response.url);
  if (!article) {
    throw new Error("random_page_not_article");
  }
  return article;
}

async function fetchNamuWikiLinks(article: Article): Promise<Article[]> {
  const response = await fetch(`${NAMUWIKI_ORIGIN}/w/${encodeURIComponent(article.key)}`, {
    headers: { "User-Agent": "WikiRunner/0.1 (random path generator)" },
  });
  if (!response.ok) {
    throw new Error(`article_${response.status}`);
  }
  const html = await response.text();
  const links = new Map<string, Article>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const candidate = articleFromHref(match[1]);
    if (candidate) {
      links.set(candidate.key, candidate);
    }
  }
  return [...links.values()];
}

function articleFromHref(href: string): Article | null {
  try {
    return articleFromUrl(new URL(href.replaceAll("&amp;", "&"), NAMUWIKI_ORIGIN).toString());
  } catch {
    return null;
  }
}

function articleFromUrl(rawUrl: string): Article | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== NAMUWIKI_ORIGIN || !url.pathname.startsWith(NAMUWIKI_ARTICLE_PREFIX)) {
      return null;
    }
    const key = decodeURIComponent(url.pathname.slice(NAMUWIKI_ARTICLE_PREFIX.length)).normalize(
      "NFC",
    );
    if (!key || key.includes(":")) {
      return null;
    }
    return { key, title: key };
  } catch {
    return null;
  }
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function createRoom(
  request: Request,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const input = await parseCommand(request, createRoomSchema, requestId);
  if (input instanceof Response) {
    return input;
  }

  const { data, error } = await supabase.rpc("create_room", {
    p_nickname: input.nickname,
    p_max_players: input.maxPlayers,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data, 201);
}

async function joinRoom(
  request: Request,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const input = await parseCommand(request, joinRoomSchema, requestId);
  if (input instanceof Response) {
    return input;
  }

  const { data, error } = await supabase.rpc("join_room", {
    p_invite_code: input.inviteCode,
    p_nickname: input.nickname,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return databaseErrorResponse(error, requestId);
  }

  return successResponse(data, 200);
}

async function getRoomSnapshot(
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const roomId = path.split("/")[3];
  if (!roomId || !roomIdPattern.test(roomId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 방 ID입니다.", requestId, 400);
  }

  const roomResult = await supabase
    .from("rooms")
    .select(
      [
        "id",
        "invite_code",
        "host_player_id",
        "status",
        "max_players",
        "current_game_id",
        "draft_start_article_key",
        "draft_start_article_title",
        "draft_target_article_key",
        "draft_target_article_title",
        "draft_article_source",
        "draft_ranking_criterion",
        "draft_random_generation_count",
        "expires_at",
        "version",
      ].join(","),
    )
    .eq("id", roomId)
    .maybeSingle<RoomRow>();

  if (roomResult.error) {
    return databaseErrorResponse(roomResult.error, requestId);
  }
  if (!roomResult.data) {
    return errorResponse("ROOM_NOT_FOUND", "방을 찾을 수 없습니다.", requestId, 404);
  }

  const playersResult = await supabase
    .from("players")
    .select("id,nickname,ready_at,connection_status,extension_connected_at,last_seen_at,joined_at")
    .eq("room_id", roomId)
    .neq("connection_status", "left")
    .order("joined_at", { ascending: true })
    .returns<PlayerRow[]>();

  if (playersResult.error) {
    return databaseErrorResponse(playersResult.error, requestId);
  }

  const playerIds = (playersResult.data ?? []).map((player) => player.id);
  const { data: authData, error: authLookupError } = await supabase.auth.getUser();
  if (authLookupError || !authData.user) {
    return errorResponse("AUTH_REQUIRED", "인증 세션이 유효하지 않습니다.", requestId, 401);
  }
  const identitiesResult =
    playerIds.length > 0
      ? await supabase
          .from("player_identities")
          .select("player_id")
          .eq("auth_user_id", authData.user.id)
          .in("player_id", playerIds)
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };

  if (identitiesResult.error) {
    return databaseErrorResponse(identitiesResult.error, requestId);
  }

  const room = roomResult.data;
  const ownPlayerId =
    identitiesResult.data && typeof identitiesResult.data.player_id === "string"
      ? identitiesResult.data.player_id
      : null;

  let game: GameRow | null = null;
  let runs: RunRow[] = [];
  if (room.current_game_id) {
    const gameResult = await supabase
      .from("games")
      .select(
        "id,status,scheduled_at,start_article_key,start_article_title,target_article_key,target_article_title,article_source,ranking_criterion,generated_path",
      )
      .eq("id", room.current_game_id)
      .maybeSingle<GameRow>();

    if (gameResult.error) {
      return databaseErrorResponse(gameResult.error, requestId);
    }
    game = gameResult.data;

    const runsResult = await supabase
      .from("runs")
      .select(
        "id,player_id,status,duration_ms,move_count,rank,last_sequence,last_article_key,last_event_hash,violation_status",
      )
      .eq("game_id", room.current_game_id)
      .order("rank", { ascending: true, nullsFirst: false })
      .returns<RunRow[]>();

    if (runsResult.error) {
      return databaseErrorResponse(runsResult.error, requestId);
    }
    runs = runsResult.data ?? [];
  }

  const playersById = new Map(
    (playersResult.data ?? []).map((player) => [player.id, player] as const),
  );

  return successResponse({
    room: {
      id: room.id,
      inviteCode: room.invite_code.trim(),
      hostPlayerId: room.host_player_id,
      status: room.status,
      maxPlayers: room.max_players,
      currentGameId: room.current_game_id,
      version: room.version,
      expiresAt: room.expires_at,
      draftSettings:
        room.draft_start_article_key &&
        room.draft_start_article_title &&
        room.draft_target_article_key &&
        room.draft_target_article_title
          ? {
              startArticle: {
                key: room.draft_start_article_key,
                title: room.draft_start_article_title,
              },
              targetArticle: {
                key: room.draft_target_article_key,
                title: room.draft_target_article_title,
              },
              articleSource: room.draft_article_source,
              rankingCriterion: room.draft_ranking_criterion,
              randomGenerationCount: room.draft_random_generation_count,
            }
          : null,
    },
    game: game
      ? {
          id: game.id,
          status: game.status,
          scheduledAt: game.scheduled_at,
          startArticle: {
            key: game.start_article_key,
            title: game.start_article_title,
          },
          targetArticle: {
            key: game.target_article_key,
            title: game.target_article_title,
          },
          rankingCriterion: game.ranking_criterion ?? "time",
          generatedPath:
            (game.status === "finished" || game.status === "cancelled") &&
            game.article_source === "random"
              ? parseGeneratedPath(game.generated_path)
              : null,
        }
      : null,
    players: (playersResult.data ?? []).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      readyAt: player.ready_at,
      extensionConnected: player.extension_connected_at !== null,
      connectionStatus: player.connection_status,
      lastSeenAt: player.last_seen_at,
      joinedAt: player.joined_at,
      isHost: player.id === room.host_player_id,
      isCurrentPlayer: player.id === ownPlayerId,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      playerId: run.player_id,
      nickname: playersById.get(run.player_id)?.nickname ?? "알 수 없음",
      status: run.status,
      durationMs: run.duration_ms,
      moveCount: run.move_count ?? 0,
      rank: run.rank,
      lastSequence: run.last_sequence,
      lastArticleKey: run.last_article_key,
      lastEventHash: run.player_id === ownPlayerId ? run.last_event_hash : null,
      violationStatus: run.violation_status,
      isCurrentPlayer: run.player_id === ownPlayerId,
    })),
  });
}

function parseGeneratedPath(value: unknown): Article[] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const articles: Article[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as Article).key !== "string" ||
      typeof (item as Article).title !== "string"
    ) {
      return null;
    }
    const key = (item as Article).key.trim().normalize("NFC");
    const title = (item as Article).title.trim().normalize("NFC");
    if (!key || !title) {
      return null;
    }
    articles.push({ key, title });
  }
  return articles;
}

async function getGameRoutes(
  path: string,
  supabase: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const gameId = path.split("/")[3];
  if (!gameId || !roomIdPattern.test(gameId)) {
    return errorResponse("INVALID_REQUEST", "올바르지 않은 경기 ID입니다.", requestId, 400);
  }

  const gameResult = await supabase
    .from("games")
    .select("id,room_id")
    .eq("id", gameId)
    .maybeSingle<GameAccessRow>();

  if (gameResult.error) {
    return databaseErrorResponse(gameResult.error, requestId);
  }
  if (!gameResult.data) {
    return errorResponse("GAME_NOT_FOUND", "경기를 찾을 수 없습니다.", requestId, 404);
  }

  const runsResult = await supabase
    .from("runs")
    .select("id,player_id")
    .eq("game_id", gameId)
    .order("id", { ascending: true })
    .returns<RouteRunRow[]>();

  if (runsResult.error) {
    return databaseErrorResponse(runsResult.error, requestId);
  }

  const runs = runsResult.data ?? [];
  const runIds = runs.map((run) => run.id);
  const eventsResult =
    runIds.length > 0
      ? await supabase
          .from("navigation_events")
          .select(
            "run_id,sequence,event_type,from_article_key,to_article_key,counts_as_move,server_received_at,validation_status",
          )
          .in("run_id", runIds)
          .order("sequence", { ascending: true })
          .returns<NavigationEventRow[]>()
      : { data: [] as NavigationEventRow[], error: null };

  if (eventsResult.error) {
    return databaseErrorResponse(eventsResult.error, requestId);
  }

  const eventsByRun = new Map<string, NavigationEventRow[]>();
  for (const event of eventsResult.data ?? []) {
    const runEvents = eventsByRun.get(event.run_id) ?? [];
    runEvents.push(event);
    eventsByRun.set(event.run_id, runEvents);
  }

  return successResponse({
    gameId,
    routes: runs.map((run) => ({
      runId: run.id,
      playerId: run.player_id,
      steps: (eventsByRun.get(run.id) ?? []).map((event) => ({
        sequence: event.sequence,
        eventType: event.event_type,
        fromArticleKey: event.from_article_key,
        toArticleKey: event.to_article_key,
        countsAsMove: event.counts_as_move,
        serverReceivedAt: event.server_received_at,
        validationStatus: event.validation_status,
      })),
    })),
  });
}

function pairingSecret(): string {
  const secret = Deno.env.get("PAIRING_CODE_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("PAIRING_CODE_SECRET must contain at least 32 characters.");
  }
  return secret;
}

async function derivePairingCode(
  secret: string,
  authUserId: string,
  idempotencyKey: string,
): Promise<string> {
  const digest = await hmacBytes(secret, `${authUserId}:${idempotencyKey}`);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...digest.slice(0, 8)].map((value) => alphabet[value % alphabet.length]).join("");
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const digest = await hmacBytes(secret, value);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacBytes(secret: string, value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function parseCommand<T extends z.ZodType<{ idempotencyKey: string }>>(
  request: Request,
  schema: T,
  requestId: string,
): Promise<z.infer<T> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "JSON 요청 본문이 필요합니다.", requestId, 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      parsed.error.issues[0]?.message ?? "요청 값이 올바르지 않습니다.",
      requestId,
      400,
    );
  }

  const headerKey = request.headers.get("Idempotency-Key");
  if (!headerKey) {
    return errorResponse(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key 헤더가 필요합니다.",
      requestId,
      400,
    );
  }
  if (headerKey !== parsed.data.idempotencyKey) {
    return errorResponse(
      "INVALID_REQUEST",
      "요청 본문과 헤더의 멱등키가 일치하지 않습니다.",
      requestId,
      400,
    );
  }

  return parsed.data;
}

function routePath(pathname: string): string {
  const marker = "/game-api";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) {
    return pathname;
  }
  return pathname.slice(markerIndex + marker.length) || "/";
}

function successResponse(data: unknown, status = 200): Response {
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      serverNow: new Date().toISOString(),
      data,
    },
    {
      status,
      headers: corsHeaders,
    },
  );
}

function errorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  status: number,
): Response {
  return Response.json(
    { code, message, requestId },
    {
      status,
      headers: corsHeaders,
    },
  );
}

function databaseErrorResponse(
  error: { code?: string; message: string },
  requestId: string,
): Response {
  const knownErrors: Record<string, { code: ApiErrorCode; message: string; status: number }> = {
    ROOM_NOT_FOUND: {
      code: "ROOM_NOT_FOUND",
      message: "방을 찾을 수 없습니다.",
      status: 404,
    },
    GAME_NOT_FOUND: {
      code: "GAME_NOT_FOUND",
      message: "경기를 찾을 수 없습니다.",
      status: 404,
    },
    ROOM_NOT_JOINABLE: {
      code: "ROOM_NOT_JOINABLE",
      message: "현재 입장할 수 없는 방입니다.",
      status: 409,
    },
    ROOM_NOT_CONFIGURABLE: {
      code: "ROOM_NOT_CONFIGURABLE",
      message: "현재 설정을 변경할 수 없는 방입니다.",
      status: 409,
    },
    ROOM_FULL: {
      code: "ROOM_FULL",
      message: "방의 정원이 가득 찼습니다.",
      status: 409,
    },
    ALREADY_IN_ROOM: {
      code: "ALREADY_IN_ROOM",
      message: "이미 이 방에 참가하고 있습니다.",
      status: 409,
    },
    HOST_REQUIRED: {
      code: "HOST_REQUIRED",
      message: "방장만 변경할 수 있습니다.",
      status: 403,
    },
    VERSION_CONFLICT: {
      code: "VERSION_CONFLICT",
      message: "대기실 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      status: 409,
    },
    PLAYER_ACCESS_DENIED: {
      code: "PLAYER_ACCESS_DENIED",
      message: "이 플레이어를 변경할 권한이 없습니다.",
      status: 403,
    },
    PAIRING_CODE_INVALID: {
      code: "PAIRING_CODE_INVALID",
      message: "페어링 코드가 올바르지 않습니다.",
      status: 404,
    },
    PAIRING_CODE_EXPIRED: {
      code: "PAIRING_CODE_EXPIRED",
      message: "페어링 코드가 만료되었습니다. 웹에서 새 코드를 발급해 주세요.",
      status: 409,
    },
    PAIRING_CODE_USED: {
      code: "PAIRING_CODE_USED",
      message: "이미 사용된 페어링 코드입니다.",
      status: 409,
    },
    EXTENSION_REQUIRED: {
      code: "EXTENSION_REQUIRED",
      message: "확장 프로그램을 연결한 뒤 준비할 수 있습니다.",
      status: 409,
    },
    EXTENSION_NOT_CONNECTED: {
      code: "EXTENSION_NOT_CONNECTED",
      message: "현재 연결된 확장 프로그램이 없습니다.",
      status: 409,
    },
    EXTENSION_DISCONNECT_NOT_ALLOWED: {
      code: "EXTENSION_DISCONNECT_NOT_ALLOWED",
      message: "경기가 시작된 뒤에는 연동을 해제할 수 없습니다.",
      status: 409,
    },
    ROOM_NOT_READYABLE: {
      code: "ROOM_NOT_READYABLE",
      message: "현재 준비 상태를 변경할 수 없습니다.",
      status: 409,
    },
    ROOM_NOT_STARTABLE: {
      code: "ROOM_NOT_STARTABLE",
      message: "현재 카운트다운을 시작할 수 없습니다.",
      status: 409,
    },
    NEXT_GAME_NOT_AVAILABLE: {
      code: "NEXT_GAME_NOT_AVAILABLE",
      message: "종료된 경기에서만 다음 경기를 준비할 수 있습니다.",
      status: 409,
    },
    GAME_NOT_ACTIVE: {
      code: "GAME_NOT_ACTIVE",
      message: "현재 진행 중인 경기가 아닙니다.",
      status: 409,
    },
    ROOM_SETTINGS_REQUIRED: {
      code: "ROOM_SETTINGS_REQUIRED",
      message: "시작 문서와 목표 문서를 먼저 설정해 주세요.",
      status: 409,
    },
    PLAYERS_NOT_READY: {
      code: "PLAYERS_NOT_READY",
      message: "모든 참가자가 확장 프로그램을 연결하고 준비해야 합니다.",
      status: 409,
    },
    RANDOM_REROLL_LIMIT: {
      code: "RANDOM_REROLL_LIMIT",
      message: "이번 경기 준비에서는 랜덤 추첨을 10회까지 할 수 있습니다.",
      status: 409,
    },
    INVALID_RANDOM_PATH: {
      code: "INVALID_REQUEST",
      message: "생성된 랜덤 경로가 올바르지 않습니다. 다시 추첨해 주세요.",
      status: 400,
    },
    RANDOM_PATH_REQUIRED: {
      code: "INVALID_REQUEST",
      message: "랜덤 경로를 먼저 추첨해 주세요.",
      status: 400,
    },
    RUN_ACCESS_DENIED: {
      code: "RUN_ACCESS_DENIED",
      message: "이 경기 기록을 제출할 권한이 없습니다.",
      status: 403,
    },
    GAME_NOT_STARTED: {
      code: "GAME_NOT_STARTED",
      message: "아직 경기가 시작되지 않았습니다.",
      status: 409,
    },
    RUN_NOT_ACTIVE: {
      code: "RUN_NOT_ACTIVE",
      message: "이미 종료되었거나 진행할 수 없는 경기입니다.",
      status: 409,
    },
    SEQUENCE_GAP: {
      code: "SEQUENCE_GAP",
      message: "이동 기록 순서가 맞지 않습니다. 경기 상태를 다시 동기화합니다.",
      status: 422,
    },
    ARTICLE_CHAIN_MISMATCH: {
      code: "ARTICLE_CHAIN_MISMATCH",
      message: "이동 전 문서가 서버 기록과 다릅니다. 경기 상태를 다시 동기화합니다.",
      status: 422,
    },
    HASH_CHAIN_MISMATCH: {
      code: "HASH_CHAIN_MISMATCH",
      message: "이동 기록 연결 정보가 맞지 않습니다. 경기 상태를 다시 동기화합니다.",
      status: 422,
    },
    EVENT_HASH_MISMATCH: {
      code: "EVENT_HASH_MISMATCH",
      message: "이동 기록 무결성을 확인하지 못했습니다.",
      status: 422,
    },
    ARTICLES_MUST_DIFFER: {
      code: "INVALID_REQUEST",
      message: "시작 문서와 목표 문서는 달라야 합니다.",
      status: 400,
    },
    MAX_PLAYERS_BELOW_CURRENT: {
      code: "INVALID_REQUEST",
      message: "현재 참가자 수보다 정원을 작게 설정할 수 없습니다.",
      status: 400,
    },
    IDEMPOTENCY_KEY_REUSED: {
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "이미 다른 요청에 사용된 멱등키입니다.",
      status: 409,
    },
  };

  for (const [databaseMessage, mapped] of Object.entries(knownErrors)) {
    if (error.message.includes(databaseMessage)) {
      return errorResponse(mapped.code, mapped.message, requestId, mapped.status);
    }
  }

  if (error.code === "23505" && error.message.includes("players_room_id_nickname_key")) {
    return errorResponse(
      "NICKNAME_TAKEN",
      "같은 방에서 이미 사용 중인 닉네임입니다.",
      requestId,
      409,
    );
  }

  console.error(
    JSON.stringify({
      requestId,
      databaseCode: error.code ?? "unknown",
      databaseErrorType: "PostgrestError",
    }),
  );
  return errorResponse(
    "INTERNAL_ERROR",
    "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    requestId,
    500,
  );
}
