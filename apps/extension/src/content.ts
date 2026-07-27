import { articleKeyFromCanonical, normalizeNamuWikiUrl } from "@wikirunner/namuwiki";

const canonicalUrl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
const article = articleKeyFromCanonical(canonicalUrl, window.location.href);

if (article.ok && !document.querySelector("#wikirunner-root")) {
  let currentArticle = article;
  const host = document.createElement("aside");
  host.id = "wikirunner-root";
  host.setAttribute("aria-label", "WikiRunner 경기 상태");

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        top: 18px;
        right: 18px;
        color: #f4f1e8;
        font-family: Arial, "Apple SD Gothic Neo", sans-serif;
      }
      section {
        width: 220px;
        border: 1px solid #d9ff43;
        background: #191b1a;
        box-shadow: 5px 5px 0 rgb(217 255 67 / 45%);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid #4c4f4c;
      }
      strong {
        color: #d9ff43;
        font-size: 13px;
        letter-spacing: -0.3px;
      }
      button {
        border: 0;
        color: #f4f1e8;
        background: transparent;
        cursor: pointer;
      }
      dl {
        display: grid;
        grid-template-columns: 48px 1fr;
        gap: 8px;
        margin: 0;
        padding: 12px;
        font-size: 12px;
      }
      dt {
        color: #92968f;
      }
      dd {
        overflow: hidden;
        margin: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      section[data-collapsed="true"] dl {
        display: none;
      }
    </style>
    <section>
      <header>
        <strong>WikiRunner</strong>
        <button type="button" aria-label="오버레이 접기" aria-expanded="true">−</button>
      </header>
      <dl>
        <dt>현재</dt><dd id="current-article" title="${escapeHtml(article.title)}">${escapeHtml(
          article.title,
        )}</dd>
        <dt>목표</dt><dd id="target">연결 대기</dd>
        <dt>시간</dt><dd id="timer">--:--.--</dd>
        <dt>이동</dt><dd id="move-count">0회</dd>
        <dt>상태</dt><dd id="game-status">미연결</dd>
      </dl>
    </section>
  `;

  const panel = shadow.querySelector("section");
  const toggle = shadow.querySelector<HTMLButtonElement>("button");
  toggle?.addEventListener("click", () => {
    const collapsed = panel?.dataset.collapsed !== "true";
    if (panel) {
      panel.dataset.collapsed = String(collapsed);
    }
    toggle.textContent = collapsed ? "+" : "−";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });

  document.documentElement.append(host);

  const currentArticleElement = shadow.querySelector<HTMLElement>("#current-article");
  const targetElement = shadow.querySelector<HTMLElement>("#target");
  const timerElement = shadow.querySelector<HTMLElement>("#timer");
  const moveCountElement = shadow.querySelector<HTMLElement>("#move-count");
  const statusElement = shadow.querySelector<HTMLElement>("#game-status");
  let activeGame: ActiveGame | undefined;
  let activeRun: ActiveRun | undefined;
  let lastEventError: string | undefined;

  const renderGame = () => {
    if (
      !currentArticleElement ||
      !targetElement ||
      !timerElement ||
      !moveCountElement ||
      !statusElement
    ) {
      return;
    }
    currentArticleElement.textContent = currentArticle.title;
    currentArticleElement.title = currentArticle.title;
    if (!activeGame) {
      targetElement.textContent = "연결 대기";
      timerElement.textContent = "--:--.--";
      moveCountElement.textContent = "0회";
      statusElement.textContent = "미연결";
      return;
    }

    targetElement.textContent = activeGame.targetArticleTitle;
    targetElement.title = activeGame.targetArticleTitle;
    moveCountElement.textContent = `${activeRun?.moveCount ?? 0}회`;
    const scheduledTime = new Date(activeGame.scheduledAt).getTime();
    const delta = Date.now() - scheduledTime;
    if (delta < 0) {
      timerElement.textContent = `-${Math.ceil(Math.abs(delta) / 1000)}초`;
      statusElement.textContent = "카운트다운";
      return;
    }

    timerElement.textContent = formatElapsed(delta);
    statusElement.textContent = lastEventError
      ? "기록 전송 오류"
      : activeRun?.status === "finished" ||
          currentArticle.articleKey === activeGame.targetArticleKey
        ? "완주"
        : activeRun?.violationStatus === "warned"
          ? "진행 중 · 경고 있음"
          : "진행 중";
    statusElement.title = lastEventError ?? "";
  };

  void chrome.storage.local
    .get(["activeGame", "activeRun", "lastEventError"])
    .then(({ activeGame: storedGame, activeRun: storedRun, lastEventError: storedError }) => {
      activeGame = isActiveGame(storedGame) ? storedGame : undefined;
      activeRun = isActiveRun(storedRun) ? storedRun : undefined;
      lastEventError = typeof storedError === "string" ? storedError : undefined;
      renderGame();
    });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (changes.activeGame) {
      activeGame = isActiveGame(changes.activeGame.newValue)
        ? changes.activeGame.newValue
        : undefined;
    }
    if (changes.activeRun) {
      activeRun = isActiveRun(changes.activeRun.newValue) ? changes.activeRun.newValue : undefined;
    }
    if (changes.lastEventError) {
      lastEventError =
        typeof changes.lastEventError.newValue === "string"
          ? changes.lastEventError.newValue
          : undefined;
    }
    renderGame();
  });

  document.addEventListener(
    "click",
    (clickEvent) => {
      const clickedElement =
        clickEvent.target instanceof Element
          ? clickEvent.target.closest<HTMLAnchorElement>("a")
          : null;
      if (
        !clickedElement ||
        !activeGame ||
        Date.now() < new Date(activeGame.scheduledAt).getTime()
      ) {
        return;
      }

      const destination = normalizeNamuWikiUrl(clickedElement.href);
      if (!destination.ok) {
        return;
      }

      void chrome.runtime.sendMessage({
        type: "LINK_INTENT",
        fromArticleKey: currentArticle.articleKey,
        toArticleKey: destination.articleKey,
        observedAt: new Date().toISOString(),
      });
    },
    { capture: true },
  );

  window.setInterval(() => {
    const observedArticle = normalizeNamuWikiUrl(window.location.href);
    if (observedArticle.ok && observedArticle.articleKey !== currentArticle.articleKey) {
      currentArticle = observedArticle;
      void chrome.runtime.sendMessage({
        type: "PAGE_NAVIGATION_OBSERVED",
        articleKey: observedArticle.articleKey,
        observedAt: new Date().toISOString(),
      });
    }
    renderGame();
  }, 100);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatElapsed(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const hundredths = Math.floor((milliseconds % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    hundredths,
  ).padStart(2, "0")}`;
}

interface ActiveGame {
  scheduledAt: string;
  targetArticleKey: string;
  targetArticleTitle: string;
}

interface ActiveRun {
  status: "waiting" | "running" | "finished";
  moveCount: number;
  violationStatus: "clear" | "warned" | "reviewed";
}

function isActiveGame(value: unknown): value is ActiveGame {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ActiveGame>;
  return (
    typeof candidate.scheduledAt === "string" &&
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
    (candidate.status === "waiting" ||
      candidate.status === "running" ||
      candidate.status === "finished") &&
    typeof candidate.moveCount === "number" &&
    (candidate.violationStatus === "clear" ||
      candidate.violationStatus === "warned" ||
      candidate.violationStatus === "reviewed")
  );
}
