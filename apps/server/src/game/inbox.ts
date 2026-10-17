import type { InboxEntry, NoticeKind, NoticeMessage } from "@japalife/shared";
import { logError } from "../log";
import type { GameDeps } from "./deps";
import type { NoticeBus } from "./noticeBus";

/** Older messages are deleted: enough to cover a long absence, little personal data kept. */
export const MAX_INBOX_MESSAGES = 50;

export interface DeliverOptions {
  /** False when the HUD already shows it some other way (a request shows as the event card). */
  toast?: boolean;
}

/**
 * Every notice to a player goes through here: it is stored, so a player who was
 * offline finds it when they come back, and shown as a toast if they are
 * connected. A notice a connected player saw is stored already read, so the
 * unread count is only what they missed.
 */
export class InboxService {
  constructor(
    private readonly deps: GameDeps,
    private readonly notices: NoticeBus,
  ) {}

  /**
   * Never throws: the thing being announced (a payment, an event) has already
   * happened, and a failed inbox write must not make it look like it did not.
   */
  async deliver(playerId: string, notice: NoticeMessage, now: Date, options: DeliverOptions = {}): Promise<void> {
    const seen = this.notices.isListening(playerId);
    if (options.toast !== false) this.notices.publish(playerId, notice);
    try {
      const { db } = this.deps;
      await db.inboxMessage.create({
        data: { playerId, ...notice, createdAt: now, readAt: seen ? now : null },
      });
      const old = await db.inboxMessage.findMany({
        where: { playerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: MAX_INBOX_MESSAGES,
        select: { id: true },
      });
      if (old.length > 0) await db.inboxMessage.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
    } catch (error) {
      logError("inbox: storing a notice failed", error);
    }
  }

  unreadCount(playerId: string): Promise<number> {
    return this.deps.db.inboxMessage.count({ where: { playerId, readAt: null } });
  }

  /** The latest messages, newest first, and marks them all read. */
  async open(playerId: string, now: Date): Promise<InboxEntry[]> {
    const { db } = this.deps;
    const rows = await db.inboxMessage.findMany({
      where: { playerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_INBOX_MESSAGES,
    });
    await db.inboxMessage.updateMany({ where: { playerId, readAt: null }, data: { readAt: now } });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as NoticeKind,
      title: row.title,
      message: row.message,
      at: row.createdAt.toISOString(),
      unread: row.readAt === null,
    }));
  }
}
