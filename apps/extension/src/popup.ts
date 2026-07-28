import { abandonRun, pairExtension } from "./game-api";

const statusElement = document.querySelector<HTMLElement>("#status");
const description = document.querySelector<HTMLElement>("#description");
const pairingForm = document.querySelector<HTMLFormElement>("#pairing-form");
const pairingInput = document.querySelector<HTMLInputElement>("#pairing-code");
const pairingButton = document.querySelector<HTMLButtonElement>("#pairing-button");
const pairingError = document.querySelector<HTMLElement>("#pairing-error");
const gameControls = document.querySelector<HTMLElement>("#game-controls");
const abandonButton = document.querySelector<HTMLButtonElement>("#abandon-button");
const abandonError = document.querySelector<HTMLElement>("#abandon-error");
const connectionControls = document.querySelector<HTMLElement>("#connection-controls");
const disconnectButton = document.querySelector<HTMLButtonElement>("#disconnect-button");
const disconnectError = document.querySelector<HTMLElement>("#disconnect-error");
const openHomeButton = document.querySelector<HTMLButtonElement>("#open-home-button");
const openRoomButton = document.querySelector<HTMLButtonElement>("#open-room-button");
const webNavigationError = document.querySelector<HTMLElement>("#web-navigation-error");
const randomPathControls = document.querySelector<HTMLElement>("#random-path-controls");
const randomDifficulty = document.querySelector<HTMLSelectElement>("#random-difficulty");
const generateRandomPathButton = document.querySelector<HTMLButtonElement>(
  "#generate-random-path-button",
);
const randomPathError = document.querySelector<HTMLElement>("#random-path-error");

const webAppUrl = getWebAppUrl();

void renderConnectionState();

pairingInput?.addEventListener("input", () => {
  const normalized = pairingInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  pairingInput.value =
    normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
});

pairingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pairingInput || !pairingButton || !pairingError) {
    return;
  }

  const pairingCode = pairingInput.value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (pairingCode.length !== 8) {
    pairingError.textContent = "8자리 페어링 코드를 입력해 주세요.";
    return;
  }

  pairingButton.disabled = true;
  pairingError.textContent = "";
  pairingButton.textContent = "연결 중…";

  try {
    const result = await pairExtension(pairingCode);
    await chrome.storage.local.set({
      activeRoomId: result.roomId,
      activePlayerId: result.playerId,
      pairedAt: result.pairedAt,
      lastGameOutcome: null,
      lastCompletedGame: null,
      lastFinalizedGameId: null,
    });
    await chrome.runtime.sendMessage({
      type: "PAIRING_COMPLETED",
      roomId: result.roomId,
    });
    await renderConnectionState();
  } catch (error) {
    pairingError.textContent =
      error instanceof Error ? error.message : "확장 프로그램을 연결하지 못했습니다.";
  } finally {
    pairingButton.disabled = false;
    pairingButton.textContent = "웹 계정과 연결";
  }
});

abandonButton?.addEventListener("click", async () => {
  if (!abandonButton || !abandonError) {
    return;
  }

  const { activeGame, activeRun } = await chrome.storage.local.get(["activeGame", "activeRun"]);
  if (!isActiveGame(activeGame) || !isActiveRun(activeRun)) {
    await renderConnectionState();
    return;
  }
  if (!window.confirm("이번 경기를 포기할까요? 기록은 포기로 남습니다.")) {
    return;
  }

  abandonButton.disabled = true;
  abandonButton.textContent = "포기 처리 중…";
  abandonError.textContent = "";
  try {
    const result = await abandonRun(activeGame.gameId, activeRun.runId);
    await chrome.runtime.sendMessage({
      type: "RUN_TERMINATED",
      outcome: "abandoned",
      occurredAt: result.abandonedAt,
    });
    await renderConnectionState();
  } catch (error) {
    abandonError.textContent =
      error instanceof Error ? error.message : "경기 포기를 처리하지 못했습니다.";
  } finally {
    abandonButton.disabled = false;
    abandonButton.textContent = "이번 경기 포기";
  }
});

disconnectButton?.addEventListener("click", async () => {
  if (!disconnectButton || !disconnectError) {
    return;
  }

  const { activeGame, activeRun } = await chrome.storage.local.get(["activeGame", "activeRun"]);
  if (isActiveGame(activeGame) && isActiveRun(activeRun)) {
    disconnectError.textContent =
      "경기 중에는 연동을 해제할 수 없습니다. 먼저 경기를 포기해 주세요.";
    return;
  }
  if (
    !window.confirm(
      "확장 프로그램 연동을 해제할까요? 다시 사용하려면 웹에서 새 페어링 코드를 발급해야 합니다.",
    )
  ) {
    return;
  }

  disconnectButton.disabled = true;
  disconnectButton.textContent = "해제 중…";
  disconnectError.textContent = "";
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: "DISCONNECT_EXTENSION",
    });
    if (!isSuccessfulResponse(response)) {
      throw new Error(
        isErrorResponse(response) ? response.message : "연동 해제 결과를 확인하지 못했습니다.",
      );
    }
    await renderConnectionState();
  } catch (error) {
    disconnectError.textContent =
      error instanceof Error ? error.message : "확장 프로그램 연동을 해제하지 못했습니다.";
  } finally {
    disconnectButton.disabled = false;
    disconnectButton.textContent = "연동 해제";
  }
});

openHomeButton?.addEventListener("click", async () => {
  await openWebPage("/");
});

openRoomButton?.addEventListener("click", async () => {
  const { activeRoomId } = await chrome.storage.local.get("activeRoomId");
  if (typeof activeRoomId !== "string") {
    await renderConnectionState();
    return;
  }
  await openWebPage(`/rooms/${encodeURIComponent(activeRoomId)}`);
});

generateRandomPathButton?.addEventListener("click", async () => {
  if (!generateRandomPathButton || !randomDifficulty || !randomPathError) {
    return;
  }
  generateRandomPathButton.disabled = true;
  generateRandomPathButton.textContent = "경로 생성 중…";
  randomPathError.textContent = "";
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: "GENERATE_RANDOM_PATH",
      difficulty: randomDifficulty.value,
    });
    if (!isSuccessfulResponse(response)) {
      throw new Error(
        isErrorResponse(response) ? response.message : "랜덤 경로 생성 결과를 확인하지 못했습니다.",
      );
    }
    randomPathError.textContent = "추첨했습니다. 웹 대기실에서 결과를 확인하세요.";
  } catch (error) {
    randomPathError.textContent =
      error instanceof Error ? error.message : "랜덤 경로를 만들지 못했습니다.";
  } finally {
    generateRandomPathButton.disabled = false;
    generateRandomPathButton.textContent = "랜덤 시작·목표 추첨";
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.activeRoomId || changes.activeGame || changes.activeRun || changes.lastGameOutcome)
  ) {
    void renderConnectionState();
  }
});

async function renderConnectionState() {
  if (
    !statusElement ||
    !description ||
    !pairingForm ||
    !gameControls ||
    !connectionControls ||
    !disconnectButton ||
    !openHomeButton ||
    !openRoomButton
  ) {
    return;
  }

  const { activeRoomId, activeGame, activeRun, lastGameOutcome } = await chrome.storage.local.get([
    "activeRoomId",
    "activeGame",
    "activeRun",
    "lastGameOutcome",
  ]);
  if (typeof activeRoomId === "string") {
    updateWebNavigationControls(activeRoomId);
    connectionControls.hidden = false;
    if (randomPathControls) {
      randomPathControls.hidden = isActiveGame(activeGame) && isActiveRun(activeRun);
    }
    if (isActiveGame(activeGame) && isActiveRun(activeRun)) {
      statusElement.textContent = "경기 중";
      description.textContent = `목표: ${activeGame.targetArticleTitle}`;
      gameControls.hidden = false;
      disconnectButton.disabled = true;
      disconnectButton.title = "경기를 포기한 뒤 연동을 해제할 수 있습니다.";
    } else {
      statusElement.textContent = "연결됨";
      description.textContent = isGameOutcome(lastGameOutcome)
        ? lastGameOutcome.outcome === "finished"
          ? "완주 기록을 전송했습니다. 다음 경기 시작을 기다립니다."
          : "포기 처리가 완료됐습니다. 다음 경기 시작을 기다립니다."
        : "대기실과 연결되었습니다. 웹에서 준비 상태를 완료하세요.";
      gameControls.hidden = true;
      disconnectButton.disabled = false;
      disconnectButton.title = "";
    }
    pairingForm.hidden = true;
    return;
  }

  updateWebNavigationControls();
  statusElement.textContent = "미연결";
  description.textContent = "웹 대기실에서 발급한 8자리 코드를 입력하세요.";
  pairingForm.hidden = false;
  gameControls.hidden = true;
  connectionControls.hidden = true;
  if (randomPathControls) {
    randomPathControls.hidden = true;
  }
}

function getWebAppUrl(): URL | null {
  const configuredUrl = import.meta.env.VITE_WEB_APP_URL?.trim() || "http://localhost:3000";
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    url.search = "";
    return url;
  } catch {
    return null;
  }
}

function updateWebNavigationControls(activeRoomId?: string) {
  if (!openHomeButton || !openRoomButton) {
    return;
  }
  const isConfigured = webAppUrl !== null;
  openHomeButton.disabled = !isConfigured;
  openRoomButton.disabled = !isConfigured || !activeRoomId;
  openHomeButton.title = isConfigured ? "" : "웹 주소 설정을 확인해 주세요.";
  openRoomButton.title = !isConfigured
    ? "웹 주소 설정을 확인해 주세요."
    : activeRoomId
      ? ""
      : "연결된 방이 없습니다.";
}

async function openWebPage(pathname: string) {
  if (!webAppUrl) {
    if (webNavigationError) {
      webNavigationError.textContent =
        "웹 주소 설정이 올바르지 않습니다. 확장 프로그램 설정을 확인해 주세요.";
    }
    return;
  }

  try {
    const url = new URL(webAppUrl.toString());
    url.pathname = `${url.pathname.replace(/\/$/, "")}${pathname}`;
    url.search = "";
    url.hash = "";
    await chrome.tabs.create({ url: url.toString(), active: true });
    window.close();
  } catch {
    if (webNavigationError) {
      webNavigationError.textContent = "웹페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }
  }
}

interface ActiveGame {
  gameId: string;
  targetArticleTitle: string;
}

interface ActiveRun {
  runId: string;
  status: string;
}

interface GameOutcome {
  outcome: "finished" | "abandoned";
  occurredAt: string;
}

function isActiveGame(value: unknown): value is ActiveGame {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ActiveGame>;
  return typeof candidate.gameId === "string" && typeof candidate.targetArticleTitle === "string";
}

function isActiveRun(value: unknown): value is ActiveRun {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ActiveRun>;
  return typeof candidate.runId === "string" && typeof candidate.status === "string";
}

function isGameOutcome(value: unknown): value is GameOutcome {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<GameOutcome>;
  return (
    (candidate.outcome === "finished" || candidate.outcome === "abandoned") &&
    typeof candidate.occurredAt === "string"
  );
}

function isSuccessfulResponse(value: unknown): value is { ok: true } {
  return value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true;
}

function isErrorResponse(value: unknown): value is { ok: false; message: string } {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as { ok?: unknown; message?: unknown };
  return candidate.ok === false && typeof candidate.message === "string";
}
