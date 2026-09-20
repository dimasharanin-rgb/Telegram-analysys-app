/**
 * Conversations and participants.
 *
 * Only metadata and the aggregate statistics digest are stored. The message
 * history stays in the browser; the excerpts a job will send live separately,
 * on the job, and are pruned once it finishes.
 */

import { getDb } from "@/server/db/client";
import { newId, nowIso } from "@/server/ids";

export interface ParticipantRecord {
  id: string;
  conversationId: string;
  pseudonym: string;
  displayName: string;
  isSelf: boolean;
  messageCount: number;
}

export interface ConversationRecord {
  id: string;
  ownerId: string;
  title: string;
  source: string;
  chatType: string;
  messageCount: number;
  startDate: string;
  endDate: string;
  spanDays: number;
  timezoneOffsetMinutes: number | null;
  /** Aggregate digest as stored, parsed by the caller. */
  statistics: unknown;
  createdAt: string;
}

export interface CreateConversationInput {
  ownerId: string;
  title: string;
  source: string;
  chatType: string;
  messageCount: number;
  startDate: string;
  endDate: string;
  spanDays: number;
  timezoneOffsetMinutes: number | null;
  statistics: unknown;
  participants: {
    pseudonym: string;
    displayName: string;
    isSelf: boolean;
    messageCount: number;
  }[];
}

interface ConversationRow {
  id: string;
  owner_id: string;
  title: string;
  source: string;
  chat_type: string;
  message_count: number;
  start_date: string;
  end_date: string;
  span_days: number;
  timezone_offset_minutes: number | null;
  statistics: string;
  created_at: string;
}

interface ParticipantRow {
  id: string;
  conversation_id: string;
  pseudonym: string;
  display_name: string;
  is_self: number;
  message_count: number;
}

function toConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    source: row.source,
    chatType: row.chat_type,
    messageCount: row.message_count,
    startDate: row.start_date,
    endDate: row.end_date,
    spanDays: row.span_days,
    timezoneOffsetMinutes: row.timezone_offset_minutes,
    statistics: JSON.parse(row.statistics) as unknown,
    createdAt: row.created_at,
  };
}

function toParticipant(row: ParticipantRow): ParticipantRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    pseudonym: row.pseudonym,
    displayName: row.display_name,
    isSelf: row.is_self === 1,
    messageCount: row.message_count,
  };
}

export function createConversation(input: CreateConversationInput): ConversationRecord {
  const db = getDb();
  const id = newId("conv");
  const at = nowIso();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO conversations
         (id, owner_id, title, source, chat_type, message_count, start_date,
          end_date, span_days, timezone_offset_minutes, statistics, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.title,
      input.source,
      input.chatType,
      input.messageCount,
      input.startDate,
      input.endDate,
      input.spanDays,
      input.timezoneOffsetMinutes,
      JSON.stringify(input.statistics),
      at,
    );

    const insertParticipant = db.prepare(
      `INSERT INTO participants
         (id, conversation_id, pseudonym, display_name, is_self, message_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const participant of input.participants) {
      insertParticipant.run(
        newId("prt"),
        id,
        participant.pseudonym,
        participant.displayName,
        participant.isSelf ? 1 : 0,
        participant.messageCount,
        at,
      );
    }
  })();

  return getConversationById(id)!;
}

function getConversationById(id: string): ConversationRecord | null {
  const row = getDb()
    .prepare<[string], ConversationRow>("SELECT * FROM conversations WHERE id = ?")
    .get(id);
  return row ? toConversation(row) : null;
}

/**
 * Ownership is part of the lookup, not a check afterwards - an id belonging to
 * someone else simply does not resolve.
 */
export function getConversation(id: string, ownerId: string): ConversationRecord | null {
  const row = getDb()
    .prepare<[string, string], ConversationRow>(
      "SELECT * FROM conversations WHERE id = ? AND owner_id = ?",
    )
    .get(id, ownerId);
  return row ? toConversation(row) : null;
}

/** Used by the consent page, which has a token rather than an owner cookie. */
export function getConversationUnscoped(id: string): ConversationRecord | null {
  return getConversationById(id);
}

export function listConversations(ownerId: string, limit = 50): ConversationRecord[] {
  return getDb()
    .prepare<[string, number], ConversationRow>(
      "SELECT * FROM conversations WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(ownerId, limit)
    .map(toConversation);
}

export function listParticipants(conversationId: string): ParticipantRecord[] {
  return getDb()
    .prepare<[string], ParticipantRow>(
      "SELECT * FROM participants WHERE conversation_id = ? ORDER BY message_count DESC",
    )
    .all(conversationId)
    .map(toParticipant);
}

export function getParticipant(id: string): ParticipantRecord | null {
  const row = getDb()
    .prepare<[string], ParticipantRow>("SELECT * FROM participants WHERE id = ?")
    .get(id);
  return row ? toParticipant(row) : null;
}

export function deleteConversation(id: string, ownerId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM conversations WHERE id = ? AND owner_id = ?")
    .run(id, ownerId);
  return result.changes > 0;
}
