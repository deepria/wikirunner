"use client";

import type { RoomSnapshot } from "@wikirunner/contracts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CountdownClock } from "../../../components/countdown-clock";
import { PlayerControls } from "../../../components/player-controls";
import { RoomSettingsForm } from "../../../components/room-settings-form";
import { getRoomSnapshot, startCountdown } from "../../../lib/game-api";

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [snapshot, setSnapshot] = useState<RoomSnapshot>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string>();
  const [isStarting, setIsStarting] = useState(false);

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

  if (isLoading) {
    return (
      <main className="lobby-page">
        <p className="eyebrow">LOADING ROOM</p>
        <h1>대기실을 불러오는 중…</h1>
      </main>
    );
  }

  if (error || !snapshot) {
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

  return (
    <main className="lobby-page">
      <nav aria-label="대기실 메뉴">
        <a className="brand" href="/">
          WikiRunner
        </a>
        <span className="status">{currentPlayer?.nickname ?? "참가자"} 님 · 접속 중</span>
      </nav>

      <header className="lobby-header">
        <div>
          <p className="eyebrow">ROOM CODE</p>
          <h1>{snapshot.room.inviteCode}</h1>
          <p>이 코드를 함께 플레이할 사람에게 공유하세요.</p>
        </div>
        <span className="room-state">{snapshot.room.status}</span>
      </header>

      {snapshot.game?.status === "countdown" ? (
        <CountdownClock scheduledAt={snapshot.game.scheduledAt} />
      ) : null}

      {currentPlayer ? (
        <PlayerControls
          player={currentPlayer}
          roomStatus={snapshot.room.status}
          onChanged={loadSnapshot}
        />
      ) : null}

      <section className="lobby-grid">
        <article className="lobby-card">
          <div className="card-heading">
            <h2>참가자</h2>
            <span>
              {snapshot.players.length}/{snapshot.room.maxPlayers}
            </span>
          </div>
          <ul className="player-list">
            {snapshot.players.map((player) => (
              <li key={player.id}>
                <span aria-hidden="true" className="presence" title={player.connectionStatus} />
                <strong>{player.nickname}</strong>
                {player.isHost ? <small>방장</small> : null}
                {player.isCurrentPlayer ? <small>나</small> : null}
                {player.extensionConnected ? <small>확장 연결</small> : null}
                {player.readyAt ? <small>준비됨</small> : null}
              </li>
            ))}
          </ul>
        </article>

        <article className="lobby-card">
          <div className="card-heading">
            <h2>경기 설정</h2>
          </div>
          {isCurrentPlayerHost && snapshot.room.status === "waiting" ? (
            <RoomSettingsForm
              key={snapshot.room.version}
              currentPlayerCount={snapshot.players.length}
              initialStartArticle={snapshot.room.draftSettings?.startArticle.title ?? ""}
              initialTargetArticle={snapshot.room.draftSettings?.targetArticle.title ?? ""}
              maxPlayers={snapshot.room.maxPlayers}
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
            <p className="empty-message">
              방장이 시작 문서와 목표 문서를 정하면 이곳에 표시됩니다.
            </p>
          )}
        </article>
      </section>

      {snapshot.runs.length > 0 ? (
        <section className="leaderboard-panel">
          <div className="card-heading">
            <div>
              <p className="eyebrow">LIVE RESULT</p>
              <h2>실시간 경기 현황</h2>
            </div>
            <span>{snapshot.game?.targetArticle.title} 도착 순</span>
          </div>
          <ol className="leaderboard-list">
            {snapshot.runs.map((run) => (
              <li key={run.id}>
                <strong>{run.rank ? `${run.rank}위` : "진행 중"}</strong>
                <span>{run.nickname}</span>
                <span>
                  {run.moveCount === null ? `${run.lastSequence}개 기록` : `${run.moveCount}회`}
                </span>
                <span>{run.durationMs === null ? run.status : formatDuration(run.durationMs)}</span>
                {run.violationStatus === "warned" ? <small>경고 확인 필요</small> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {isCurrentPlayerHost && snapshot.room.status === "waiting" ? (
        <section className="start-panel">
          <div>
            <p className="eyebrow">HOST CONTROL</p>
            <h2>모두 준비됐나요?</h2>
            <p>시작하면 서버 시각 기준 10초 카운트다운이 진행됩니다.</p>
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
    </main>
  );
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  const hundredths = Math.floor((durationMs % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    hundredths,
  ).padStart(2, "0")}`;
}
