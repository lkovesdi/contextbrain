"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GitBranch, Plus, Trash2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/ConfirmModal";
import type { DiagramRepoRef, DiagramRow } from "@/lib/diagrams";

export type DiagramListRow = DiagramRow & { latest_summary: string | null };

type RepoResult = {
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  description: string | null;
  private: boolean;
};

export function DiagramsManager({ diagrams }: { diagrams: DiagramListRow[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);

  async function deleteDiagram(d: DiagramListRow) {
    const ok = await confirm({
      title: `Delete “${d.title}”?`,
      message: "All versions of this diagram will be deleted. This can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await fetch(`/api/diagrams/${d.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" leftIcon={<Plus size={14} strokeWidth={2} />} onClick={() => setModalOpen(true)}>
          New diagram
        </Button>
      </div>

      {diagrams.length === 0 ? (
        <div className="flex flex-col items-center gap-[10px] rounded-[14px] border border-dashed border-mist-2 bg-bone-2 px-8 py-14 text-center">
          <Workflow size={22} strokeWidth={1.5} className="text-slate" />
          <p className="text-[13.5px] text-ink-2 max-w-[380px]">
            Pull in one or more GitHub repos and get a living architecture diagram —
            with animated data flow and version history as the system changes.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
            Create your first diagram
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
          {diagrams.map((d) => (
            <Link
              key={d.id}
              href={`/diagrams/${d.id}`}
              className="group cursor-pointer flex flex-col gap-[10px] rounded-[14px] border border-mist bg-bone-2 p-[18px] transition-colors duration-[120ms] ease-[var(--ease-out)] hover:border-mist-2 hover:shadow-[var(--shadow-1)]"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-medium text-ink leading-snug">{d.title}</h3>
                <button
                  type="button"
                  aria-label={`Delete ${d.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void deleteDiagram(d);
                  }}
                  className="cursor-pointer shrink-0 rounded-[6px] p-[5px] text-slate-2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 hover:bg-paper-2 hover:text-pulse"
                >
                  <Trash2 size={13} strokeWidth={1.7} />
                </button>
              </div>

              <div className="flex flex-wrap gap-[6px]">
                {d.repos.map((r) => (
                  <span
                    key={`${r.owner}/${r.name}`}
                    className="inline-flex items-center gap-[5px] rounded-[6px] bg-paper-2 px-[8px] py-[3px] font-mono text-[10.5px] text-ink-2"
                  >
                    <GitBranch size={10} strokeWidth={1.8} className="text-slate" />
                    {r.owner}/{r.name}
                  </span>
                ))}
              </div>

              {d.latest_summary && (
                <p className="text-[12.5px] leading-relaxed text-slate line-clamp-2">{d.latest_summary}</p>
              )}

              <div className="mt-auto flex items-center gap-[10px] font-mono text-[10.5px] uppercase tracking-[0.06em] text-slate-2">
                <span className={d.current_version > 0 ? "text-cortex" : ""}>
                  {d.current_version > 0 ? `v${d.current_version}` : "not generated"}
                </span>
                <span>
                  {new Date(d.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewDiagramModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

function NewDiagramModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RepoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, DiagramRepoRef>>(new Map());
  const [creating, setCreating] = useState(false);

  // Debounced repo search; empty query lists the user's recently-updated repos.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/github/repos?q=${encodeURIComponent(query)}`);
        if (cancelled) return;
        if (res.status === 412) {
          setNotConnected(true);
          setResults([]);
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Search failed");
        setNotConnected(false);
        setError(null);
        setResults(body.repos ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const selectedList = useMemo(() => [...selected.values()], [selected]);

  function toggle(repo: RepoResult) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(repo.full_name)) next.delete(repo.full_name);
      else if (next.size < 6) {
        next.set(repo.full_name, { owner: repo.owner, name: repo.name, branch: repo.default_branch });
      }
      return next;
    });
  }

  async function create() {
    if (selectedList.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/diagrams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || undefined, repos: selectedList }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create diagram");
      router.push(`/diagrams/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create diagram");
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md" labelledBy="new-diagram-title">
      <ModalHeader id="new-diagram-title">New architecture diagram</ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-[14px]">
          <Input
            label="Title"
            placeholder="Defaults to the repo names"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-autofocus
          />

          <div className="flex flex-col gap-[8px]">
            <Input
              label="Repos"
              placeholder="Search your GitHub repos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              hint={selectedList.length > 0 ? `${selectedList.length} selected (max 6)` : undefined}
            />

            {notConnected ? (
              <div className="rounded-[10px] border border-amber/40 bg-amber-tint px-[14px] py-[10px] text-[12.5px] text-amber-ink">
                GitHub isn&apos;t connected.{" "}
                <Link href="/integrations" className="underline cursor-pointer">
                  Connect it in Integrations
                </Link>{" "}
                first, then come back.
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto rounded-[10px] border border-mist bg-bone-2">
                {searching && results.length === 0 ? (
                  <div className="px-[14px] py-[12px] font-mono text-[11px] text-slate-2">Searching…</div>
                ) : results.length === 0 ? (
                  <div className="px-[14px] py-[12px] font-mono text-[11px] text-slate-2">No repos found.</div>
                ) : (
                  results.map((r) => (
                    <div
                      key={r.full_name}
                      className="border-b border-mist px-[12px] py-[8px] last:border-b-0 hover:bg-paper-2"
                    >
                      <Checkbox checked={selected.has(r.full_name)} onChange={() => toggle(r)}>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px] text-ink">
                            {r.full_name}
                            {r.private && (
                              <span className="ml-[6px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-slate-2">
                                private
                              </span>
                            )}
                          </span>
                          {r.description && (
                            <span className="truncate text-[11.5px] text-slate">{r.description}</span>
                          )}
                        </span>
                      </Checkbox>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {error && <p className="text-[12.5px] text-pulse">{error}</p>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={selectedList.length === 0 || creating}
          onClick={() => void create()}
        >
          {creating ? "Creating…" : "Create diagram"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
