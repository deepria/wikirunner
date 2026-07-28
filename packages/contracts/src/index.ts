import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const ROOM_STATUSES = ["waiting", "countdown", "running", "finished", "closed"] as const;
export const GAME_STATUSES = ["countdown", "running", "finished", "cancelled"] as const;
export const RUN_STATUSES = [
  "waiting",
  "running",
  "finished",
  "abandoned",
  "flagged",
  "disqualified",
] as const;
export const CONNECTION_STATUSES = ["online", "offline", "left"] as const;
export const VIOLATION_STATUSES = ["clear", "warned", "reviewed"] as const;
export const NAVIGATION_EVENT_TYPES = [
  "link",
  "back",
  "forward",
  "reload",
  "direct",
  "tab_resume",
] as const;
export const ARTICLE_SOURCES = ["host", "pool", "random"] as const;
export const RANDOM_DIFFICULTIES = ["easy", "normal", "hard"] as const;

export const roomStatusSchema = z.enum(ROOM_STATUSES);
export const gameStatusSchema = z.enum(GAME_STATUSES);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);
export const violationStatusSchema = z.enum(VIOLATION_STATUSES);
export const navigationEventTypeSchema = z.enum(NAVIGATION_EVENT_TYPES);
export const articleSourceSchema = z.enum(ARTICLE_SOURCES);
export const randomDifficultySchema = z.enum(RANDOM_DIFFICULTIES);

export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export type ViolationStatus = z.infer<typeof violationStatusSchema>;
export type NavigationEventType = z.infer<typeof navigationEventTypeSchema>;
export type ArticleSource = z.infer<typeof articleSourceSchema>;
export type RandomDifficulty = z.infer<typeof randomDifficultySchema>;

const idSchema = z.string().uuid();
const instantSchema = z.string().datetime({ offset: true });
const articleKeySchema = z.string().trim().min(1).max(300);
const articleTitleSchema = z.string().trim().min(1).max(300);

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/);

export const nicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .refine((value) => !/[\p{C}]/u.test(value), "제어 문자는 사용할 수 없습니다.");

export const commandMetaSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  idempotencyKey: z.string().uuid(),
});

export const articleSchema = z.object({
  key: articleKeySchema,
  title: articleTitleSchema,
});

export const createRoomCommandSchema = commandMetaSchema.extend({
  nickname: nicknameSchema,
  maxPlayers: z.number().int().min(2).max(12).default(4),
});

export const joinRoomCommandSchema = commandMetaSchema.extend({
  inviteCode: roomCodeSchema,
  nickname: nicknameSchema,
});

export const updateRoomSettingsCommandSchema = commandMetaSchema
  .extend({
    roomId: idSchema,
    expectedVersion: z.number().int().nonnegative(),
    maxPlayers: z.number().int().min(2).max(12),
    startArticle: articleSchema,
    targetArticle: articleSchema,
    articleSource: articleSourceSchema,
  })
  .refine((value) => value.startArticle.key !== value.targetArticle.key, {
    message: "시작 문서와 목표 문서는 달라야 합니다.",
    path: ["targetArticle"],
  });

export const generateRandomPathCommandSchema = commandMetaSchema.extend({
  roomId: idSchema,
  expectedVersion: z.number().int().positive(),
  difficulty: randomDifficultySchema.default("easy"),
});

export const pairingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => value.replace(/[^A-Z0-9]/g, ""))
  .pipe(z.string().length(8));

export const issuePairingCodeCommandSchema = commandMetaSchema.extend({
  playerId: idSchema,
});

export const redeemPairingCodeCommandSchema = commandMetaSchema.extend({
  pairingCode: pairingCodeSchema,
});

export const disconnectExtensionCommandSchema = commandMetaSchema;

export const setPlayerReadyCommandSchema = commandMetaSchema.extend({
  playerId: idSchema,
  ready: z.boolean(),
});

export const startCountdownCommandSchema = commandMetaSchema.extend({
  roomId: idSchema,
  expectedVersion: z.number().int().positive(),
});

export const prepareNextGameCommandSchema = commandMetaSchema.extend({
  roomId: idSchema,
  expectedVersion: z.number().int().positive(),
});

export const endGameCommandSchema = commandMetaSchema.extend({
  gameId: idSchema,
});

export const abandonRunCommandSchema = commandMetaSchema.extend({
  gameId: idSchema,
  runId: idSchema,
});

export const navigationEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  clientEventId: idSchema,
  sequence: z.number().int().positive(),
  type: navigationEventTypeSchema,
  fromArticleKey: articleKeySchema,
  toArticleKey: articleKeySchema,
  clientObservedAt: instantSchema,
  previousHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const submitNavigationEventsCommandSchema = commandMetaSchema.extend({
  gameId: idSchema,
  runId: idSchema,
  events: z.array(navigationEventSchema).min(1).max(20),
});

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
  currentVersion: z.number().int().nonnegative().optional(),
});

export const serverEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    serverNow: instantSchema,
    data,
  });

export const roomSummarySchema = z.object({
  id: idSchema,
  inviteCode: roomCodeSchema,
  status: roomStatusSchema,
  maxPlayers: z.number().int().min(2).max(12),
  hostPlayerId: idSchema,
  version: z.number().int().positive(),
});

export const playerSummarySchema = z.object({
  id: idSchema,
  nickname: nicknameSchema,
  connectionStatus: connectionStatusSchema,
  isHost: z.boolean(),
});

export const roomCommandResultSchema = z.object({
  room: roomSummarySchema,
  player: playerSummarySchema,
});

export const roomSettingsResultSchema = z.object({
  room: roomSummarySchema,
});

export const pairingCodeResultSchema = z.object({
  pairingCodeId: idSchema,
  playerId: idSchema,
  pairingCode: pairingCodeSchema,
  expiresAt: instantSchema,
});

export const pairingResultSchema = z.object({
  roomId: idSchema,
  playerId: idSchema,
  pairedAt: instantSchema,
});

export const disconnectExtensionResultSchema = z.object({
  roomId: idSchema,
  playerId: idSchema,
  disconnectedAt: instantSchema,
});

export const readyResultSchema = z.object({
  playerId: idSchema,
  readyAt: instantSchema.nullable(),
});

export const gameSummarySchema = z.object({
  id: idSchema,
  status: gameStatusSchema,
  scheduledAt: instantSchema,
  startArticle: articleSchema,
  targetArticle: articleSchema,
  generatedPath: z.array(articleSchema).min(2).nullable().optional(),
});

export const countdownResultSchema = z.object({
  game: gameSummarySchema.extend({
    roomId: idSchema,
  }),
  roomVersion: z.number().int().positive(),
});

export const prepareNextGameResultSchema = z.object({
  roomId: idSchema,
  status: z.literal("waiting"),
  roomVersion: z.number().int().positive(),
});

export const endGameResultSchema = z.object({
  gameId: idSchema,
  gameStatus: gameStatusSchema,
  roomStatus: roomStatusSchema,
  endedAt: instantSchema,
});

export const runSummarySchema = z.object({
  id: idSchema,
  playerId: idSchema,
  nickname: nicknameSchema,
  status: runStatusSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  moveCount: z.number().int().nonnegative().nullable(),
  rank: z.number().int().positive().nullable(),
  lastSequence: z.number().int().nonnegative(),
  lastArticleKey: articleKeySchema.nullable(),
  lastEventHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  violationStatus: violationStatusSchema,
  isCurrentPlayer: z.boolean(),
});

export const navigationEventAckSchema = z.object({
  clientEventId: idSchema,
  sequence: z.number().int().positive(),
  validationStatus: z.enum(["accepted", "accepted_with_warning"]),
  serverReceivedAt: instantSchema,
});

export const submitNavigationEventsResultSchema = z.object({
  events: z.array(navigationEventAckSchema).min(1).max(20),
  run: runSummarySchema.omit({ nickname: true, isCurrentPlayer: true }),
  leaderboard: z.array(runSummarySchema),
});

export const abandonRunResultSchema = z.object({
  runId: idSchema,
  status: z.literal("abandoned"),
  abandonedAt: instantSchema,
  gameStatus: gameStatusSchema,
  roomStatus: roomStatusSchema,
});

export const navigationRouteStepSchema = z.object({
  sequence: z.number().int().positive(),
  eventType: navigationEventTypeSchema,
  fromArticleKey: articleKeySchema,
  toArticleKey: articleKeySchema,
  countsAsMove: z.boolean(),
  serverReceivedAt: instantSchema,
  validationStatus: z.enum(["accepted", "accepted_with_warning"]),
});

export const gameRoutesResultSchema = z.object({
  gameId: idSchema,
  routes: z.array(
    z.object({
      runId: idSchema,
      playerId: idSchema,
      steps: z.array(navigationRouteStepSchema),
    }),
  ),
});

export const roomSnapshotSchema = z.object({
  room: roomSummarySchema.extend({
    currentGameId: idSchema.nullable(),
    expiresAt: instantSchema,
    draftSettings: z
      .object({
        startArticle: articleSchema,
        targetArticle: articleSchema,
        articleSource: articleSourceSchema,
        randomGenerationCount: z.number().int().min(0).max(10),
      })
      .nullable(),
  }),
  game: gameSummarySchema.nullable(),
  players: z.array(
    playerSummarySchema.extend({
      readyAt: instantSchema.nullable(),
      extensionConnected: z.boolean(),
      lastSeenAt: instantSchema,
      joinedAt: instantSchema,
      isCurrentPlayer: z.boolean(),
    }),
  ),
  runs: z.array(runSummarySchema),
});

export type CreateRoomCommand = z.infer<typeof createRoomCommandSchema>;
export type JoinRoomCommand = z.infer<typeof joinRoomCommandSchema>;
export type UpdateRoomSettingsCommand = z.infer<typeof updateRoomSettingsCommandSchema>;
export type GenerateRandomPathCommand = z.infer<typeof generateRandomPathCommandSchema>;
export type IssuePairingCodeCommand = z.infer<typeof issuePairingCodeCommandSchema>;
export type RedeemPairingCodeCommand = z.infer<typeof redeemPairingCodeCommandSchema>;
export type DisconnectExtensionCommand = z.infer<typeof disconnectExtensionCommandSchema>;
export type SetPlayerReadyCommand = z.infer<typeof setPlayerReadyCommandSchema>;
export type StartCountdownCommand = z.infer<typeof startCountdownCommandSchema>;
export type PrepareNextGameCommand = z.infer<typeof prepareNextGameCommandSchema>;
export type EndGameCommand = z.infer<typeof endGameCommandSchema>;
export type AbandonRunCommand = z.infer<typeof abandonRunCommandSchema>;
export type NavigationEvent = z.infer<typeof navigationEventSchema>;
export type SubmitNavigationEventsCommand = z.infer<typeof submitNavigationEventsCommandSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export type PlayerSummary = z.infer<typeof playerSummarySchema>;
export type RoomCommandResult = z.infer<typeof roomCommandResultSchema>;
export type RoomSettingsResult = z.infer<typeof roomSettingsResultSchema>;
export type PairingCodeResult = z.infer<typeof pairingCodeResultSchema>;
export type PairingResult = z.infer<typeof pairingResultSchema>;
export type DisconnectExtensionResult = z.infer<typeof disconnectExtensionResultSchema>;
export type ReadyResult = z.infer<typeof readyResultSchema>;
export type GameSummary = z.infer<typeof gameSummarySchema>;
export type CountdownResult = z.infer<typeof countdownResultSchema>;
export type PrepareNextGameResult = z.infer<typeof prepareNextGameResultSchema>;
export type EndGameResult = z.infer<typeof endGameResultSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type NavigationEventAck = z.infer<typeof navigationEventAckSchema>;
export type SubmitNavigationEventsResult = z.infer<typeof submitNavigationEventsResultSchema>;
export type AbandonRunResult = z.infer<typeof abandonRunResultSchema>;
export type NavigationRouteStep = z.infer<typeof navigationRouteStepSchema>;
export type GameRoutesResult = z.infer<typeof gameRoutesResultSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export function canonicalNavigationEventHashInput(
  event: Pick<
    NavigationEvent,
    "sequence" | "type" | "fromArticleKey" | "toArticleKey" | "clientObservedAt" | "previousHash"
  >,
): string {
  return [
    String(event.sequence),
    event.type,
    event.fromArticleKey.normalize("NFC"),
    event.toArticleKey.normalize("NFC"),
    new Date(event.clientObservedAt).toISOString(),
    event.previousHash ?? "",
  ].join("\n");
}
