"use client";

import { useEffect, useState } from "react";

export function CountdownClock({ scheduledAt }: { scheduledAt: string }) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(scheduledAt).getTime() - Date.now()),
  );

  useEffect(() => {
    const update = () => {
      setRemainingMs(Math.max(0, new Date(scheduledAt).getTime() - Date.now()));
    };
    update();
    const interval = window.setInterval(update, 50);
    return () => window.clearInterval(interval);
  }, [scheduledAt]);

  return (
    <div className="countdown-clock" role="timer" aria-live="polite">
      <p className="eyebrow">STARTING IN</p>
      <strong>{remainingMs > 0 ? Math.ceil(remainingMs / 1000) : "출발!"}</strong>
    </div>
  );
}
