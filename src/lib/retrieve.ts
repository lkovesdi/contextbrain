import { createClient } from "@/lib/supabase/server";
import { embed } from "./embed";
import { fetchIntegrationContext, type Provider } from "./composio";

export type ContextSelection = {
  meeting_id?: string;
  // When `meeting_id` is set we always pull that meeting's transcripts — it's
  // implicit context, not a user-facing toggle. `include_notes` remains an
  // ad-hoc runtime opt-in for cross-meeting notes search.
  include_notes?: boolean;
  external_context_ids?: string[];
  note_ids?: string[];
  space_id?: string | null;
  recent_summary_count?: number;
  integrations?: { provider: Provider }[];
};

export type RetrievedChunk = {
  content: string;
  source: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export async function retrieve(
  query: string,
  selection: ContextSelection,
  k = 8
): Promise<RetrievedChunk[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const qVec = await embed(query);
  // Two buckets: priority (explicit user picks — always included) and
  // ambient (embedding/integration hits — ranked, top-k after priority).
  const priority: RetrievedChunk[] = [];
  const ambient: RetrievedChunk[] = [];

  if (selection.meeting_id) {
    const { data } = await supabase.rpc("match_transcripts", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: user.id,
      meeting_id_filter: selection.meeting_id,
    });
    (data ?? []).forEach((r: { content: string; speaker: string | null; similarity: number }) =>
      ambient.push({
        content: r.content,
        source: `transcript (${r.speaker ?? "speaker"})`,
        score: r.similarity,
      })
    );
  }

  if (selection.include_notes) {
    const { data } = await supabase.rpc("match_notes", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: user.id,
    });
    (data ?? []).forEach((r: { content: string; similarity: number }) =>
      ambient.push({ content: r.content, source: "note", score: r.similarity })
    );
  }

  // Hand-pinned notes — explicit picks, always included.
  if (selection.note_ids?.length) {
    const { data } = await supabase
      .from("notes")
      .select("content")
      .in("id", selection.note_ids)
      .eq("user_id", user.id);
    (data ?? []).forEach((r: { content: string }) =>
      priority.push({ content: r.content, source: "pinned note", score: 1 })
    );
  }

  // Recent space summaries — recurring meeting continuity, always included.
  if (selection.space_id) {
    const matchCount = Math.min(
      Math.max(selection.recent_summary_count ?? 3, 1),
      20
    );
    const { data } = await supabase.rpc("recent_space_summaries", {
      space_id_filter: selection.space_id,
      user_id_filter: user.id,
      match_count: matchCount,
      exclude_meeting: selection.meeting_id ?? null,
    });
    (data ?? []).forEach(
      (r: {
        meeting_id: string;
        title: string;
        summary_title: string | null;
        summary: string;
        ended_at: string | null;
      }) => {
        const headline = r.summary_title?.trim() || r.title;
        const date = r.ended_at ? new Date(r.ended_at).toLocaleDateString() : "";
        priority.push({
          content: `# ${headline}${date ? ` (${date})` : ""}\n\n${r.summary}`,
          source: `prior meeting summary`,
          score: 1,
        });
      }
    );
  }

  if (selection.external_context_ids?.length) {
    const { data } = await supabase.rpc("match_external_chunks", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: user.id,
      context_ids: selection.external_context_ids,
    });
    (data ?? []).forEach((r: {
      content: string;
      metadata: Record<string, unknown> | null;
      similarity: number;
    }) =>
      ambient.push({
        content: r.content,
        source: `external (${r.metadata?.conversation_name ?? "claude export"})`,
        score: r.similarity,
        metadata: r.metadata ?? undefined,
      })
    );
  }

  if (selection.integrations?.length) {
    for (const { provider } of selection.integrations) {
      const res = await fetchIntegrationContext(user.id, provider, query);
      if (!res) continue;
      const summary = JSON.stringify(res).slice(0, 2000);
      ambient.push({
        content: summary,
        source: `integration:${provider}`,
        score: 0.5,
      });
    }
  }

  // Priority items always come through. Ambient hits fill the remaining slots,
  // ranked by similarity. Keep at least the top-k overall so chat has room
  // even when the priority bucket is small.
  const ambientSorted = ambient.sort((a, b) => b.score - a.score);
  const remaining = Math.max(k - priority.length, 0);
  return [...priority, ...ambientSorted.slice(0, remaining)];
}
