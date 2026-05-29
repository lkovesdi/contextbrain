import type { createClient } from "@/lib/supabase/server";
import type { Tag } from "@/lib/tags";

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export type MeetingListItem = {
  id: string;
  title: string;
  summary_title: string | null;
  started_at: string | null;
  ended_at: string | null;
  space_id: string | null;
  tags: Tag[];
};

export const MEETINGS_PAGE_SIZE = 20;

// Cursor = opaque base64 of the boundary row's (started_at, id). started_at
// defaults to now() so it's effectively non-null; id breaks ties.
export function encodeCursor(it: { started_at: string | null; id: string }): string {
  return Buffer.from(JSON.stringify({ t: it.started_at, id: it.id })).toString(
    "base64url"
  );
}

function decodeCursor(c: string): { t: string | null; id: string } | null {
  try {
    const o = JSON.parse(Buffer.from(c, "base64url").toString());
    if (o && typeof o.id === "string") return { t: o.t ?? null, id: o.id };
  } catch {
    /* malformed cursor — treat as no cursor */
  }
  return null;
}

type Row = Omit<MeetingListItem, "tags">;

// One page of the meetings list. With `q` it's a single trigram-ranked search
// page (no cursor); otherwise it's a keyset page ordered (started_at, id) desc.
export async function loadMeetings(
  supabase: SupabaseLike,
  userId: string,
  opts: { q?: string | null; cursor?: string | null; limit?: number }
): Promise<{ items: MeetingListItem[]; nextCursor: string | null }> {
  const limit = opts.limit ?? MEETINGS_PAGE_SIZE;
  const q = opts.q?.trim();

  let rows: Row[] = [];
  let nextCursor: string | null = null;

  if (q) {
    const { data } = await supabase.rpc("search_meetings", {
      q,
      user_id_filter: userId,
      match_count: limit,
    });
    rows = (data ?? []) as Row[];
  } else {
    let query = supabase
      .from("meetings")
      .select("id,title,summary_title,started_at,ended_at,space_id")
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit);
    const c = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (c) {
      query =
        c.t === null
          ? query.is("started_at", null).lt("id", c.id)
          : query.or(`started_at.lt.${c.t},and(started_at.eq.${c.t},id.lt.${c.id})`);
    }
    const { data } = await query;
    rows = (data ?? []) as Row[];
    if (rows.length === limit) nextCursor = encodeCursor(rows[rows.length - 1]);
  }

  const items = await attachTags(supabase, rows);
  return { items, nextCursor };
}

async function attachTags(
  supabase: SupabaseLike,
  rows: Row[]
): Promise<MeetingListItem[]> {
  const ids = rows.map((r) => r.id);
  const byMeeting = new Map<string, Tag[]>();
  if (ids.length) {
    const { data } = await supabase
      .from("meeting_tags")
      .select("meeting_id, tag:tags(id,label_key,value)")
      .in("meeting_id", ids)
      .order("created_at", { ascending: true });
    for (const row of (data ?? []) as unknown as {
      meeting_id: string;
      tag: Tag | null;
    }[]) {
      if (!row.tag) continue;
      const arr = byMeeting.get(row.meeting_id) ?? [];
      arr.push(row.tag);
      byMeeting.set(row.meeting_id, arr);
    }
  }
  return rows.map((r) => ({ ...r, tags: byMeeting.get(r.id) ?? [] }));
}
