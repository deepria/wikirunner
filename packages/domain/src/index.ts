import type { GameStatus, NavigationEventType, RoomStatus, RunStatus } from "@wikirunner/contracts";

type TransitionMap<T extends string> = Readonly<Record<T, readonly T[]>>;

const roomTransitions: TransitionMap<RoomStatus> = {
  waiting: ["countdown", "closed"],
  countdown: ["waiting", "running"],
  running: ["finished"],
  finished: ["waiting", "closed"],
  closed: [],
};

const gameTransitions: TransitionMap<GameStatus> = {
  countdown: ["running", "cancelled"],
  running: ["finished", "cancelled"],
  finished: [],
  cancelled: [],
};

const runTransitions: TransitionMap<RunStatus> = {
  waiting: ["running", "abandoned"],
  running: ["finished", "abandoned", "flagged", "disqualified"],
  flagged: ["finished", "abandoned", "disqualified"],
  finished: ["flagged", "disqualified"],
  abandoned: [],
  disqualified: [],
};

export const canTransitionRoom = (from: RoomStatus, to: RoomStatus): boolean =>
  roomTransitions[from].includes(to);

export const canTransitionGame = (from: GameStatus, to: GameStatus): boolean =>
  gameTransitions[from].includes(to);

export const canTransitionRun = (from: RunStatus, to: RunStatus): boolean =>
  runTransitions[from].includes(to);

export class InvalidStateTransitionError extends Error {
  constructor(
    readonly entity: "room" | "game" | "run",
    readonly from: string,
    readonly to: string,
  ) {
    super(`${entity} 상태를 ${from}에서 ${to}(으)로 변경할 수 없습니다.`);
    this.name = "InvalidStateTransitionError";
  }
}

export function assertRoomTransition(from: RoomStatus, to: RoomStatus): void {
  if (!canTransitionRoom(from, to)) {
    throw new InvalidStateTransitionError("room", from, to);
  }
}

export function assertGameTransition(from: GameStatus, to: GameStatus): void {
  if (!canTransitionGame(from, to)) {
    throw new InvalidStateTransitionError("game", from, to);
  }
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new InvalidStateTransitionError("run", from, to);
  }
}

export interface RankableRun {
  runId: string;
  status: RunStatus;
  durationMs: number | null;
  moveCount: number | null;
  finishedAt: string | null;
}

export interface RankedRun extends RankableRun {
  rank: number | null;
}

const isFinishedRun = (
  run: RankableRun,
): run is RankableRun & {
  durationMs: number;
  moveCount: number;
  finishedAt: string;
} =>
  (run.status === "finished" || run.status === "flagged") &&
  run.durationMs !== null &&
  run.moveCount !== null &&
  run.finishedAt !== null;

export function compareFinishedRuns(left: RankableRun, right: RankableRun): number {
  if (!isFinishedRun(left) || !isFinishedRun(right)) {
    throw new TypeError("완주한 run만 비교할 수 있습니다.");
  }

  return (
    left.durationMs - right.durationMs ||
    left.moveCount - right.moveCount ||
    left.finishedAt.localeCompare(right.finishedAt) ||
    left.runId.localeCompare(right.runId)
  );
}

export function rankRuns(runs: readonly RankableRun[]): RankedRun[] {
  const rankedIds = new Map(
    runs
      .filter(isFinishedRun)
      .toSorted(compareFinishedRuns)
      .map((run, index) => [run.runId, index + 1] as const),
  );

  return runs.map((run) => ({ ...run, rank: rankedIds.get(run.runId) ?? null }));
}

export const countsAsMove = (type: NavigationEventType): boolean => type === "link";
