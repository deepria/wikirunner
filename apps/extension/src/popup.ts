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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.activeGame || changes.activeRun || changes.lastGameOutcome)
  ) {
    void renderConnectionState();
  }
});

async function renderConnectionState() {
  if (!statusElement || !description || !pairingForm || !gameControls) {
    return;
  }

  const { activeRoomId, activeGame, activeRun, lastGameOutcome } = await chrome.storage.local.get([
    "activeRoomId",
    "activeGame",
    "activeRun",
    "lastGameOutcome",
  ]);
  if (typeof activeRoomId === "string") {
    if (isActiveGame(activeGame) && isActiveRun(activeRun)) {
      statusElement.textContent = "경기 중";
      description.textContent = `목표: ${activeGame.targetArticleTitle}`;
      gameControls.hidden = false;
    } else {
      statusElement.textContent = "연결됨";
      description.textContent = isGameOutcome(lastGameOutcome)
        ? lastGameOutcome.outcome === "finished"
          ? "완주 기록을 전송했습니다. 다음 경기 시작을 기다립니다."
          : "포기 처리가 완료됐습니다. 다음 경기 시작을 기다립니다."
        : "대기실과 연결되었습니다. 웹에서 준비 상태를 완료하세요.";
      gameControls.hidden = true;
    }
    pairingForm.hidden = true;
    return;
  }

  statusElement.textContent = "미연결";
  description.textContent = "웹 대기실에서 발급한 8자리 코드를 입력하세요.";
  pairingForm.hidden = false;
  gameControls.hidden = true;
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
