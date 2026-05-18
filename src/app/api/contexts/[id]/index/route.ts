import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { embedBatch } from "@/lib/embed";
import { chunkText } from "@/lib/chunk";
import type { WalkedFile } from "@/lib/github";
import { collectorFor, repoLabelFor } from "@/lib/contexts/collectors";

// 5 minutes — even with parallel walkers, an extreme repo (1000s of files)
// can take a while. The frontend polls /status independently so the user
// always sees forward progress.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH = 32;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: ctx, error: loadErr } = await supabase
    .from("external_contexts")
    .select("id,user_id,source_type,metadata,status")
    .eq("id", id)
    .single();
  if (loadErr || !ctx) {
    return NextResponse.json({ error: "Context not found" }, { status: 404 });
  }
  if (ctx.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (ctx.status === "indexing" || ctx.status === "ready") {
    return NextResponse.json({ ok: true, already: ctx.status });
  }

  const collect = collectorFor(ctx.source_type);
  if (!collect) {
    return NextResponse.json(
      { error: `No indexer registered for source_type=${ctx.source_type}` },
      { status: 400 }
    );
  }

  const md = (ctx.metadata ?? {}) as Record<string, unknown>;

  await supabase
    .from("external_contexts")
    .update({
      status: "indexing",
      chunks_done: 0,
      chunks_total: 0,
      error_message: null,
    })
    .eq("id", id);

  // Cancel = the user clicked the chip's stop button, which deletes the row.
  // We poll the row's existence between batches; if it's gone, we bail.
  const isCancelled = async (): Promise<boolean> => {
    const { data } = await supabase
      .from("external_contexts")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    return !data;
  };

  const setProgress = async (planned?: number, done?: number) => {
    const patch: Record<string, number> = {};
    if (planned !== undefined) patch.chunks_total = planned;
    if (done !== undefined) patch.chunks_done = done;
    if (Object.keys(patch).length === 0) return;
    await supabase.from("external_contexts").update(patch).eq("id", id);
  };

  try {
    // 1) Collect content via the per-integration adapter.
    const files: WalkedFile[] = await collect(user.id, md, {
      onPlanned: (n) => setProgress(n, 0),
      onProgress: (n) => setProgress(undefined, n),
      isCancelled,
    });

    if (await isCancelled()) {
      console.log(`[indexer] context ${id} cancelled — stopping.`);
      return NextResponse.json({ ok: true, cancelled: true });
    }

    // 2) Chunk + count up-front. The progress ring resets here from
    //    "items fetched" to "chunks embedded" — two clear phases.
    const allChunks: {
      content: string;
      path: string;
      perFileMeta?: Record<string, unknown>;
    }[] = [];
    for (const f of files) {
      const labelled = `// ${f.path}\n${f.content}`;
      for (const piece of chunkText(labelled, 1500, 150)) {
        allChunks.push({ content: piece, path: f.path, perFileMeta: f.metadata });
      }
    }

    await setProgress(allChunks.length, 0);

    if (allChunks.length === 0) {
      await supabase
        .from("external_contexts")
        .update({ status: "ready" })
        .eq("id", id);
      return NextResponse.json({ ok: true, chunks: 0 });
    }

    const repoLabel = repoLabelFor(ctx.source_type, md);

    // 3) Embed + insert in batches; bump chunks_done after each batch.
    let done = 0;
    for (let i = 0; i < allChunks.length; i += BATCH) {
      if (await isCancelled()) {
        console.log(`[indexer] context ${id} cancelled mid-embed — bailing.`);
        return NextResponse.json({ ok: true, cancelled: true });
      }

      const batch = allChunks.slice(i, i + BATCH);
      try {
        const vectors = await embedBatch(batch.map((c) => c.content));
        await supabase.from("external_chunks").insert(
          batch.map((c, idx) => ({
            external_context_id: id,
            user_id: user.id,
            content: c.content,
            embedding: vectors[idx],
            metadata: {
              path: c.path,
              repo: repoLabel,
              source_type: ctx.source_type,
              // Carry the chip's source-specific identifiers onto every
              // chunk so retrieval can compose deep-links / render URLs
              // (e.g. figma file_key + node_id → screenshot endpoint).
              ...md,
              // Per-file overrides — for figma_file chips this gives each
              // chunk its own frame's node_id rather than the chip's empty
              // node_id.
              ...(c.perFileMeta ?? {}),
            },
          }))
        );
      } catch (e) {
        console.error("embed batch failed, inserting without vectors:", e);
        await supabase.from("external_chunks").insert(
          batch.map((c) => ({
            external_context_id: id,
            user_id: user.id,
            content: c.content,
            metadata: {
              path: c.path,
              repo: repoLabel,
              source_type: ctx.source_type,
              // Carry the chip's source-specific identifiers onto every
              // chunk so retrieval can compose deep-links / render URLs
              // (e.g. figma file_key + node_id → screenshot endpoint).
              ...md,
              // Per-file overrides — for figma_file chips this gives each
              // chunk its own frame's node_id rather than the chip's empty
              // node_id.
              ...(c.perFileMeta ?? {}),
            },
          }))
        );
      }
      done += batch.length;
      await setProgress(undefined, done);
    }

    await supabase
      .from("external_contexts")
      .update({ status: "ready" })
      .eq("id", id);

    return NextResponse.json({ ok: true, chunks: allChunks.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Indexing failed";
    console.error("index worker failed:", e);
    await supabase
      .from("external_contexts")
      .update({ status: "error", error_message: msg })
      .eq("id", id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
