import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  canonicalNavigationEventHashInput,
  type NavigationEvent,
  type NavigationEventType,
  type RoomSnapshot,
  type RunSummary,
} from "@wikirunner/contracts";
import { normalizeNamuWikiUrl } from "@wikirunner/namuwiki";
import {
  disconnectExtension,
  type GeneratedPathArticle,
  getExtensionSnapshot,
  submitGeneratedRandomPath,
  submitNavigationEvent,
} from "./game-api";
import { ensureExtensionSession, getExtensionSupabaseClient } from "./supabase";

const GAME_START_ALARM = "wikirunner-game-start";
const OUTBOX_RETRY_ALARM = "wikirunner-outbox-retry";
const LINK_INTENT_MAX_AGE_MS = 15_000;
const LINK_INTENT_GRACE_MS = 250;
const CONTENT_NAVIGATION_GRACE_MS = 350;
let roomChannel: RealtimeChannel | undefined;
let subscribedRoomId: string | undefined;
let pendingRoomSubscription: { roomId: string; promise: Promise<void> } | undefined;
let roomSubscriptionQueue = Promise.resolve();
let navigationPipeline = Promise.resolve();
let isFlushingOutbox = false;
const recentNavigationSignals = new Map<number, { articleKey: string; observedAt: number }>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({
    extensionSchemaVersion: 1,
    installedAt: new Date().toISOString(),
  });
  void restoreConnection();
});

chrome.runtime.onStartup.addListener(() => {
  void restoreConnection();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isPairingCompletedMessage(message)) {
    void subscribeToRoom(message.roomId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "연결 복구 실패",
        }),
      );
    return true;
  }

  if (isDisconnectExtensionMessage(message)) {
    void disconnectPairing()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "연동 해제 실패",
        }),
      );
    return true;
  }

  if (isGenerateRandomPathMessage(message)) {
    void generateRandomPathFromExtension(message.difficulty)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "랜덤 경로를 만들지 못했습니다.",
        }),
      );
    return true;
  }

  if (isLinkIntentMessage(message) && sender.tab?.id !== undefined && sender.frameId === 0) {
    void rememberLinkIntent(message, sender.tab.id);
  }
  if (
    isPageNavigationObservedMessage(message) &&
    sender.tab?.id !== undefined &&
    sender.frameId === 0
  ) {
    enqueueNavigationSignal({
      tabId: sender.tab.id,
      articleKey: message.articleKey,
      fromArticleKey: message.fromArticleKey,
      transitionType: "link",
      transitionQualifiers: [],
      source: "content",
    });
  }
  if (isRunTerminatedMessage(message)) {
    void resetActiveGame(message.outcome, message.occurredAt)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : "경기 상태 정리 실패",
        }),
      );
    return true;
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === GAME_START_ALARM) {
    void openScheduledGame();
  } else if (alarm.name === OUTBOX_RETRY_ALARM) {
    void flushOutbox();
  }
});

chrome.webNavigation.onCommitted.addListener(enqueueWebNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(enqueueWebNavigation);

function enqueueWebNavigation(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): void {
  if (details.frameId !== 0) {
    return;
  }

  const article = normalizeNamuWikiUrl(details.url);
  if (!article.ok) {
    return;
  }
  const fromArticleKey = fromArticleKeyFromUrl(details.url);
  enqueueNavigationSignal({
    tabId: details.tabId,
    articleKey: article.articleKey,
    ...(fromArticleKey ? { fromArticleKey } : {}),
    transitionType: details.transitionType,
    transitionQualifiers: details.transitionQualifiers,
    source: "browser",
  });
}

function fromArticleKeyFromUrl(urlValue: string): string | undefined {
  try {
    const fromArticleKey = new URL(urlValue).searchParams.get("from")?.normalize("NFC");
    return fromArticleKey && !/[\p{C}]/u.test(fromArticleKey) ? fromArticleKey : undefined;
  } catch {
    return undefined;
  }
}

function enqueueNavigationSignal(signal: NavigationSignal): void {
  if (signal.source === "content") {
    setTimeout(() => {
      enqueueNavigationSignal({ ...signal, source: "content_delayed" });
    }, CONTENT_NAVIGATION_GRACE_MS);
    return;
  }

  const observedAt = Date.now();
  const recentSignal = recentNavigationSignals.get(signal.tabId);
  if (
    recentSignal?.articleKey === signal.articleKey &&
    observedAt - recentSignal.observedAt < 1_000
  ) {
    return;
  }
  recentNavigationSignals.set(signal.tabId, {
    articleKey: signal.articleKey,
    observedAt,
  });

  navigationPipeline = navigationPipeline
    .then(() => observeNavigation(signal))
    .catch(async (error: unknown) => {
      await chrome.storage.local.set({
        lastEventError: error instanceof Error ? error.message : "이동 기록을 처리하지 못했습니다.",
      });
    });
}

void restoreConnection();

async function restoreConnection(): Promise<void> {
  const { activeRoomId } = await chrome.storage.local.get(["activeRoomId"]);
  if (typeof activeRoomId === "string") {
    await subscribeToRoom(activeRoomId);
    await flushOutbox();
  }
}

function subscribeToRoom(roomId: string): Promise<void> {
  if (roomChannel && subscribedRoomId === roomId) {
    return Promise.resolve();
  }
  if (pendingRoomSubscription?.roomId === roomId) {
    return pendingRoomSubscription.promise;
  }

  const subscription = roomSubscriptionQueue.then(() => establishRoomSubscription(roomId));
  roomSubscriptionQueue = subscription.catch(() => undefined);
  pendingRoomSubscription = { roomId, promise: subscription };
  void subscription
    .finally(() => {
      if (pendingRoomSubscription?.promise === subscription) {
        pendingRoomSubscription = undefined;
      }
    })
    .catch(() => undefined);
  return subscription;
}

async function establishRoomSubscription(roomId: string): Promise<void> {
  if (roomChannel && subscribedRoomId === roomId) {
    return;
  }

  await ensureExtensionSession();
  const supabase = getExtensionSupabaseClient();

  if (roomChannel) {
    await supabase.removeChannel(roomChannel);
    roomChannel = undefined;
    subscribedRoomId = undefined;
  }

  await refreshRoom(roomId);
  const channel = supabase
    .channel(`extension-room:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rooms",
        filter: `id=eq.${roomId}`,
      },
      () => {
        void refreshRoom(roomId);
      },
    )
    .subscribe();
  roomChannel = channel;
  subscribedRoomId = roomId;
}

async function generateRandomPathFromExtension(difficulty: RandomDifficulty): Promise<void> {
  const { activeRoomId } = await chrome.storage.local.get("activeRoomId");
  if (typeof activeRoomId !== "string") {
    throw new Error("먼저 방장 계정과 확장 프로그램을 연결해 주세요.");
  }

  const snapshot = await getExtensionSnapshot(activeRoomId);
  const currentPlayer = snapshot.players.find((player) => player.isCurrentPlayer);
  if (!currentPlayer || currentPlayer.id !== snapshot.room.hostPlayerId) {
    throw new Error("방장만 랜덤 경로를 추첨할 수 있습니다.");
  }
  if (snapshot.room.status !== "waiting") {
    throw new Error("다음 경기 준비 상태에서만 랜덤 경로를 추첨할 수 있습니다.");
  }
  if ((snapshot.room.draftSettings?.randomGenerationCount ?? 0) >= 10) {
    throw new Error("이번 경기 준비에서는 랜덤 추첨을 10회까지 할 수 있습니다.");
  }

  const generatedPath = await generateNamuWikiPathInBrowser(difficulty);
  await submitGeneratedRandomPath({
    roomId: snapshot.room.id,
    expectedVersion: snapshot.room.version,
    generatedPath,
  });
}

type RandomDifficulty = "easy" | "normal" | "hard";

const RANDOM_PATH_DEPTHS: Record<RandomDifficulty, readonly number[]> = {
  easy: [3, 4],
  normal: [5, 6],
  hard: [7, 8],
};
const NAMUWIKI_ORIGIN = "https://namu.wiki";

async function generateNamuWikiPathInBrowser(
  difficulty: RandomDifficulty,
): Promise<GeneratedPathArticle[]> {
  const targetDepth = pickRandom(RANDOM_PATH_DEPTHS[difficulty]);
  let lastError = "경로를 찾지 못했습니다.";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const start = await fetchRandomNamuWikiArticle();
      const path = [start];
      const seen = new Set([start.key]);
      let current = start;

      for (let step = 0; step < targetDepth; step += 1) {
        const candidates = (await fetchNamuWikiLinks(current)).filter(
          (article) => !seen.has(article.key),
        );
        if (candidates.length === 0) {
          throw new Error("연결된 문서가 부족합니다.");
        }
        current = pickRandom(candidates);
        path.push(current);
        seen.add(current.key);
      }
      return path;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(`랜덤 경로를 찾지 못했습니다. ${lastError}`);
}

async function fetchRandomNamuWikiArticle(): Promise<GeneratedPathArticle> {
  const response = await fetch(`${NAMUWIKI_ORIGIN}/random`, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`나무위키 랜덤 문서를 불러오지 못했습니다. (${response.status})`);
  }
  const article = articleFromNamuWikiUrl(response.url);
  if (!article) {
    throw new Error("나무위키 랜덤 문서의 주소를 확인하지 못했습니다.");
  }
  return article;
}

async function fetchNamuWikiLinks(article: GeneratedPathArticle): Promise<GeneratedPathArticle[]> {
  const response = await fetch(`${NAMUWIKI_ORIGIN}/w/${encodeURIComponent(article.key)}`);
  if (!response.ok) {
    throw new Error(`문서를 불러오지 못했습니다. (${response.status})`);
  }
  const links = new Map<string, GeneratedPathArticle>();
  const html = await response.text();
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1];
    if (!href) {
      continue;
    }
    const candidate = articleFromNamuWikiUrl(href);
    if (candidate) {
      links.set(candidate.key, candidate);
    }
  }
  if (links.size === 0) {
    throw new Error("문서에서 내부 링크를 찾지 못했습니다.");
  }
  return [...links.values()];
}

function articleFromNamuWikiUrl(value: string): GeneratedPathArticle | null {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), NAMUWIKI_ORIGIN);
    if (url.origin !== NAMUWIKI_ORIGIN || !url.pathname.startsWith("/w/")) {
      return null;
    }
    const key = decodeURIComponent(url.pathname.slice("/w/".length)).normalize("NFC");
    if (!key || key.includes(":")) {
      return null;
    }
    return { key, title: key };
  } catch {
    return null;
  }
}

function pickRandom<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) {
    throw new Error("선택할 문서가 없습니다.");
  }
  return item;
}

async function disconnectPairing(): Promise<void> {
  await disconnectExtension();

  if (roomChannel) {
    await getExtensionSupabaseClient()
      .removeChannel(roomChannel)
      .catch(() => undefined);
    roomChannel = undefined;
    subscribedRoomId = undefined;
  }

  await chrome.alarms.clear(GAME_START_ALARM);
  await chrome.alarms.clear(OUTBOX_RETRY_ALARM);
  await chrome.storage.session.remove("pendingLinkIntent");
  await chrome.storage.local.remove([
    "activeRoomId",
    "activePlayerId",
    "pairedAt",
    "lastRoomSnapshotAt",
    "roomStatus",
    "leaderboard",
    "lastGameOutcome",
    "lastFinalizedGameId",
    "activeGame",
    "activeRun",
    "gameTabId",
    "gameOpenedAt",
    "lastEventError",
    "lastCompletedGame",
    "navigationOutbox",
    "lastObservedNavigation",
  ]);
  recentNavigationSignals.clear();
}

async function refreshRoom(roomId: string): Promise<void> {
  const snapshot = await getExtensionSnapshot(roomId);
  await chrome.storage.local.set({
    lastRoomSnapshotAt: new Date().toISOString(),
    roomStatus: snapshot.room.status,
    leaderboard: snapshot.runs,
  });
  await synchronizeGame(snapshot);
}

async function synchronizeGame(snapshot: RoomSnapshot): Promise<void> {
  const game = snapshot.game;
  const ownRun = snapshot.runs.find((run) => run.isCurrentPlayer);
  if (!game || !ownRun) {
    if (snapshot.room.status === "waiting") {
      const { activeGame } = await chrome.storage.local.get(["activeGame"]);
      if (isActiveGame(activeGame)) {
        await resetActiveGame("abandoned", new Date().toISOString(), activeGame.gameId);
      } else {
        await chrome.storage.local.set({
          lastGameOutcome: null,
          lastCompletedGame: null,
          lastFinalizedGameId: null,
        });
      }
    }
    return;
  }

  const { lastFinalizedGameId } = await chrome.storage.local.get(["lastFinalizedGameId"]);
  if (lastFinalizedGameId === game.id) {
    return;
  }

  const activeGame: ActiveGame = {
    gameId: game.id,
    roomId: snapshot.room.id,
    runId: ownRun.id,
    scheduledAt: game.scheduledAt,
    startArticleKey: game.startArticle.key,
    startArticleTitle: game.startArticle.title,
    targetArticleKey: game.targetArticle.key,
    targetArticleTitle: game.targetArticle.title,
  };
  const activeRun = await overlayPendingEvents(toActiveRun(ownRun), ownRun.id);

  const { lastFinalizedGameId: currentFinalizedGameId } = await chrome.storage.local.get([
    "lastFinalizedGameId",
  ]);
  if (currentFinalizedGameId === game.id) {
    return;
  }

  if (
    game.status === "finished" ||
    ownRun.status === "finished" ||
    ownRun.status === "abandoned" ||
    ownRun.status === "disqualified"
  ) {
    await resetActiveGame(
      ownRun.status === "finished" ? "finished" : "abandoned",
      new Date().toISOString(),
      game.id,
    );
    return;
  }

  await chrome.storage.local.set({
    activeGame,
    activeRun,
    lastGameOutcome: null,
    lastCompletedGame: null,
    lastFinalizedGameId: null,
  });

  const scheduledTime = new Date(activeGame.scheduledAt).getTime();
  if (scheduledTime <= Date.now()) {
    const { gameTabId } = await chrome.storage.local.get(["gameTabId"]);
    if (typeof gameTabId !== "number") {
      await openScheduledGame();
    }
  } else {
    await chrome.alarms.create(GAME_START_ALARM, { when: scheduledTime });
  }
}

async function openScheduledGame(): Promise<void> {
  const { activeGame, gameTabId } = await chrome.storage.local.get(["activeGame", "gameTabId"]);
  if (!isActiveGame(activeGame)) {
    return;
  }

  const startUrl = `https://namu.wiki/w/${encodeURIComponent(activeGame.startArticleKey)}`;
  let tabId: number | undefined;

  if (typeof gameTabId === "number") {
    try {
      const updated = await chrome.tabs.update(gameTabId, { active: true, url: startUrl });
      tabId = updated?.id;
    } catch {
      tabId = undefined;
    }
  }

  if (tabId === undefined) {
    const created = await chrome.tabs.create({ active: true, url: startUrl });
    tabId = created.id;
  }

  await chrome.storage.local.set({
    gameTabId: tabId,
    gameOpenedAt: new Date().toISOString(),
  });
}

async function rememberLinkIntent(message: LinkIntentMessage, tabId: number): Promise<void> {
  const { activeGame, gameTabId } = await chrome.storage.local.get(["activeGame", "gameTabId"]);
  if (!isActiveGame(activeGame) || gameTabId !== tabId) {
    return;
  }

  const intent: PendingLinkIntent = {
    tabId,
    gameId: activeGame.gameId,
    fromArticleKey: message.fromArticleKey,
    toArticleKey: message.toArticleKey,
    observedAt: new Date(message.observedAt).toISOString(),
  };
  await chrome.storage.session.set({ pendingLinkIntent: intent });
}

async function observeNavigation(signal: NavigationSignal): Promise<void> {
  const { activeGame, activeRun, gameTabId } = await chrome.storage.local.get([
    "activeGame",
    "activeRun",
    "gameTabId",
  ]);
  if (
    !isActiveGame(activeGame) ||
    !isActiveRun(activeRun) ||
    signal.tabId !== gameTabId ||
    Date.now() < new Date(activeGame.scheduledAt).getTime() ||
    activeRun.status === "finished"
  ) {
    return;
  }

  if (activeRun.lastSequence === 0 && activeRun.lastArticleKey === signal.articleKey) {
    await chrome.storage.session.remove("pendingLinkIntent");
    return;
  }

  const { pendingLinkIntent } = await chrome.storage.session.get(["pendingLinkIntent"]);
  let intent = isPendingLinkIntent(pendingLinkIntent) ? pendingLinkIntent : undefined;
  if (
    signal.transitionType === "link" &&
    !isMatchingLinkNavigation(intent, signal, activeRun, activeGame)
  ) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, LINK_INTENT_GRACE_MS);
    });
    const { pendingLinkIntent: delayedPendingLinkIntent } = await chrome.storage.session.get([
      "pendingLinkIntent",
    ]);
    intent = isPendingLinkIntent(delayedPendingLinkIntent) ? delayedPendingLinkIntent : undefined;
  }
  const now = new Date().toISOString();
  const matchedIntent =
    intent && isMatchingLinkNavigation(intent, signal, activeRun, activeGame) ? intent : undefined;
  const eventType = classifyNavigation(signal, activeRun, activeGame, matchedIntent);
  const clientObservedAt =
    eventType === "link" && matchedIntent ? new Date(matchedIntent.observedAt).toISOString() : now;
  const event: NavigationEvent = {
    schemaVersion: 1,
    clientEventId: crypto.randomUUID(),
    sequence: activeRun.lastSequence + 1,
    type: eventType,
    fromArticleKey: activeRun.lastArticleKey,
    toArticleKey: signal.articleKey,
    clientObservedAt,
    previousHash: activeRun.lastEventHash,
    eventHash: await hashNavigationEvent({
      sequence: activeRun.lastSequence + 1,
      type: eventType,
      fromArticleKey: activeRun.lastArticleKey,
      toArticleKey: signal.articleKey,
      clientObservedAt,
      previousHash: activeRun.lastEventHash,
    }),
  };
  const outboxEntry: NavigationOutboxEntry = {
    gameId: activeGame.gameId,
    runId: activeGame.runId,
    idempotencyKey: crypto.randomUUID(),
    event,
  };

  await appendToOutbox(outboxEntry);
  await chrome.storage.local.set({
    activeRun: applyPendingEvent(activeRun, event),
    lastObservedNavigation: {
      tabId: signal.tabId,
      articleKey: signal.articleKey,
      observedAt: now,
      transitionType: signal.transitionType,
    },
  });
  await chrome.storage.session.remove("pendingLinkIntent");
  await flushOutbox();
}

function classifyNavigation(
  signal: NavigationSignal,
  activeRun: ActiveRun,
  activeGame: ActiveGame,
  intent: PendingLinkIntent | undefined,
): NavigationEventType {
  if (isMatchingLinkNavigation(intent, signal, activeRun, activeGame)) {
    return "link";
  }
  if (signal.transitionType === "link" && signal.fromArticleKey === activeRun.lastArticleKey) {
    return "link";
  }
  if (signal.articleKey === activeRun.lastArticleKey || signal.transitionType === "reload") {
    return "reload";
  }
  if (signal.transitionQualifiers.includes("forward_back")) {
    return "back";
  }
  return "direct";
}

function isMatchingLinkNavigation(
  intent: PendingLinkIntent | undefined,
  signal: NavigationSignal,
  activeRun: ActiveRun,
  activeGame: ActiveGame,
): boolean {
  return (
    isMatchingLinkIntent(intent, signal, activeRun, activeGame) ||
    isMatchingRedirectedLinkIntent(intent, signal, activeRun, activeGame)
  );
}

function isMatchingLinkIntent(
  intent: PendingLinkIntent | undefined,
  signal: NavigationSignal,
  activeRun: ActiveRun,
  activeGame: ActiveGame,
): boolean {
  const intentAge = intent
    ? Date.now() - new Date(intent.observedAt).getTime()
    : Number.POSITIVE_INFINITY;
  return (
    intent !== undefined &&
    intent.gameId === activeGame.gameId &&
    intent.tabId === signal.tabId &&
    intent.fromArticleKey === activeRun.lastArticleKey &&
    intent.toArticleKey === signal.articleKey &&
    intentAge >= 0 &&
    intentAge <= LINK_INTENT_MAX_AGE_MS
  );
}

function isMatchingRedirectedLinkIntent(
  intent: PendingLinkIntent | undefined,
  signal: NavigationSignal,
  activeRun: ActiveRun,
  activeGame: ActiveGame,
): boolean {
  const intentAge = intent
    ? Date.now() - new Date(intent.observedAt).getTime()
    : Number.POSITIVE_INFINITY;
  return (
    intent !== undefined &&
    intent.gameId === activeGame.gameId &&
    intent.tabId === signal.tabId &&
    intent.fromArticleKey === activeRun.lastArticleKey &&
    signal.fromArticleKey === intent.toArticleKey &&
    signal.articleKey !== intent.toArticleKey &&
    intentAge >= 0 &&
    intentAge <= LINK_INTENT_MAX_AGE_MS
  );
}

async function flushOutbox(): Promise<void> {
  if (isFlushingOutbox) {
    return;
  }
  isFlushingOutbox = true;

  try {
    const { navigationOutbox } = await chrome.storage.local.get(["navigationOutbox"]);
    const entries = asOutbox(navigationOutbox).sort(
      (left, right) => left.event.sequence - right.event.sequence,
    );

    for (const entry of entries) {
      try {
        const result = await submitNavigationEvent(
          entry.gameId,
          entry.runId,
          entry.event,
          entry.idempotencyKey,
        );
        const remaining = asOutbox(
          (await chrome.storage.local.get(["navigationOutbox"])).navigationOutbox,
        ).filter((candidate) => candidate.idempotencyKey !== entry.idempotencyKey);
        await chrome.storage.local.set({
          navigationOutbox: remaining,
          activeRun: toActiveRun(result.run),
          leaderboard: result.leaderboard,
          lastEventError: null,
        });
        if (result.run.status === "finished") {
          await resetActiveGame(
            "finished",
            result.events.at(-1)?.serverReceivedAt ?? new Date().toISOString(),
            entry.gameId,
          );
        }
        if (remaining.length === 0) {
          await chrome.alarms.clear(OUTBOX_RETRY_ALARM);
        }
      } catch (error) {
        await chrome.storage.local.set({
          lastEventError:
            error instanceof Error ? error.message : "이동 기록을 전송하지 못했습니다.",
        });
        break;
      }
    }
  } finally {
    isFlushingOutbox = false;
    const { navigationOutbox } = await chrome.storage.local.get(["navigationOutbox"]);
    if (asOutbox(navigationOutbox).length > 0) {
      await chrome.alarms.create(OUTBOX_RETRY_ALARM, {
        when: Date.now() + 5_000,
      });
    }
  }
}

async function resetActiveGame(
  outcome: "finished" | "abandoned",
  occurredAt: string,
  expectedGameId?: string,
): Promise<void> {
  const { activeGame, navigationOutbox } = await chrome.storage.local.get([
    "activeGame",
    "navigationOutbox",
  ]);
  if (expectedGameId && isActiveGame(activeGame) && activeGame.gameId !== expectedGameId) {
    return;
  }

  const gameId = isActiveGame(activeGame) ? activeGame.gameId : expectedGameId;
  const lastCompletedGame =
    outcome === "finished" && isActiveGame(activeGame)
      ? {
          targetArticleKey: activeGame.targetArticleKey,
          targetArticleTitle: activeGame.targetArticleTitle,
        }
      : null;
  const remainingOutbox = gameId
    ? asOutbox(navigationOutbox).filter((entry) => entry.gameId !== gameId)
    : asOutbox(navigationOutbox);

  await chrome.alarms.clear(GAME_START_ALARM);
  await chrome.alarms.clear(OUTBOX_RETRY_ALARM);
  await chrome.storage.session.remove("pendingLinkIntent");
  await chrome.storage.local.remove([
    "activeGame",
    "activeRun",
    "gameTabId",
    "gameOpenedAt",
    "lastEventError",
  ]);
  await chrome.storage.local.set({
    navigationOutbox: remainingOutbox,
    lastGameOutcome: { outcome, occurredAt },
    lastCompletedGame,
    lastFinalizedGameId: gameId ?? null,
  });
  recentNavigationSignals.clear();
}

async function appendToOutbox(entry: NavigationOutboxEntry): Promise<void> {
  const { navigationOutbox } = await chrome.storage.local.get(["navigationOutbox"]);
  await chrome.storage.local.set({
    navigationOutbox: [...asOutbox(navigationOutbox), entry],
  });
}

async function overlayPendingEvents(base: ActiveRun, runId: string): Promise<ActiveRun> {
  const { navigationOutbox } = await chrome.storage.local.get(["navigationOutbox"]);
  return asOutbox(navigationOutbox)
    .filter((entry) => entry.runId === runId)
    .sort((left, right) => left.event.sequence - right.event.sequence)
    .reduce((run, entry) => applyPendingEvent(run, entry.event), base);
}

function applyPendingEvent(run: ActiveRun, event: NavigationEvent): ActiveRun {
  return {
    ...run,
    status: "running",
    lastSequence: event.sequence,
    lastArticleKey: event.toArticleKey,
    lastEventHash: event.eventHash,
    moveCount: run.moveCount + (event.type === "link" ? 1 : 0),
    violationStatus: event.type === "direct" ? "warned" : run.violationStatus,
  };
}

async function hashNavigationEvent(
  event: Omit<NavigationEvent, "schemaVersion" | "clientEventId" | "eventHash">,
): Promise<string> {
  const canonical = canonicalNavigationEventHashInput(event);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toActiveRun(run: RunProjection): ActiveRun {
  return {
    runId: run.id,
    status: run.status,
    lastSequence: run.lastSequence,
    lastArticleKey: run.lastArticleKey ?? "",
    lastEventHash: run.lastEventHash,
    moveCount: run.moveCount ?? 0,
    violationStatus: run.violationStatus,
  };
}

function asOutbox(value: unknown): NavigationOutboxEntry[] {
  return Array.isArray(value) ? value.filter(isNavigationOutboxEntry) : [];
}

interface ActiveGame {
  gameId: string;
  roomId: string;
  runId: string;
  scheduledAt: string;
  startArticleKey: string;
  startArticleTitle: string;
  targetArticleKey: string;
  targetArticleTitle: string;
}

interface ActiveRun {
  runId: string;
  status: "waiting" | "running" | "finished" | "abandoned" | "flagged" | "disqualified";
  lastSequence: number;
  lastArticleKey: string;
  lastEventHash: string | null;
  moveCount: number;
  violationStatus: "clear" | "warned" | "reviewed";
}

type RunProjection = Omit<RunSummary, "nickname" | "isCurrentPlayer">;

interface PendingLinkIntent {
  tabId: number;
  gameId: string;
  fromArticleKey: string;
  toArticleKey: string;
  observedAt: string;
}

interface NavigationSignal {
  tabId: number;
  articleKey: string;
  fromArticleKey?: string;
  transitionType: string;
  transitionQualifiers: string[];
  source: "browser" | "content" | "content_delayed";
}

interface NavigationOutboxEntry {
  gameId: string;
  runId: string;
  idempotencyKey: string;
  event: NavigationEvent;
}

interface PairingCompletedMessage {
  type: "PAIRING_COMPLETED";
  roomId: string;
}

interface DisconnectExtensionMessage {
  type: "DISCONNECT_EXTENSION";
}

interface GenerateRandomPathMessage {
  type: "GENERATE_RANDOM_PATH";
  difficulty: RandomDifficulty;
}

interface LinkIntentMessage {
  type: "LINK_INTENT";
  fromArticleKey: string;
  toArticleKey: string;
  observedAt: string;
}

interface PageNavigationObservedMessage {
  type: "PAGE_NAVIGATION_OBSERVED";
  fromArticleKey: string;
  articleKey: string;
  observedAt: string;
}

interface RunTerminatedMessage {
  type: "RUN_TERMINATED";
  outcome: "finished" | "abandoned";
  occurredAt: string;
}

function isPairingCompletedMessage(value: unknown): value is PairingCompletedMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PairingCompletedMessage>;
  return candidate.type === "PAIRING_COMPLETED" && typeof candidate.roomId === "string";
}

function isDisconnectExtensionMessage(value: unknown): value is DisconnectExtensionMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Partial<DisconnectExtensionMessage>).type === "DISCONNECT_EXTENSION"
  );
}

function isGenerateRandomPathMessage(value: unknown): value is GenerateRandomPathMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<GenerateRandomPathMessage>;
  return (
    candidate.type === "GENERATE_RANDOM_PATH" &&
    (candidate.difficulty === "easy" ||
      candidate.difficulty === "normal" ||
      candidate.difficulty === "hard")
  );
}

function isLinkIntentMessage(value: unknown): value is LinkIntentMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<LinkIntentMessage>;
  return (
    candidate.type === "LINK_INTENT" &&
    typeof candidate.fromArticleKey === "string" &&
    typeof candidate.toArticleKey === "string" &&
    typeof candidate.observedAt === "string" &&
    Number.isFinite(new Date(candidate.observedAt).getTime())
  );
}

function isPageNavigationObservedMessage(value: unknown): value is PageNavigationObservedMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PageNavigationObservedMessage>;
  return (
    candidate.type === "PAGE_NAVIGATION_OBSERVED" &&
    typeof candidate.fromArticleKey === "string" &&
    candidate.fromArticleKey.length >= 1 &&
    candidate.fromArticleKey.length <= 300 &&
    typeof candidate.articleKey === "string" &&
    candidate.articleKey.length >= 1 &&
    candidate.articleKey.length <= 300 &&
    typeof candidate.observedAt === "string" &&
    Number.isFinite(new Date(candidate.observedAt).getTime())
  );
}

function isRunTerminatedMessage(value: unknown): value is RunTerminatedMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RunTerminatedMessage>;
  return (
    candidate.type === "RUN_TERMINATED" &&
    (candidate.outcome === "finished" || candidate.outcome === "abandoned") &&
    typeof candidate.occurredAt === "string" &&
    Number.isFinite(new Date(candidate.occurredAt).getTime())
  );
}

function isPendingLinkIntent(value: unknown): value is PendingLinkIntent {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PendingLinkIntent>;
  return (
    typeof candidate.tabId === "number" &&
    typeof candidate.gameId === "string" &&
    typeof candidate.fromArticleKey === "string" &&
    typeof candidate.toArticleKey === "string" &&
    typeof candidate.observedAt === "string"
  );
}

function isActiveGame(value: unknown): value is ActiveGame {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ActiveGame>;
  return (
    typeof candidate.gameId === "string" &&
    typeof candidate.roomId === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.scheduledAt === "string" &&
    typeof candidate.startArticleKey === "string" &&
    typeof candidate.startArticleTitle === "string" &&
    typeof candidate.targetArticleKey === "string" &&
    typeof candidate.targetArticleTitle === "string"
  );
}

function isActiveRun(value: unknown): value is ActiveRun {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ActiveRun>;
  return (
    typeof candidate.runId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.lastSequence === "number" &&
    typeof candidate.lastArticleKey === "string" &&
    (candidate.lastEventHash === null || typeof candidate.lastEventHash === "string") &&
    typeof candidate.moveCount === "number" &&
    (candidate.violationStatus === "clear" ||
      candidate.violationStatus === "warned" ||
      candidate.violationStatus === "reviewed")
  );
}

function isNavigationOutboxEntry(value: unknown): value is NavigationOutboxEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<NavigationOutboxEntry>;
  return (
    typeof candidate.gameId === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.idempotencyKey === "string" &&
    candidate.event !== null &&
    typeof candidate.event === "object" &&
    typeof candidate.event.sequence === "number"
  );
}
