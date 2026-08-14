"use client";

import type { RoomSnapshot } from "@wikirunner/contracts";
import { useEffect, useState } from "react";
import { issueAutoPairingNonce, issuePairingCode, setPlayerReady } from "../lib/game-api";
import { CopyButton } from "./copy-button";

type SnapshotPlayer = RoomSnapshot["players"][number];

interface PlayerControlsProps {
  player: SnapshotPlayer;
  roomStatus: RoomSnapshot["room"]["status"];
  onChanged: () => Promise<void>;
}

export function PlayerControls({ player, roomStatus, onChanged }: PlayerControlsProps) {
  const [error, setError] = useState<string>();
  const [pairingCode, setPairingCode] = useState<string>();
  const [expiresAt, setExpiresAt] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>) {
      if (event.origin !== window.location.origin || event.data === null || typeof event.data !== "object") return;
      const message = event.data as { type?: unknown; ok?: unknown; message?: unknown };
      if (message.type !== "WIKIRUNNER_AUTO_PAIR_RESULT") return;
      setIsSubmitting(false);
      if (message.ok !== true) setError(typeof message.message === "string" ? message.message : "확장 프로그램을 연결하지 못했습니다.");
      else void onChanged();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onChanged]);

  async function handleAutoPair() {
    setError(undefined);
    setIsSubmitting(true);
    try {
      const result = await issueAutoPairingNonce(player.id);
      window.postMessage({ type: "WIKIRUNNER_AUTO_PAIR_REQUEST", nonce: result.nonce }, window.location.origin);
    } catch (issueError) {
      setError(
        issueError instanceof Error ? issueError.message : "페어링 코드를 발급하지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleIssuePairingCode() {
    setError(undefined);
    setIsSubmitting(true);
    try {
      const result = await issuePairingCode(player.id);
      setPairingCode(result.pairingCode);
      setExpiresAt(result.expiresAt);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "페어링 코드를 발급하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReadyChange() {
    setError(undefined);
    setIsSubmitting(true);
    try {
      await setPlayerReady(player.id, player.readyAt === null);
      await onChanged();
    } catch (readyError) {
      setError(
        readyError instanceof Error ? readyError.message : "준비 상태를 변경하지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (roomStatus !== "waiting") {
    return null;
  }

  return (
    <section className="connection-panel" aria-labelledby="connection-title">
      <div>
        <p className="eyebrow">YOUR SETUP</p>
        <h2 id="connection-title">내 게임 준비</h2>
      </div>

      {player.extensionConnected ? (
        <div className="connection-action">
          <span className="connection-ok">확장 프로그램 연결됨</span>
          <button disabled={isSubmitting} type="button" onClick={handleReadyChange}>
            {isSubmitting ? "처리 중…" : player.readyAt ? "준비 취소" : "준비 완료"}
          </button>
        </div>
      ) : (
        <div className="connection-action">
          <p>아래 버튼을 누르면 설치된 WikiRunner 확장 프로그램과 자동으로 연결합니다.</p>
          <button disabled={isSubmitting} type="button" onClick={handleAutoPair}>
            {isSubmitting ? "연결 중…" : "확장 프로그램 연결"}
          </button>
          <details>
            <summary>자동 연결이 안 되나요?</summary>
            <p>아래 코드를 확장 프로그램 팝업에 입력해 연결할 수 있습니다.</p>
            {pairingCode ? (
              <div className="pairing-code-value">
                <strong className="pairing-code">{pairingCode.slice(0, 4)}-{pairingCode.slice(4)}</strong>
                <CopyButton label="연동 코드" value={`${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}`} />
                <small>{expiresAt ? `${new Date(expiresAt).toLocaleTimeString("ko-KR")}까지 유효` : "5분 동안 유효"}</small>
              </div>
            ) : null}
            <button disabled={isSubmitting} type="button" onClick={handleIssuePairingCode}>
              {isSubmitting ? "발급 중…" : pairingCode ? "새 코드 발급" : "페어링 코드 발급"}
            </button>
          </details>
        </div>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
