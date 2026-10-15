import type { RejectReason } from "@japalife/shared";

/** What a game action returns: it worked (with details) or was refused for a stable reason. */
export type Outcome<T extends object = object> = ({ ok: true } & T) | Rejected;
export interface Rejected {
  ok: false;
  reason: RejectReason;
}

export const reject = (reason: RejectReason): Rejected => ({ ok: false, reason });
