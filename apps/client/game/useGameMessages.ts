"use client";

import type { InteractionMessage, StatsMessage } from "@japalife/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerInbox } from "./connection";
import { rejectionText } from "./format";

export interface Toast {
  id: number;
  tone: "event" | "good" | "refused";
  title: string;
  message: string;
}

/** Events stay up long enough to read a sentence; refusals are short. */
const TOAST_MS = { event: 8000, good: 5000, refused: 3500 } as const;
const MAX_TOASTS = 3;

/**
 * The server's latest stats, plus a clock that follows the SERVER's time.
 * `serverNow()` is the server time from the last stats message, moved forward by
 * how long ago (on the monotonic `performance.now()`) that message arrived. The
 * device's wall clock is never used, so a phone set to the wrong date cannot
 * shift a countdown.
 */
export interface ServerStats {
  stats: StatsMessage;
  serverNow: () => number;
}

export function useGameMessages(inbox: ServerInbox) {
  const [server, setServer] = useState<ServerStats | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [interaction, setInteraction] = useState<InteractionMessage | null>(null);
  const nextToastId = useRef(1);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextToastId.current++;
    setToasts((current) => [...current, { ...toast, id }].slice(-MAX_TOASTS));
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_MS[toast.tone]);
  }, []);

  useEffect(
    () =>
      inbox.listen((event) => {
        switch (event.type) {
          case "stats": {
            const serverTime = Date.parse(event.stats.serverTime);
            const { receivedAt } = event;
            setServer({ stats: event.stats, serverNow: () => serverTime + (performance.now() - receivedAt) });
            return;
          }
          case "notice":
            pushToast({
              tone: event.notice.kind === "shift_paid" ? "good" : "event",
              title: event.notice.title,
              message: event.notice.message,
            });
            return;
          case "rejected":
            pushToast({ tone: "refused", title: "", message: rejectionText(event.rejected.reason) });
            return;
          case "interaction":
            setInteraction(event.interaction);
            return;
        }
      }),
    [inbox, pushToast],
  );

  return { server, toasts, interaction, closeInteraction: useCallback(() => setInteraction(null), []) };
}
