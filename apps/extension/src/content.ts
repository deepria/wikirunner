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
      .finish-banner {
        display: grid;
        gap: 3px;
        padding: 12px;
        border-bottom: 1px solid #4c4f4c;
        background: #d9ff43;
        color: #191b1a;
      }
      .finish-banner strong {
        color: inherit;
        font-size: 16px;
      }
      .finish-banner span {
        font-size: 11px;
        font-weight: 700;
      }
      .fair-play-notice {
        padding: 9px 12px;
        border-bottom: 1px solid #4c4f4c;
        background: #a32314;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.4;
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
      .overlay-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        padding: 0 12px 12px;
      }
      .overlay-actions button {
        min-height: 30px;
        border: 1px solid #4c4f4c;
        font-size: 11px;
        font-weight: 700;
      }
      .overlay-actions .danger {
        border-color: #a32314;
        background: #a32314;
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
      section[data-collapsed="true"] .finish-banner,
      section[data-collapsed="true"] .fair-play-notice {
        display: none;
      }
    </style>
    <section>
      <header>
        <strong>WikiRunner</strong>
        <div>
          <button id="overlay-collapse" type="button" aria-label="오버레이 접기" aria-expanded="true">접기</button>
          <button id="overlay-hide" type="button" aria-label="오버레이 숨기기">숨기기</button>
        </div>
      </header>
      <div class="finish-banner" id="finish-banner" hidden role="status" aria-live="polite">
        <strong id="finish-title">경기 진행중.. 달리세요!</strong>
        <span id="finish-detail">완주 기록을 전송 중입니다.</span>
      </div>
      <div class="fair-play-notice" id="fair-play-notice" hidden role="status" aria-live="polite"></div>
      <dl>
        <dt>현재</dt><dd id="current-article" title="${escapeHtml(article.title)}">${escapeHtml(
          article.title,
        )}</dd>
        <dt>목표</dt><dd id="target">연결 대기</dd>
        <dt>시간</dt><dd id="timer">--:--.--</dd>
        <dt>이동</dt><dd id="move-count">0회</dd>
        <dt>상태</dt><dd id="game-status">미연결</dd>
      </dl>
      <div class="overlay-actions" id="overlay-actions" hidden>
        <button class="danger" id="overlay-abandon" type="button">포기</button>
        <button id="overlay-open-room" type="button">방으로 이동</button>
      </div>
    </section>
  `;

  const panel = shadow.querySelector("section");
  const toggle = shadow.querySelector<HTMLButtonElement>("#overlay-collapse");
  const hideOverlayButton = shadow.querySelector<HTMLButtonElement>("#overlay-hide");
  const overlayActions = shadow.querySelector<HTMLElement>("#overlay-actions");
  const abandonOverlayButton = shadow.querySelector<HTMLButtonElement>("#overlay-abandon");
  const openRoomOverlayButton = shadow.querySelector<HTMLButtonElement>("#overlay-open-room");
  toggle?.addEventListener("click", () => {
    const collapsed = panel?.dataset.collapsed !== "true";
    if (panel) {
      panel.dataset.collapsed = String(collapsed);
    }
    toggle.textContent = collapsed ? "펼치기" : "접기";
    toggle.setAttribute("aria-label", collapsed ? "오버레이 펼치기" : "오버레이 접기");
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });

  function setOverlayVisibility(visibility: "visible" | "hidden"): void {
    host.style.display = visibility === "hidden" ? "none" : "";
    host.setAttribute("aria-hidden", visibility === "hidden" ? "true" : "false");
  }

  hideOverlayButton?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "SET_OVERLAY_VISIBILITY", visibility: "hidden" });
  });

  abandonOverlayButton?.addEventListener("click", () => {
    if (!window.confirm("이번 경기를 포기할까요? 기록은 포기로 남습니다.")) {
      return;
    }
    abandonOverlayButton.disabled = true;
    void chrome.runtime
      .sendMessage({ type: "ABANDON_ACTIVE_GAME" })
      .then((response: unknown) => {
        if (!isSuccessfulResponse(response)) {
          throw new Error("경기 포기를 처리하지 못했습니다.");
        }
      })
      .catch(() => {
        abandonOverlayButton.disabled = false;
        showFairPlayNotice("경기 포기를 처리하지 못했습니다. 확장 프로그램 팝업에서 다시 시도하세요.");
      });
  });

  openRoomOverlayButton?.addEventListener("click", () => {
    void chrome.runtime
      .sendMessage({ type: "OPEN_ACTIVE_ROOM" })
      .then((response: unknown) => {
        if (!isSuccessfulResponse(response)) {
          throw new Error("방 화면을 열지 못했습니다.");
        }
      })
      .catch(() => showFairPlayNotice("방 화면을 열지 못했습니다. 확장 프로그램 팝업에서 다시 시도하세요."));
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (
      message !== null &&
      typeof message === "object" &&
      (message as { type?: unknown }).type === "SET_OVERLAY_VISIBILITY" &&
      ((message as { visibility?: unknown }).visibility === "visible" ||
        (message as { visibility?: unknown }).visibility === "hidden")
    ) {
      setOverlayVisibility((message as { visibility: "visible" | "hidden" }).visibility);
      sendResponse({ ok: true });
    }
  });

  document.documentElement.append(host);

  void chrome.runtime
    .sendMessage({ type: "GET_OVERLAY_VISIBILITY" })
    .then((response: unknown) => {
      if (
        response !== null &&
        typeof response === "object" &&
        (response as { visibility?: unknown }).visibility === "hidden"
      ) {
        setOverlayVisibility("hidden");
      }
    })
    .catch(() => undefined);

  const currentArticleElement = shadow.querySelector<HTMLElement>("#current-article");
  const targetElement = shadow.querySelector<HTMLElement>("#target");
  const timerElement = shadow.querySelector<HTMLElement>("#timer");
  const moveCountElement = shadow.querySelector<HTMLElement>("#move-count");
  const statusElement = shadow.querySelector<HTMLElement>("#game-status");
  const finishBanner = shadow.querySelector<HTMLElement>("#finish-banner");
  const finishTitleElement = shadow.querySelector<HTMLElement>("#finish-title");
  const finishDetailElement = shadow.querySelector<HTMLElement>("#finish-detail");
  const fairPlayNotice = shadow.querySelector<HTMLElement>("#fair-play-notice");
  let activeGame: ActiveGame | undefined;
  let activeRun: ActiveRun | undefined;
  let lastEventError: string | undefined;
  let lastGameOutcome: GameOutcome | undefined;
  let lastCompletedGame: CompletedGame | undefined;
  let fairPlayEnabled = false;
  let fairPlayNoticeTimer: number | undefined;
  let fairPlayUiRefreshTimer: number | undefined;

  const renderGame = () => {
    if (
      !currentArticleElement ||
      !targetElement ||
      !timerElement ||
      !moveCountElement ||
      !statusElement ||
      !finishBanner ||
      !finishTitleElement ||
      !finishDetailElement
    ) {
      return;
    }
    currentArticleElement.textContent = currentArticle.title;
    currentArticleElement.title = currentArticle.title;
    if (!activeGame) {
      if (overlayActions) {
        overlayActions.hidden = true;
      }
      targetElement.textContent = "연결 대기";
      timerElement.textContent = "--:--.--";
      moveCountElement.textContent = "0회";
      const isCompletedAtCurrentArticle =
        lastGameOutcome?.outcome === "finished" &&
        lastCompletedGame?.targetArticleKey === currentArticle.articleKey;
      finishBanner.hidden = !isCompletedAtCurrentArticle;
      if (isCompletedAtCurrentArticle && lastCompletedGame) {
        finishTitleElement.textContent = "완주 기록 완료!";
        finishDetailElement.textContent = `${lastCompletedGame.targetArticleTitle}에 도착했습니다.`;
        statusElement.textContent = "완주";
      } else {
        statusElement.textContent = "미연결";
      }
      return;
    }

    targetElement.textContent = activeGame.targetArticleTitle;
    if (overlayActions) {
      overlayActions.hidden = activeRun?.status === "finished";
    }
    targetElement.title = activeGame.targetArticleTitle;
    moveCountElement.textContent = `${activeRun?.moveCount ?? 0}회`;
    const scheduledTime = new Date(activeGame.scheduledAt).getTime();
    const delta = Date.now() - scheduledTime;
    if (delta < 0) {
      finishBanner.hidden = true;
      timerElement.textContent = `-${Math.ceil(Math.abs(delta) / 1000)}초`;
      statusElement.textContent = "카운트다운";
      return;
    }

    timerElement.textContent = formatElapsed(delta);
    const hasRecordedTargetArrival =
      (activeRun?.lastSequence ?? 0) > 0 &&
      currentArticle.articleKey === activeGame.targetArticleKey &&
      activeRun?.lastArticleKey === activeGame.targetArticleKey;
    finishBanner.hidden = !hasRecordedTargetArrival;
    if (hasRecordedTargetArrival) {
      if (lastEventError) {
        finishTitleElement.textContent = "경기 진행중.. 달리세요!";
        finishDetailElement.textContent = "완주 기록 전송을 다시 시도하고 있습니다.";
      } else if (activeRun?.status === "finished") {
        finishTitleElement.textContent = "완주 기록 완료!";
        finishDetailElement.textContent = "기록이 서버에 저장되었습니다.";
      } else {
        finishTitleElement.textContent = "경기 진행중.. 달리세요!";
        finishDetailElement.textContent = "완주 기록을 전송 중입니다.";
      }
    }
    statusElement.textContent = lastEventError
      ? "기록 전송 오류"
      : activeRun?.status === "finished"
        ? "완주"
        : activeRun?.violationStatus === "warned"
          ? "진행 중 · 경고 있음"
          : "진행 중";
    statusElement.title = lastEventError ?? "";
  };

  void chrome.storage.local
    .get(["activeGame", "activeRun", "lastEventError", "lastGameOutcome", "lastCompletedGame"])
    .then(
      ({
        activeGame: storedGame,
        activeRun: storedRun,
        lastEventError: storedError,
        lastGameOutcome: storedOutcome,
        lastCompletedGame: storedCompletedGame,
      }) => {
        activeGame = isActiveGame(storedGame) ? storedGame : undefined;
        activeRun = isActiveRun(storedRun) ? storedRun : undefined;
        lastEventError = typeof storedError === "string" ? storedError : undefined;
        lastGameOutcome = isGameOutcome(storedOutcome) ? storedOutcome : undefined;
        lastCompletedGame = isCompletedGame(storedCompletedGame) ? storedCompletedGame : undefined;
        renderGame();
      },
    );

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
    if (changes.lastGameOutcome) {
      lastGameOutcome = isGameOutcome(changes.lastGameOutcome.newValue)
        ? changes.lastGameOutcome.newValue
        : undefined;
    }
    if (changes.lastCompletedGame) {
      lastCompletedGame = isCompletedGame(changes.lastCompletedGame.newValue)
        ? changes.lastCompletedGame.newValue
        : undefined;
    }
    renderGame();
    if (changes.activeGame || changes.gameTabId) {
      void synchronizeFairPlayBlocking();
    }
  });

  async function synchronizeFairPlayBlocking(): Promise<void> {
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: "GET_FAIR_PLAY_STATE" });
      fairPlayEnabled =
        response !== null &&
        typeof response === "object" &&
        (response as { enabled?: unknown }).enabled === true;
    } catch {
      fairPlayEnabled = false;
    }
    applyFairPlayUiBlocking();
  }

  function applyFairPlayUiBlocking(): void {
    document.documentElement.classList.toggle("wikirunner-fair-play-active", fairPlayEnabled);
    if (!fairPlayEnabled) {
      for (const link of document.querySelectorAll<HTMLElement>(
        ".wikirunner-fair-play-blocked-link",
      )) {
        link.classList.remove("wikirunner-fair-play-blocked-link");
      }
    }
    const header = document.querySelector<HTMLElement>(
      "#app > div > div:first-child, body > header",
    );
    if (header?.querySelector('input[type="search"], a[href="/random"]')) {
      header.classList.toggle("wikirunner-fair-play-hidden", fairPlayEnabled);
    }
    for (const sidebar of findFairPlaySidebars()) {
      sidebar.classList.toggle("wikirunner-fair-play-hidden", fairPlayEnabled);
    }
    for (const target of document.querySelectorAll<HTMLElement>(
      'input[type="search"], a[href="/random"], a[title="검색"], a[title="아무 문서로 이동"]',
    )) {
      const container = target.matches('input[type="search"]')
        ? target.closest("form")?.parentElement
        : target.closest("a");
      (container ?? target).classList.toggle("wikirunner-fair-play-hidden", fairPlayEnabled);
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a")) {
      if (link.textContent?.replaceAll(/\s+/g, "").includes("실시간검색어")) {
        (link.closest("li") ?? link).classList.toggle(
          "wikirunner-fair-play-hidden",
          fairPlayEnabled,
        );
      }
    }
  }

  function findFairPlaySidebars(): HTMLElement[] {
    const sidebars = new Set<HTMLElement>();
    // Only hide the fair-play shortcuts themselves.  A broad sidebar selector
    // can also catch advertisements or other unrelated right-rail content.
    const sidebarMarkers = ["실시간 랭킹", "실시간 검색어", "인기 문서", "최근 변경"];
    for (const marker of sidebarMarkers) {
      for (const element of document.querySelectorAll<HTMLElement>(
        "a, span, strong, p, li, h1, h2, h3, h4, h5, h6, div",
      )) {
        const text = element.textContent?.replaceAll(/\s+/g, "") ?? "";
        if (!text.includes(marker.replaceAll(/\s+/g, ""))) {
          continue;
        }
        const sidebar = closestSidebarCard(element, marker);
        if (sidebar) {
          sidebars.add(sidebar);
        }
      }
    }
    return [...sidebars];
  }

  function closestSidebarCard(element: HTMLElement, marker: string): HTMLElement | null {
    const article = document.querySelector("article");
    const markerLength = marker.replaceAll(/\s+/g, "").length;
    let candidate: HTMLElement | null = element;
    for (let depth = 0; candidate && depth < 8; depth += 1) {
      const rect = candidate.getBoundingClientRect();
      const textLength = (candidate.textContent ?? "").replaceAll(/\s+/g, "").length;
      if (
        !candidate.contains(article) &&
        rect.width > 120 &&
        rect.width < 520 &&
        rect.height >= 80 &&
        textLength > markerLength + 2 &&
        rect.left >= window.innerWidth * 0.55
      ) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  }

  function showFairPlayNotice(message: string): void {
    if (!fairPlayNotice) {
      return;
    }
    fairPlayNotice.textContent = message;
    fairPlayNotice.hidden = false;
    if (fairPlayNoticeTimer !== undefined) {
      window.clearTimeout(fairPlayNoticeTimer);
    }
    fairPlayNoticeTimer = window.setTimeout(() => {
      fairPlayNotice.hidden = true;
    }, 3_000);
  }

  function blockedFairPlayReason(target: Element): string | undefined {
    if (target.closest('input[type="search"]')) {
      return "경기 중에는 문서 검색을 사용할 수 없습니다.";
    }
    const link = target.closest<HTMLAnchorElement>("a");
    if (!link) {
      return undefined;
    }
    const href = link.getAttribute("href") ?? "";
    const title = link.getAttribute("title") ?? "";
    if (
      href === "/random" ||
      /^\/(?:Search|search)(?:[/?#]|$)/.test(href) ||
      title === "검색" ||
      title === "아무 문서로 이동"
    ) {
      return "경기 중에는 검색과 랜덤 문서 이동을 사용할 수 없습니다.";
    }

    let decodedHref = href;
    try {
      decodedHref = decodeURIComponent(href);
    } catch {
      // Keep the raw href when an external page supplies malformed encoding.
    }
    if (
      decodedHref.startsWith("/w/분류:") ||
      link.closest('[class*="category" i], [id*="category" i]')
    ) {
      return "경기 중에는 분류 링크를 사용할 수 없습니다.";
    }
    const article = document.querySelector("article");
    if (
      !link.closest("article") &&
      (link.closest("header, nav, aside, [role='navigation'], [role='complementary']") ||
        (article !== null && !article.contains(link)))
    ) {
      return "경기 중에는 본문 링크만 사용할 수 있습니다.";
    }
    return undefined;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (
        !fairPlayEnabled ||
        !(event.target instanceof Element) ||
        !blockedFairPlayReason(event.target)
      ) {
        return;
      }
      const reason = blockedFairPlayReason(event.target);
      if (!reason) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      showFairPlayNotice(reason);
    },
    { capture: true },
  );

  document.addEventListener(
    "pointerover",
    (event) => {
      if (!fairPlayEnabled || !(event.target instanceof Element)) {
        return;
      }
      const link = event.target.closest<HTMLAnchorElement>("a");
      const reason = link ? blockedFairPlayReason(link) : undefined;
      if (!link || !reason) {
        return;
      }
      link.classList.add("wikirunner-fair-play-blocked-link");
      showFairPlayNotice(reason);
    },
    { capture: true },
  );

  document.addEventListener(
    "submit",
    (event) => {
      if (!fairPlayEnabled || !(event.target instanceof HTMLFormElement)) {
        return;
      }
      if (!event.target.querySelector('input[type="search"]')) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      showFairPlayNotice("경기 중에는 문서 검색을 사용할 수 없습니다.");
    },
    { capture: true },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!fairPlayEnabled) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const isSearchInput = target?.matches('input[type="search"]') ?? false;
      const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isBrowserFindShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f";
      const isSlashShortcut =
        event.key === "/" && !target?.matches("input, textarea, [contenteditable=true]");
      if (!isSearchInput && !isSearchShortcut && !isBrowserFindShortcut && !isSlashShortcut) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      showFairPlayNotice(
        isBrowserFindShortcut
          ? "경기 중에는 브라우저 찾기 기능을 사용할 수 없습니다."
          : "경기 중에는 문서 검색 단축키를 사용할 수 없습니다.",
      );
    },
    { capture: true },
  );

  const fairPlayStyle = document.createElement("style");
  fairPlayStyle.textContent = `
    .wikirunner-fair-play-hidden { display: none !important; }
    .wikirunner-fair-play-blocked-link {
      cursor: not-allowed !important;
      text-decoration: line-through !important;
    }
  `;
  document.documentElement.append(fairPlayStyle);
  new MutationObserver(() => {
    if (fairPlayUiRefreshTimer !== undefined) {
      return;
    }
    fairPlayUiRefreshTimer = window.setTimeout(() => {
      fairPlayUiRefreshTimer = undefined;
      applyFairPlayUiBlocking();
    }, 50);
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  void synchronizeFairPlayBlocking();

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
      const previousArticle = currentArticle;
      currentArticle = observedArticle;
      void chrome.runtime.sendMessage({
        type: "PAGE_NAVIGATION_OBSERVED",
        fromArticleKey: previousArticle.articleKey,
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
  lastSequence: number;
  lastArticleKey: string;
  moveCount: number;
  violationStatus: "clear" | "warned" | "reviewed";
}

interface GameOutcome {
  outcome: "finished" | "abandoned";
  occurredAt: string;
}

interface CompletedGame {
  targetArticleKey: string;
  targetArticleTitle: string;
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
    typeof candidate.lastSequence === "number" &&
    typeof candidate.lastArticleKey === "string" &&
    typeof candidate.moveCount === "number" &&
    (candidate.violationStatus === "clear" ||
      candidate.violationStatus === "warned" ||
      candidate.violationStatus === "reviewed")
  );
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

function isCompletedGame(value: unknown): value is CompletedGame {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CompletedGame>;
  return (
    typeof candidate.targetArticleKey === "string" &&
    typeof candidate.targetArticleTitle === "string"
  );
}

function isSuccessfulResponse(value: unknown): value is { ok: true } {
  return value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true;
}
