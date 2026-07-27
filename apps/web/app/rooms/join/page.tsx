"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { joinRoom } from "../../../lib/game-api";

export default function JoinRoomPage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);

    try {
      const result = await joinRoom({ inviteCode, nickname });
      router.push(`/rooms/${result.room.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "방에 입장하지 못했습니다. 다시 시도해 주세요.",
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
        <p className="eyebrow">JOIN A ROOM</p>
        <h1>방 코드로 입장</h1>
        <p>방장이 공유한 6자리 코드와 게임에서 사용할 닉네임을 입력하세요.</p>

        <label>
          방 코드
          <input
            required
            autoCapitalize="characters"
            autoComplete="off"
            className="code-input"
            maxLength={6}
            minLength={6}
            pattern="[A-Z0-9]{6}"
            placeholder="ABC123"
            value={inviteCode}
            onChange={(event) =>
              setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
            }
          />
        </label>

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

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          disabled={isSubmitting || inviteCode.length !== 6 || nickname.trim().length === 0}
          type="submit"
        >
          {isSubmitting ? "입장하는 중…" : "대기실 입장"}
        </button>
      </form>
    </main>
  );
}
