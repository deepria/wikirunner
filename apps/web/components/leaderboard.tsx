"use client";

import type { NavigationRouteStep, RoomSnapshot } from "@wikirunner/contracts";
import { type SyntheticEvent, useState } from "react";
import { getGameRoutes } from "../lib/game-api";

interface LeaderboardProps {
  game: NonNullable<RoomSnapshot["game"]>;
  runs: RoomSnapshot["runs"];
}

export function Leaderboard({ game, runs }: LeaderboardProps) {
  const [routesByRun, setRoutesByRun] = useState<Record<string, NavigationRouteStep[]>>({});
  const [loadingRunId, setLoadingRunId] = useState<string>();
  const [routeError, setRouteError] = useState<{ runId: string; message: string }>();

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
        <span>{game.targetArticle.title} 도착 순</span>
      </div>
      <ol className="leaderboard-list">
        {runs.map((run) => {
          const route = routesByRun[run.id];
          return (
            <li key={run.id}>
              <strong>{run.rank ? `${run.rank}위` : runStatusLabel(run.status)}</strong>
              <span>{run.nickname}</span>
              <span>{run.moveCount ?? 0}회</span>
              <span>{run.durationMs === null ? run.status : formatDuration(run.durationMs)}</span>
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
