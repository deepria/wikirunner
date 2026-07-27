"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { createRoom } from "../../../lib/game-api";

export default function NewRoomPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);

    try {
      const result = await createRoom({ nickname, maxPlayers });
      router.push(`/rooms/${result.room.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "방을 만들지 못했습니다. 다시 시도해 주세요.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="form-page">
      <a className="brand" href="/">
        WikiRunner
      </a>
      <form className="form-card" onSubmit={handleSubmit}>
        <p className="eyebrow">CREATE A ROOM</p>
        <h1>새 방 만들기</h1>
        <p>닉네임과 정원을 정하면 바로 대기실이 만들어집니다.</p>

        <label>
          닉네임
          <input
            required
            autoComplete="nickname"
            maxLength={20}
            placeholder="예: 링크러너"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
          />
        </label>

        <label>
          최대 인원
          <select
            value={maxPlayers}
            onChange={(event) => setMaxPlayers(Number(event.target.value))}
          >
            {[2, 3, 4, 5, 6, 8, 10, 12].map((count) => (
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

        <button disabled={isSubmitting || nickname.trim().length === 0} type="submit">
          {isSubmitting ? "방을 만드는 중…" : "대기실 만들기"}
        </button>
      </form>
    </main>
  );
}
