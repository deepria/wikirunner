const roomId = /^\/rooms\/([0-9a-f-]{36})\/?$/i.exec(window.location.pathname)?.[1];

if (roomId) {
  void chrome.runtime.sendMessage({ type: "WEB_ROOM_OPENED", roomId });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin || event.data === null || typeof event.data !== "object") return;
  const message = event.data as { type?: unknown; nonce?: unknown; roomId?: unknown };
  if (message.type === "WIKIRUNNER_ROOM_LEFT" && typeof message.roomId === "string") {
    void chrome.runtime.sendMessage({ type: "WEB_ROOM_LEFT", roomId: message.roomId });
    return;
  }
  if (message.type !== "WIKIRUNNER_AUTO_PAIR_REQUEST" || typeof message.nonce !== "string") return;
  void chrome.runtime.sendMessage({ type: "REDEEM_AUTO_PAIRING_NONCE", nonce: message.nonce }).then((response: unknown) => {
    window.postMessage({ type: "WIKIRUNNER_AUTO_PAIR_RESULT", ok: response !== null && typeof response === "object" && (response as { ok?: unknown }).ok === true, message: response !== null && typeof response === "object" ? (response as { message?: unknown }).message : undefined }, window.location.origin);
  });
});
