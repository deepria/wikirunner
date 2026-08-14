"use client";

import type { RoomSnapshot } from "@wikirunner/contracts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CopyButton } from "../../../components/copy-button";
import { CountdownClock } from "../../../components/countdown-clock";
import { Leaderboard } from "../../../components/leaderboard";
import { PlayerControls } from "../../../components/player-controls";
import { RoomSettingsForm } from "../../../components/room-settings-form";
import { endGame, getRoomSnapshot, leaveOrKickPlayer, prepareNextGame, startCountdown } from "../../../lib/game-api";

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [snapshot, setSnapshot] = useState<RoomSnapshot>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string>();
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isPreparingNextGame, setIsPreparingNextGame] = useState(false);
  const [isRemovingPlayerId, setIsRemovingPlayerId] = useState<string>();

  const loadSnapshot = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      setSnapshot(await getRoomSnapshot(roomId));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "대기실 정보를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void getRoomSnapshot(roomId)
        .then(setSnapshot)
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [roomId]);

  if (isLoading && !snapshot) {
    return (
      <main className="lobby-page">
        <p className="eyebrow">LOADING ROOM</p>
        <h1>대기실을 불러오는 중…</h1>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="lobby-page">
        <p className="eyebrow">ROOM ERROR</p>
        <h1>대기실에 연결하지 못했습니다.</h1>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button className="retry-button" type="button" onClick={loadSnapshot}>
          다시 시도
        </button>
      </main>
    );
  }

  const currentPlayer = snapshot.players.find((player) => player.isCurrentPlayer);
  const isCurrentPlayerHost = currentPlayer?.id === snapshot.room.hostPlayerId;
  const readyPlayerCount = snapshot.players.filter(
    (player) => player.extensionConnected && player.readyAt !== null,
  ).length;
  const canStart =
    isCurrentPlayerHost &&
    snapshot.room.status === "waiting" &&
    snapshot.room.draftSettings !== null &&
    snapshot.players.every((player) => player.extensionConnected && player.readyAt !== null);

  async function handleStartCountdown() {
    if (!snapshot) {
      return;
    }

    setActionError(undefined);
    setIsStarting(true);
    try {
      await startCountdown(snapshot.room.id, snapshot.room.version);
      await loadSnapshot();
    } catch (startError) {
      setActionError(
        startError instanceof Error ? startError.message : "카운트다운을 시작하지 못했습니다.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEndGame() {
    if (!snapshot?.game) {
      return;
    }
    if (!window.confirm("현재 경기를 종료할까요? 진행 중인 참가자의 기록은 종료됩니다.")) {
      return;
    }

    setActionError(undefined);
    setIsEnding(true);
    try {
      await endGame(snapshot.game.id);
      await loadSnapshot();
    } catch (endError) {
      setActionError(
        endError instanceof Error ? endError.message : "현재 경기를 종료하지 못했습니다.",
      );
    } finally {
      setIsEnding(false);
    }
  }

  async function handlePrepareNextGame() {
    if (!snapshot) {
      return;
    }

    setActionError(undefined);
    setIsPreparingNextGame(true);
    try {
      await prepareNextGame(snapshot.room.id, snapshot.room.version);
      await loadSnapshot();
    } catch (prepareError) {
      setActionError(
        prepareError instanceof Error
          ? prepareError.message
          : "다음 경기 준비 상태로 전환하지 못했습니다.",
      );
    } finally {
      setIsPreparingNextGame(false);
    }
  }

  async function handleRemovePlayer(playerId: string, isSelf: boolean) {
    if (!snapshot || !window.confirm(isSelf ? "방에서 나갈까요?" : "이 참가자를 강퇴할까요?")) return;
    setActionError(undefined);
    setIsRemovingPlayerId(playerId);
    try {
      await leaveOrKickPlayer(playerId);
      if (isSelf) {
        window.postMessage({ type: "WIKIRUNNER_ROOM_LEFT", roomId: snapshot.room.id }, window.location.origin);
        window.location.assign("/");
        return;
      }
      await loadSnapshot();
    } catch (removeError) {
      setActionError(removeError instanceof Error ? removeError.message : "참가자 상태를 변경하지 못했습니다.");
    } finally {
      setIsRemovingPlayerId(undefined);
    }
  }

  return (
    <main className="lobby-page">
      <nav aria-label="대기실 메뉴">
        <a className="brand" href="/">
          WikiRunner
        </a>
        <span className="status">{currentPlayer?.nickname ?? "참가자"} · {roomStatusLabel(snapshot.room.status)}</span>
      </nav>

      <header className="lobby-header">
        <div>
          <p className="eyebrow">WIKIRUNNER ROOM</p>
          <div className="room-code-value">
            <h1>대기실</h1>
            <span className="room-code-label">초대 코드</span>
            <span className="room-code">{snapshot.room.inviteCode}</span>
            <CopyButton label="방 코드" value={snapshot.room.inviteCode} />
          </div>
        </div>
        <span className="room-state">{roomStatusLabel(snapshot.room.status)}</span>
      </header>

      {snapshot.room.status === "waiting" && !currentPlayer?.extensionConnected ? (
      <section className="extension-banner" aria-label="Chrome 확장프로그램 설치 안내">
        <span aria-hidden="true" className="extension-banner-mark">!</span>
        <p><strong>확장 프로그램 연결이 필요합니다.</strong></p>
        <a
          href="https://chromewebstore.google.com/detail/bfloccbccjcdlpdmfgmelnicnohagbfi?utm_source=item-share-cb"
          rel="noreferrer"
          target="_blank"
        >
          설치하기 <span aria-hidden="true">↗</span>
        </a>
      </section>
      ) : null}

      <section className="race-overview" aria-labelledby="race-overview-title">
        <div className="race-overview-heading">
          <p className="eyebrow">CURRENT RACE</p>
          <h1 id="race-overview-title">
            {snapshot.game?.status === "running" ? "경기 진행 중" : "시작과 목표"}
          </h1>
        </div>
        {snapshot.room.draftSettings ? (
          <div className="race-route">
            <div>
              <span>시작 문서</span>
              <strong>{snapshot.room.draftSettings.startArticle.title}</strong>
            </div>
            <b aria-hidden="true">→</b>
            <div>
              <span>목표 문서</span>
              <strong>{snapshot.room.draftSettings.targetArticle.title}</strong>
            </div>
          </div>
        ) : (
          <p className="race-empty">방장이 시작 문서와 목표 문서를 설정하면 여기에 표시됩니다.</p>
        )}
      </section>

      {snapshot.game?.status === "countdown" ? (
        <CountdownClock scheduledAt={snapshot.game.scheduledAt} />
      ) : null}

      {isCurrentPlayerHost &&
      snapshot.game &&
      (snapshot.game.status === "countdown" || snapshot.game.status === "running") ? (
        <section className="start-panel">
          <div>
            <p className="eyebrow">HOST CONTROL</p>
            <h2>현재 경기 관리</h2>
            <p>경기를 종료하면 아직 달리고 있는 참가자도 함께 종료 처리됩니다.</p>
          </div>
          <button
            className="danger-button"
            disabled={isEnding}
            type="button"
            onClick={handleEndGame}
          >
            {isEnding ? "경기 종료 중…" : "현재 경기 종료"}
          </button>
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>
      ) : null}

      {currentPlayer ? (
        <PlayerControls
          player={currentPlayer}
          roomStatus={snapshot.room.status}
          onChanged={loadSnapshot}
        />
      ) : null}

      <section className={isCurrentPlayerHost ? "lobby-grid" : "lobby-grid lobby-grid-player-only"}>
        {isCurrentPlayerHost ? (
        <article className="lobby-card settings-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">RACE SETUP</p>
              <h2>경기 설정</h2>
            </div>
            {isCurrentPlayerHost ? <span>방장</span> : null}
          </div>
          {isCurrentPlayerHost && snapshot.room.status === "waiting" ? (
            <RoomSettingsForm
              key={snapshot.room.version}
              currentPlayerCount={snapshot.players.length}
              initialStartArticle={snapshot.room.draftSettings?.startArticle.title ?? ""}
              initialTargetArticle={snapshot.room.draftSettings?.targetArticle.title ?? ""}
              maxPlayers={snapshot.room.maxPlayers}
              randomGenerationCount={snapshot.room.draftSettings?.randomGenerationCount ?? 0}
              initialRankingCriterion={snapshot.room.draftSettings?.rankingCriterion ?? "time"}
              roomId={snapshot.room.id}
              version={snapshot.room.version}
              onSaved={loadSnapshot}
            />
          ) : snapshot.room.draftSettings ? (
            <dl className="settings-list">
              <dt>시작</dt>
              <dd>{snapshot.room.draftSettings.startArticle.title}</dd>
              <dt>목표</dt>
              <dd>{snapshot.room.draftSettings.targetArticle.title}</dd>
            </dl>
          ) : (
            <p className="empty-message">방장이 시작 문서와 목표 문서를 정하면 이곳에 표시됩니다.</p>
          )}
        </article>
        ) : null}

        <article className="lobby-card participants-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">PLAYERS</p>
              <h2>참가자</h2>
            </div>
            <span>
              {snapshot.players.length}/{snapshot.room.maxPlayers}
            </span>
          </div>
          <ul className="player-list">
            {snapshot.players.map((player) => (
              <li key={player.id}>
                <span aria-hidden="true" className="presence" title={player.connectionStatus} />
                <div className="player-name">
                  <strong>{player.nickname}</strong>
                  <span>{playerMetaLabel(player)}</span>
                </div>
                <span className={player.readyAt && player.extensionConnected ? "player-readiness is-ready" : "player-readiness"}>
                  {player.readyAt && player.extensionConnected ? "준비 완료" : player.extensionConnected ? "준비 필요" : "연결 필요"}
                </span>
                {snapshot.room.status === "waiting" &&
                (player.isCurrentPlayer || isCurrentPlayerHost) &&
                !player.isHost ? (
                  <button
                    className="player-remove-button"
                    disabled={isRemovingPlayerId === player.id}
                    type="button"
                    onClick={() => void handleRemovePlayer(player.id, player.isCurrentPlayer)}
                  >
                    {isRemovingPlayerId === player.id ? "처리 중…" : player.isCurrentPlayer ? "방 나가기" : "강퇴"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </article>
      </section>

      {snapshot.game && snapshot.runs.length > 0 ? (
        <Leaderboard key={snapshot.game.id} game={snapshot.game} runs={snapshot.runs} isHost={isCurrentPlayerHost} onChanged={loadSnapshot} />
      ) : null}

      {isCurrentPlayerHost && snapshot.room.status === "waiting" ? (
        <section className="start-panel">
          <div>
            <p className="eyebrow">HOST CONTROL</p>
            <h2>{readyPlayerCount}/{snapshot.players.length}명 준비 완료</h2>
            <p>{canStart ? "모두 준비됐습니다. 시작하면 서버 시각 기준 10초 카운트다운이 진행됩니다." : "전원이 확장을 연결하고 준비를 완료하면 시작할 수 있습니다."}</p>
          </div>
          <button disabled={!canStart || isStarting} type="button" onClick={handleStartCountdown}>
            {isStarting ? "시작 준비 중…" : "10초 카운트다운 시작"}
          </button>
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>
      ) : null}

      {isCurrentPlayerHost && snapshot.room.status === "finished" ? (
        <section className="start-panel next-game-panel">
          <div>
            <p className="eyebrow">NEXT ROUND</p>
            <h2>같은 방에서 다음 경기</h2>
            <p>
              참가자 연결은 유지하고 준비 상태만 초기화합니다. 문서 설정도 다시 바꿀 수 있습니다.
            </p>
          </div>
          <button disabled={isPreparingNextGame} type="button" onClick={handlePrepareNextGame}>
            {isPreparingNextGame ? "준비 상태로 전환 중…" : "다음 경기 준비"}
          </button>
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function roomStatusLabel(status: RoomSnapshot["room"]["status"]): string {
  return { waiting: "대기 중", countdown: "카운트다운", running: "경기 중", finished: "결과 확인", closed: "종료됨" }[status];
}

function playerMetaLabel(player: RoomSnapshot["players"][number]): string {
  if (player.isHost) return player.isCurrentPlayer ? "방장 · 나" : "방장";
  return player.isCurrentPlayer ? "나" : "참가자";
}
