"use client";

import { useState } from "react";

interface CopyButtonProps {
  value: string;
  label: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else {
        copyWithTemporaryInput(value);
      }
      setStatus("copied");
    } catch {
      try {
        copyWithTemporaryInput(value);
        setStatus("copied");
      } catch {
        setStatus("failed");
      }
    }
  }

  return (
    <button className="copy-button" type="button" onClick={handleCopy}>
      {status === "copied" ? "복사됨" : status === "failed" ? "다시 시도" : "복사"}
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? `${label}를 복사했습니다.` : ""}
      </span>
    </button>
  );
}

function copyWithTemporaryInput(value: string) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}
