import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Providers whose integrations a chat's context selection may reference. Mirrors
// the Provider union in @/lib/composio (kept literal here so it's a zod enum).
export const CHAT_PROVIDERS = [
  "github",
  "jira",
  "figma",
  "linear",
  "linkedin",
  "zoom",
  "slack",
  "gmail",
] as const;

// The non-meeting half of a chat's context (attached meetings live in the
// chat_meetings join table, not here). Shape mirrors ContextSelection minus the
// meeting fields — see @/lib/retrieve.
export const ChatSelectionSchema = z
  .object({
    external_context_ids: z.array(z.string().uuid()).optional(),
    note_ids: z.array(z.string().uuid()).optional(),
    space_id: z.string().uuid().nullable().optional(),
    tag_ids: z.array(z.string().uuid()).optional(),
    recent_summary_count: z.number().int().min(1).max(20).optional(),
    integrations: z
      .array(z.object({ provider: z.enum(CHAT_PROVIDERS) }))
      .optional(),
  })
  .default({});

export type ChatSelection = z.infer<typeof ChatSelectionSchema>;

// Replace a chat's attached meetings with exactly `ids` — filtered to those the
// caller owns, so a client can't attach someone else's meeting. Returns the ids
// actually attached. RLS on chat_meetings additionally gates every write.
export async function setChatMeetings(
  supabase: SupabaseServer,
  userId: string,
  chatId: string,
  ids: string[]
): Promise<string[]> {
  await supabase.from("chat_meetings").delete().eq("chat_id", chatId);
  if (!ids.length) return [];

  const { data: owned } = await supabase
    .from("meetings")
    .select("id")
    .in("id", ids)
    .eq("user_id", userId);
  const ownedIds = (owned ?? []).map((m: { id: string }) => m.id);
  if (!ownedIds.length) return [];

  const { error } = await supabase.from("chat_meetings").insert(
    ownedIds.map((meeting_id) => ({ chat_id: chatId, meeting_id, user_id: userId }))
  );
  if (error) {
    console.error("[chats] setChatMeetings failed:", error.message);
    return [];
  }
  return ownedIds;
}

export async function getChatMeetingIds(
  supabase: SupabaseServer,
  chatId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("chat_meetings")
    .select("meeting_id")
    .eq("chat_id", chatId);
  return (data ?? []).map((r: { meeting_id: string }) => r.meeting_id);
}
