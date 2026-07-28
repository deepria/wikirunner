"use client";

import { type FormEvent, useState } from "react";
import { updateRoomSettings } from "../lib/game-api";

interface RoomSettingsFormProps {
  roomId: string;
  version: number;
  maxPlayers: number;
  currentPlayerCount: number;
  initialStartArticle?: string;
  initialTargetArticle?: string;
  randomGenerationCount: number;
  onSaved: () => Promise<void>;
}

export function RoomSettingsForm({
  roomId,
  version,
  maxPlayers,
  currentPlayerCount,
  initialStartArticle = "",
  initialTargetArticle = "",
  randomGenerationCount,
  onSaved,
}: RoomSettingsFormProps) {
  const [startArticle, setStartArticle] = useState(initialStartArticle);
  const [targetArticle, setTargetArticle] = useState(initialTargetArticle);
  const [capacity, setCapacity] = useState(maxPlayers);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSaved(false);
    setIsSubmitting(true);

    try {
      await updateRoomSettings({
        roomId,
        expectedVersion: version,
        maxPlayers: capacity,
        startArticleTitle: startArticle,
        targetArticleTitle: targetArticle,
      });
      setSaved(true);
      await onSaved();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "경기 설정을 저장하지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <label>
        시작 문서
        <input
          required
          maxLength={300}
          placeholder="예: K리그"
          value={startArticle}
          onChange={(event) => setStartArticle(event.target.value)}
        />
      </label>

      <div className="random-path-controls">
        <strong>랜덤 시작·목표 추첨</strong>
        <p className="form-hint">
          방장 확장 프로그램에서 추첨합니다. 준비마다 {randomGenerationCount}/10회까지 가능합니다.
        </p>
      </div>
      <label>
        목표 문서
        <input
          required
          maxLength={300}
          placeholder="예: 축구"
          value={targetArticle}
          onChange={(event) => setTargetArticle(event.target.value)}
        />
      </label>
      <label>
        최대 인원
        <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}>
          {[2, 3, 4, 5, 6, 8, 10, 12]
            .filter((count) => count >= currentPlayerCount)
            .map((count) => (
              <option key={count} value={count}>
                {count}명
              </option>
            ))}
        </select>
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? <p className="form-success">설정을 저장했습니다.</p> : null}

      <button
        disabled={
          isSubmitting ||
          startArticle.trim().length === 0 ||
          targetArticle.trim().length === 0 ||
          startArticle.trim().normalize("NFC") === targetArticle.trim().normalize("NFC")
        }
        type="submit"
      >
        {isSubmitting ? "저장 중…" : "경기 설정 저장"}
      </button>
    </form>
  );
}
