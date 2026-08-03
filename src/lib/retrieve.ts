import { createClient } from "@/lib/supabase/server";
import { embed } from "./embed";
import { fetchIntegrationContext, type Provider } from "./composio";

export type ContextSelection = {
  meeting_id?: string;
  // When `meeting_id` is set we always pull that meeting's transcripts — it's
  // implicit context, not a user-facing toggle. `include_notes` remains an
  // ad-hoc runtime opt-in for cross-meeting notes search.
  include_notes?: boolean;
  // Multi-meeting agent chat: vector-search transcripts across several selected
  // meetings and fold each one's summary into the priority bucket. Independent
  // of the singular `meeting_id` (per-meeting chat) above.
  meeting_ids?: string[];
  external_context_ids?: string[];
  note_ids?: string[];
  space_id?: string | null;
  // Space chat: search *everything in the space* — vector search across all
  // its meetings' transcripts and its notes (on top of the recent summaries
  // that `space_id` alone already pulls). Requires `space_id`.
  space_wide?: boolean;
  // Co-tagged continuity: prior summaries from meetings sharing any of these
  // tags get pulled forward, the same way `space_id` pulls a folder's history.
  tag_ids?: string[];
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
  k = 8,
  // Whose context to search. Defaults to the authenticated caller. A guest
  // chatting in a host's meeting passes the host's id here so retrieval runs
  // against the host's attached context — the caller must already be verified
  // as a participant, and the selection must be server-derived (never trust a
  // guest's client selection, or this becomes a data-exfiltration hole).
  contextUserId?: string
): Promise<RetrievedChunk[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const effectiveUserId = contextUserId ?? user.id;

  const qVec = await embed(query);
  // Two buckets: priority (explicit user picks — always included) and
  // ambient (embedding/integration hits — ranked, top-k after priority).
  const priority: RetrievedChunk[] = [];
  const ambient: RetrievedChunk[] = [];

  if (selection.meeting_id) {
    const { data } = await supabase.rpc("match_transcripts", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: effectiveUserId,
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

  // Space-wide search: every transcript line across the space's meetings plus
  // the space's notes compete for ambient slots on similarity.
  if (selection.space_id && selection.space_wide) {
    const [{ data: spaceLines }, { data: spaceNotes }] = await Promise.all([
      supabase.rpc("match_space_transcripts", {
        query_embedding: qVec,
        match_count: k,
        user_id_filter: effectiveUserId,
        space_id_filter: selection.space_id,
      }),
      supabase.rpc("match_space_notes", {
        query_embedding: qVec,
        match_count: k,
        user_id_filter: effectiveUserId,
        space_id_filter: selection.space_id,
      }),
    ]);
    (spaceLines ?? []).forEach(
      (r: {
        content: string;
        speaker: string | null;
        meeting_title: string;
        similarity: number;
      }) =>
        ambient.push({
          content: r.content,
          source: `“${r.meeting_title}” transcript (${r.speaker ?? "speaker"})`,
          score: r.similarity,
        })
    );
    (spaceNotes ?? []).forEach((r: { content: string; similarity: number }) =>
      ambient.push({ content: r.content, source: "space note", score: r.similarity })
    );
  }

  if (selection.include_notes) {
    const { data } = await supabase.rpc("match_notes", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: effectiveUserId,
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
      .eq("user_id", effectiveUserId);
    (data ?? []).forEach((r: { content: string }) =>
      priority.push({ content: r.content, source: "pinned note", score: 1 })
    );
  }

  // Prior summaries pulled forward for continuity (space folder + shared tags).
  // Tracked across both pulls so a meeting that's both in the space and
  // co-tagged isn't pushed twice.
  const seenSummaryMeetings = new Set<string>();
  const recentCount = Math.min(
    Math.max(selection.recent_summary_count ?? 3, 1),
    20
  );

  // Recent space summaries — recurring meeting continuity, always included.
  if (selection.space_id) {
    const { data } = await supabase.rpc("recent_space_summaries", {
      space_id_filter: selection.space_id,
      user_id_filter: effectiveUserId,
      match_count: recentCount,
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
        seenSummaryMeetings.add(r.meeting_id);
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

  // Recent summaries from co-tagged meetings — topic continuity across spaces.
  if (selection.tag_ids?.length) {
    const { data } = await supabase.rpc("recent_tagged_summaries", {
      tag_ids: selection.tag_ids,
      user_id_filter: effectiveUserId,
      match_count: recentCount,
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
        if (seenSummaryMeetings.has(r.meeting_id)) return;
        seenSummaryMeetings.add(r.meeting_id);
        const headline = r.summary_title?.trim() || r.title;
        const date = r.ended_at ? new Date(r.ended_at).toLocaleDateString() : "";
        priority.push({
          content: `# ${headline}${date ? ` (${date})` : ""}\n\n${r.summary}`,
          source: `tagged meeting summary`,
          score: 1,
        });
      }
    );
  }

  // Multi-meeting agent chat: fold each attached meeting's summary into priority
  // (deduped against the space/tag summaries above), then vector-search each
  // meeting's transcripts with a fair per-meeting share of k so one long meeting
  // can't starve the others.
  if (selection.meeting_ids?.length) {
    const ids = selection.meeting_ids;
    const { data: metas } = await supabase
      .from("meetings")
      .select("id, title, summary_title, summary, ended_at")
      .in("id", ids)
      .eq("user_id", effectiveUserId);
    const headlineById = new Map<string, string>();
    (metas ?? []).forEach(
      (m: {
        id: string;
        title: string;
        summary_title: string | null;
        summary: string | null;
        ended_at: string | null;
      }) => {
        const headline = m.summary_title?.trim() || m.title || "meeting";
        headlineById.set(m.id, headline);
        if (m.summary && !seenSummaryMeetings.has(m.id)) {
          seenSummaryMeetings.add(m.id);
          const date = m.ended_at
            ? new Date(m.ended_at).toLocaleDateString()
            : "";
          priority.push({
            content: `# ${headline}${date ? ` (${date})` : ""}\n\n${m.summary}`,
            source: `meeting summary`,
            score: 1,
          });
        }
      }
    );

    const perMeeting = Math.max(1, Math.ceil(k / ids.length));
    const perMeetingResults = await Promise.all(
      ids.map((mid) =>
        supabase.rpc("match_transcripts", {
          query_embedding: qVec,
          match_count: perMeeting,
          user_id_filter: effectiveUserId,
          meeting_id_filter: mid,
        })
      )
    );
    perMeetingResults.forEach(({ data }, i) => {
      const label = headlineById.get(ids[i]) ?? "meeting";
      (data ?? []).forEach(
        (r: { content: string; speaker: string | null; similarity: number }) =>
          ambient.push({
            content: r.content,
            source: `“${label}” transcript (${r.speaker ?? "speaker"})`,
            score: r.similarity,
          })
      );
    });
  }

  if (selection.external_context_ids?.length) {
    const ids = selection.external_context_ids;
    // Per-source top-1 → priority. Without this, a small chip (e.g. a 1-chunk
    // Figma stub) loses every slot to a large chip (e.g. a 268-chunk repo) on
    // similarity competition. Explicit user picks should always contribute.
    // Remaining slots come from the cross-source top-k so the richer source
    // can still dominate when it genuinely is more relevant.
    const perSource = await Promise.all(
      ids.map((id) =>
        supabase.rpc("match_external_chunks", {
          query_embedding: qVec,
          match_count: 1,
          user_id_filter: effectiveUserId,
          context_ids: [id],
        })
      )
    );
    const seen = new Set<string>();
    for (const { data } of perSource) {
      const row = (data ?? [])[0] as ExternalChunkRow | undefined;
      if (!row) continue;
      seen.add(row.id);
      priority.push({
        content: row.content,
        source: externalLabel(row.metadata),
        score: row.similarity,
        metadata: row.metadata ?? undefined,
      });
    }
    const { data } = await supabase.rpc("match_external_chunks", {
      query_embedding: qVec,
      match_count: k,
      user_id_filter: effectiveUserId,
      context_ids: ids,
    });
    (data ?? []).forEach((r: ExternalChunkRow) => {
      if (seen.has(r.id)) return;
      ambient.push({
        content: r.content,
        source: externalLabel(r.metadata),
        score: r.similarity,
        metadata: r.metadata ?? undefined,
      });
    });
  }

  if (selection.integrations?.length) {
    for (const { provider } of selection.integrations) {
      const res = await fetchIntegrationContext(effectiveUserId, provider, query);
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

type ExternalChunkRow = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

// Build a human-readable label from chunk metadata. The indexer stamps
// `repo` (e.g. "lkovesdi/contextbrain", "figma:Untitled", "jira:CB") and
// `path` onto every chunk — fall back to source_type only if those got lost.
function externalLabel(
  metadata: Record<string, unknown> | null | undefined
): string {
  const meta = metadata ?? {};
  const repo = typeof meta.repo === "string" ? meta.repo : null;
  const path = typeof meta.path === "string" ? meta.path : null;
  const sourceType =
    typeof meta.source_type === "string" ? meta.source_type : null;
  if (repo && path) return `${repo} / ${path}`;
  if (repo) return repo;
  if (sourceType) return sourceType;
  return "external";
}
