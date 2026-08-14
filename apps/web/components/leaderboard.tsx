"use client";

import type { NavigationRouteStep, RoomSnapshot } from "@wikirunner/contracts";
import { type SyntheticEvent, useState } from "react";
import { decideViolation, getGameRoutes, getGameViolations } from "../lib/game-api";

interface LeaderboardProps {
  game: NonNullable<RoomSnapshot["game"]>;
  runs: RoomSnapshot["runs"];
  isHost: boolean;
  onChanged: () => Promise<void>;
}

export function Leaderboard({ game, runs, isHost, onChanged }: LeaderboardProps) {
  const [routesByRun, setRoutesByRun] = useState<Record<string, NavigationRouteStep[]>>({});
  const [loadingRunId, setLoadingRunId] = useState<string>();
  const [routeError, setRouteError] = useState<{ runId: string; message: string }>();
  const [violations, setViolations] = useState<Awaited<ReturnType<typeof getGameViolations>>["violations"]>([]);
  async function loadViolations() { setViolations((await getGameViolations(game.id)).violations); }
  async function resolveViolation(id: string, resolution: "accepted" | "disqualified") { await decideViolation(game.id, id, resolution); await loadViolations(); await onChanged(); }

  async function handleRouteToggle(event: SyntheticEvent<HTMLDetailsElement>, runId: string) {
    if (!event.currentTarget.open) {
      return;
    }

    setLoadingRunId(runId);
    setRouteError(undefined);
    try {
      const result = await getGameRoutes(game.id);
      setRoutesByRun(Object.fromEntries(result.routes.map((route) => [route.runId, route.steps])));
    } catch (error) {
      setRouteError({
        runId,
        message:
          error instanceof Error ? error.message : "플레이어 이동 경로를 불러오지 못했습니다.",
      });
    } finally {
      setLoadingRunId(undefined);
    }
  }

  return (
    <section className="leaderboard-panel">
      <div className="card-heading">
        <div>
          <p className="eyebrow">LIVE RESULT</p>
          <h2>실시간 경기 현황</h2>
        </div>
        <span>{game.rankingCriterion === "moves" ? "이동 횟수순" : "완주 시간순"}</span>
      </div>
      <ol className="leaderboard-list">
        {[...runs].sort((left, right) => {
          if (left.rank !== null && right.rank !== null) return left.rank - right.rank;
          if (left.rank !== null) return -1;
          if (right.rank !== null) return 1;
          return 0;
        }).map((run) => {
          const route = routesByRun[run.id];
          return (
            <li key={run.id}>
              <strong>{run.rank ? `${run.rank}위` : runStatusLabel(run.status)}</strong>
              <span>{run.nickname}</span>
              <span>{game.rankingCriterion === "moves" ? `${run.moveCount ?? 0}회` : run.durationMs === null ? run.status : formatDuration(run.durationMs)}</span>
              <span>{game.rankingCriterion === "moves" ? (run.durationMs === null ? run.status : formatDuration(run.durationMs)) : `${run.moveCount ?? 0}회`}</span>
              {run.violationStatus === "warned" ? <small>경고 확인 필요</small> : <span />}
              <details
                className="route-details"
                onToggle={(event) => void handleRouteToggle(event, run.id)}
              >
                <summary>이동 경로 보기</summary>
                {loadingRunId === run.id ? <p>경로를 불러오는 중…</p> : null}
                {routeError?.runId === run.id ? (
                  <p className="form-error" role="alert">
                    {routeError.message}
                  </p>
                ) : null}
                {route ? (
                  <ol className="route-list">
                    <li>
                      <span>출발</span>
                      <strong>{game.startArticle.title}</strong>
                    </li>
                    {route.map((step) => (
                      <li key={step.sequence}>
                        <span>
                          {step.countsAsMove
                            ? `${countMovesThrough(route, step.sequence)}번째`
                            : "기록"}
                        </span>
                        <strong>{step.toArticleKey}</strong>
                        <small>{eventTypeLabel(step.eventType)}</small>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {route?.length === 0 ? <p>아직 기록된 이동이 없습니다.</p> : null}
              </details>
            </li>
          );
        })}
      </ol>
      {isHost ? <section className="generated-path"><h3>경고 검토</h3><button type="button" onClick={() => void loadViolations()}>경고 불러오기</button>{violations.filter((v) => v.resolution === "pending").map((v) => <p key={v.id}>{v.nickname} · {v.type} <button type="button" onClick={() => void resolveViolation(v.id, "accepted")}>수락</button> <button type="button" onClick={() => void resolveViolation(v.id, "disqualified")}>실격</button></p>)}</section> : null}
      {game.generatedPath?.length ? (
        <section className="generated-path">
          <h3>이번 랜덤 생성 경로</h3>
          <ol>
            {game.generatedPath.map((article) => (
              <li key={article.key}>{article.title}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}

function runStatusLabel(status: RoomSnapshot["runs"][number]["status"]): string {
  const labels: Record<RoomSnapshot["runs"][number]["status"], string> = {
    waiting: "대기",
    running: "진행 중",
    finished: "완주",
    abandoned: "종료",
    flagged: "검토 중",
    disqualified: "실격",
  };
  return labels[status];
}

function countMovesThrough(route: NavigationRouteStep[], sequence: number): number {
  return route.filter((step) => step.sequence <= sequence && step.countsAsMove).length;
}

function eventTypeLabel(eventType: NavigationRouteStep["eventType"]): string {
  const labels: Record<NavigationRouteStep["eventType"], string> = {
    link: "문서 링크",
    back: "뒤로 가기",
    forward: "앞으로 가기",
    reload: "새로고침",
    direct: "직접 이동 · 경고",
    tab_resume: "탭 복귀",
  };
  return labels[eventType];
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  const hundredths = Math.floor((durationMs % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    hundredths,
  ).padStart(2, "0")}`;
}
