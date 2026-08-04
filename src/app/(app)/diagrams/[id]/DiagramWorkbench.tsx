"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, GitBranch, Pencil, RefreshCw, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  ArchitectureDiagram,
  CANVAS_BG,
  STATUS_COLOR,
  TONE_COLOR,
  type DiagramHighlight,
} from "@/components/diagram/ArchitectureDiagram";

// Sanctioned diagram-palette literal: the async/deploy legend swatch matches
// the muted dashed strokes drawn inside the always-dark canvas.
const LEGEND_MUTED = "#9CA0AD";
import {
  diffGraphs,
  type DiagramRow,
  type DiagramVersionRow,
} from "@/lib/diagrams";

function versionLabel(v: DiagramVersionRow): string {
  return `v${v.version} — ${new Date(v.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

// All view state is *derived* from diagram.current_version (which bumps when
// router.refresh() delivers a freshly generated version) plus a few "user
// intent" records keyed to the version they were made at. When the version
// bumps, stale intents stop matching and the view naturally jumps to the new
// version — no prop→state syncing effects.
export function DiagramWorkbench({
  diagram,
  versions,
}: {
  diagram: DiagramRow;
  versions: DiagramVersionRow[];
}) {
  const router = useRouter();
  const cur = diagram.current_version;

  // Version the user explicitly picked, valid only while current_version
  // stays what it was at pick time.
  const [picked, setPicked] = useState<{ base: number; version: number } | null>(null);
  // Version at the moment Update was clicked; drives the spinner (until the
  // bump arrives) and then the automatic old-vs-new compare view.
  const [updateBase, setUpdateBase] = useState<number | null>(null);
  // Manual compare toggle, scoped to (version, selection) it was made at.
  const [compareOverride, setCompareOverride] = useState<{
    base: number;
    version: number;
    on: boolean;
  } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(diagram.title);

  const autoGenRan = useRef(false);

  const selectedVersion = picked && picked.base === cur ? picked.version : cur;
  const sel = versions.find((v) => v.version === selectedVersion) ?? versions.at(-1) ?? null;
  const prev = sel ? versions.find((v) => v.version === sel.version - 1) ?? null : null;

  const generating =
    !genError && ((cur === 0 && versions.length === 0) || (updateBase !== null && updateBase === cur));

  const autoCompare =
    updateBase !== null && cur === updateBase + 1 && cur > 1 && selectedVersion === cur;
  const compare =
    !!prev &&
    (compareOverride && compareOverride.base === cur && compareOverride.version === selectedVersion
      ? compareOverride.on
      : autoCompare);

  const diff = compare && sel && prev ? diffGraphs(prev.graph, sel.graph) : null;
  const newHighlight: DiagramHighlight | undefined = diff
    ? {
        nodes: Object.fromEntries([
          ...[...diff.addedNodes].map((id) => [id, "added"] as const),
          ...[...diff.modifiedNodes].map((id) => [id, "modified"] as const),
        ]),
        edges: Object.fromEntries([...diff.addedEdges].map((k) => [k, "added"] as const)),
      }
    : undefined;
  const oldHighlight: DiagramHighlight | undefined = diff
    ? {
        nodes: Object.fromEntries([
          ...[...diff.removedNodes].map((id) => [id, "removed"] as const),
          ...[...diff.modifiedNodes].map((id) => [id, "modified"] as const),
        ]),
        edges: Object.fromEntries([...diff.removedEdges].map((k) => [k, "removed"] as const)),
      }
    : undefined;

  // No setState before the first await — the auto-generate effect calls this
  // synchronously and the lint rules (rightly) dislike sync setState there.
  async function runGenerate() {
    try {
      const res = await fetch(`/api/diagrams/${diagram.id}/generate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Generation failed");
      router.refresh();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
      setUpdateBase(null);
    }
  }

  function startUpdate() {
    setGenError(null);
    setCompareOverride(null);
    setPicked(null);
    if (cur > 0) setUpdateBase(cur);
    void runGenerate();
  }

  // First visit on a never-generated diagram kicks off v1 automatically.
  useEffect(() => {
    if (diagram.current_version === 0 && versions.length === 0 && !autoGenRan.current) {
      autoGenRan.current = true;
      void runGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === diagram.title) {
      setTitleDraft(diagram.title);
      return;
    }
    await fetch(`/api/diagrams/${diagram.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    router.refresh();
  }

  const versionOptions = versions
    .slice()
    .reverse()
    .map((v) => ({ value: String(v.version), label: versionLabel(v) }));

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-[14px]">
        <div className="flex min-w-0 flex-col gap-[8px]">
          {editingTitle ? (
            <div className="flex items-center gap-[8px]">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTitle();
                  if (e.key === "Escape") {
                    setTitleDraft(diagram.title);
                    setEditingTitle(false);
                  }
                }}
                className="w-[420px] max-w-full rounded-[8px] border border-mist bg-bone-2 px-[10px] py-[6px] font-display text-[26px] tracking-[-0.01em] text-ink outline-none focus:border-cortex"
              />
              <button
                type="button"
                aria-label="Save title"
                onClick={() => void saveTitle()}
                className="cursor-pointer rounded-[6px] p-[6px] text-echo hover:bg-paper-2"
              >
                <Check size={15} strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="Cancel rename"
                onClick={() => {
                  setTitleDraft(diagram.title);
                  setEditingTitle(false);
                }}
                className="cursor-pointer rounded-[6px] p-[6px] text-slate hover:bg-paper-2"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-[8px]">
              <h1 className="font-display text-[32px] leading-tight tracking-[-0.015em] text-ink">
                {diagram.title}
              </h1>
              <button
                type="button"
                aria-label="Rename diagram"
                onClick={() => setEditingTitle(true)}
                className="cursor-pointer rounded-[6px] p-[6px] text-slate-2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 hover:bg-paper-2 hover:text-ink"
              >
                <Pencil size={13} strokeWidth={1.7} />
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-[6px]">
            {diagram.repos.map((r) => (
              <span
                key={`${r.owner}/${r.name}`}
                className="inline-flex items-center gap-[5px] rounded-[6px] bg-paper-2 px-[8px] py-[3px] font-mono text-[10.5px] text-ink-2"
              >
                <GitBranch size={10} strokeWidth={1.8} className="text-slate" />
                {r.owner}/{r.name}
                <span className="text-slate-2">@{r.branch}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-[8px]">
          {versions.length > 0 && (
            <Select
              aria-label="Diagram version"
              size="sm"
              value={String(selectedVersion)}
              onChange={(v) => {
                setPicked({ base: cur, version: Number(v) });
                setCompareOverride(null);
              }}
              options={versionOptions}
            />
          )}
          {sel && sel.version > 1 && (
            <Button
              variant={compare ? "ink" : "secondary"}
              size="sm"
              onClick={() =>
                setCompareOverride({ base: cur, version: selectedVersion, on: !compare })
              }
            >
              {compare ? "Exit compare" : "Compare"}
            </Button>
          )}
          {versions.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              disabled={generating}
              onClick={startUpdate}
              leftIcon={
                <RefreshCw size={13} strokeWidth={2} className={generating ? "animate-spin" : ""} />
              }
            >
              {generating ? "Updating…" : "Update"}
            </Button>
          )}
        </div>
      </header>

      {genError && (
        <div className="rounded-[10px] border border-pulse/30 bg-pulse-tint px-[14px] py-[10px] text-[12.5px] text-pulse-ink">
          {genError}
          {genError.includes("GitHub not connected") && (
            <>
              {" — "}
              <Link href="/integrations" className="underline cursor-pointer">
                connect GitHub
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={startUpdate}
            className="cursor-pointer ml-[10px] font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Canvas */}
      {versions.length === 0 ? (
        <div
          className="flex h-[560px] flex-col items-center justify-center gap-[14px] rounded-[14px] border border-mist"
          style={{ background: CANVAS_BG }}
        >
          <Workflow size={26} strokeWidth={1.4} style={{ color: TONE_COLOR.cortex }} />
          {generating ? (
            <>
              <p className="text-[13.5px] text-float-ink-2">
                Reading {diagram.repos.length === 1 ? "repo" : `${diagram.repos.length} repos`} and
                drawing the architecture…
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-2 animate-pulse">
                usually 30–60 seconds
              </p>
            </>
          ) : (
            !genError && (
              <p className="text-[13.5px] text-float-ink-2">
                This diagram hasn&apos;t been generated yet.
              </p>
            )
          )}
        </div>
      ) : compare && sel && prev ? (
        <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
          <div className="flex flex-col gap-[8px]">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-slate-2">
              {versionLabel(prev)} (before)
            </span>
            <ArchitectureDiagram graph={prev.graph} highlight={oldHighlight} height={480} />
          </div>
          <div className="flex flex-col gap-[8px]">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-cortex">
              {versionLabel(sel)} (after)
            </span>
            <ArchitectureDiagram graph={sel.graph} highlight={newHighlight} height={480} />
          </div>
        </div>
      ) : (
        sel && (
          <div className={generating ? "opacity-60 transition-opacity" : ""}>
            <ArchitectureDiagram graph={sel.graph} height={620} />
          </div>
        )
      )}

      {/* Legend */}
      {versions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-[6px] font-mono text-[10.5px] uppercase tracking-[0.06em] text-slate-2">
          <span className="flex items-center gap-[6px]">
            <svg width="26" height="8" aria-hidden style={{ color: TONE_COLOR.cortex }}>
              <line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" strokeWidth="1.6" strokeDasharray="4 6" />
            </svg>
            data flow
          </span>
          <span className="flex items-center gap-[6px]">
            <svg width="26" height="8" aria-hidden style={{ color: LEGEND_MUTED }}>
              <line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 5" />
            </svg>
            async / deploy
          </span>
          {compare && (
            <>
              <span className="flex items-center gap-[5px]">
                <span className="h-[8px] w-[8px] rounded-full border" style={{ borderColor: STATUS_COLOR.added }} /> added
              </span>
              <span className="flex items-center gap-[5px]">
                <span className="h-[8px] w-[8px] rounded-full border" style={{ borderColor: STATUS_COLOR.removed }} /> removed
              </span>
              <span className="flex items-center gap-[5px]">
                <span className="h-[8px] w-[8px] rounded-full border" style={{ borderColor: STATUS_COLOR.modified }} /> changed
              </span>
            </>
          )}
        </div>
      )}

      {/* Summary + changes for the selected version */}
      {sel && (sel.summary || sel.changes.length > 0) && (
        <section className="flex flex-col gap-[10px] rounded-[14px] border border-mist bg-bone-2 p-[18px]">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-slate-2">
            {sel.version === 1 ? "Architecture summary" : `What changed in v${sel.version}`}
          </span>
          {sel.summary && <p className="text-[13.5px] leading-relaxed text-ink-2">{sel.summary}</p>}
          {sel.changes.length > 0 && (
            <ul className="flex flex-col gap-[6px]">
              {sel.changes.map((c, i) => (
                <li key={i} className="flex items-baseline gap-[8px] text-[12.5px] leading-relaxed">
                  <span
                    className={[
                      "relative top-[-1px] h-[7px] w-[7px] shrink-0 rounded-full",
                      c.kind === "added" ? "bg-echo" : c.kind === "removed" ? "bg-pulse" : "bg-amber",
                    ].join(" ")}
                  />
                  <span>
                    <span className="font-medium text-ink">{c.target}</span>{" "}
                    <span className="text-slate">— {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
