"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitGraph,
  GitPullRequest,
  Loader2,
  Plus,
  Sparkles,
  Sprout,
} from "lucide-react";
import { Eyebrow } from "@/components/ui/typography";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/Modal";
import type { TicketPriority, TicketProvider, TicketType } from "@/lib/tickets";

// ---- Types matching the API response on /api/meetings/[id]/summary --------

export type SuggestedTicket = {
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  suggested_owner?: string | null;
};

export type GithubRef = {
  kind: "pr" | "issue" | "commit" | "branch";
  identifier: string;
  repo_hint?: string | null;
  context: string;
};

export type GithubRepo = { owner: string; repo: string };

export type SummaryExtrasData = {
  decisions?: { text: string; owner?: string | null }[];
  open_questions?: { text: string; raised_by?: string | null }[];
  tangents?: { topic: string; note: string }[];
  suggested_tickets?: SuggestedTicket[];
  github_refs?: GithubRef[];
  github_repos?: GithubRepo[];
};

export type CreatedTicket = {
  id: string;
  provider: TicketProvider;
  external_key: string;
  external_url: string | null;
  title: string;
  suggestion_title: string | null;
};

// ---- Top-level extras renderer --------------------------------------------

export function SummaryExtras({
  meetingId,
  extras,
  integrations,
  initialCreatedTickets,
}: {
  meetingId: string;
  extras: SummaryExtrasData;
  integrations: TicketProvider[];
  initialCreatedTickets: CreatedTicket[];
}) {
  const [createdTickets, setCreatedTickets] = useState(initialCreatedTickets);

  const decisions = extras.decisions ?? [];
  const openQuestions = extras.open_questions ?? [];
  const tangents = extras.tangents ?? [];
  const tickets = extras.suggested_tickets ?? [];
  const githubRefs = extras.github_refs ?? [];
  const githubRepos = extras.github_repos ?? [];

  if (
    decisions.length === 0 &&
    openQuestions.length === 0 &&
    tangents.length === 0 &&
    tickets.length === 0 &&
    githubRefs.length === 0
  ) {
    return null;
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      {decisions.length > 0 && (
        <ExtrasGroup
          eyebrow="Decisions"
          icon={<CheckCircle2 size={12} strokeWidth={1.6} className="text-echo" />}
        >
          {decisions.map((d, i) => (
            <li key={i} className="flex gap-2 items-start text-[13.5px] leading-[1.55]">
              <span className="text-echo mt-[7px] w-[5px] h-[5px] rounded-full bg-echo flex-shrink-0" />
              <span className="text-ink">
                {d.text}
                {d.owner && <Person> · {d.owner}</Person>}
              </span>
            </li>
          ))}
        </ExtrasGroup>
      )}

      {openQuestions.length > 0 && (
        <ExtrasGroup
          eyebrow="Open questions"
          icon={<CircleHelp size={12} strokeWidth={1.6} className="text-amber" />}
        >
          {openQuestions.map((q, i) => (
            <li key={i} className="flex gap-2 items-start text-[13.5px] leading-[1.55]">
              <span className="text-amber mt-[7px] w-[5px] h-[5px] rounded-full bg-amber flex-shrink-0" />
              <span className="text-ink">
                {q.text}
                {q.raised_by && <Person> · raised by {q.raised_by}</Person>}
              </span>
            </li>
          ))}
        </ExtrasGroup>
      )}

      {tangents.length > 0 && (
        <ExtrasGroup
          eyebrow="Tangents"
          icon={<Sprout size={12} strokeWidth={1.6} className="text-cortex" />}
        >
          {tangents.map((t, i) => (
            <li key={i} className="flex gap-2 items-start text-[13.5px] leading-[1.55]">
              <span className="text-cortex mt-[7px] w-[5px] h-[5px] rounded-full bg-cortex flex-shrink-0" />
              <span className="text-ink">
                <span className="font-medium">{t.topic}</span>
                <span className="text-slate"> — {t.note}</span>
              </span>
            </li>
          ))}
        </ExtrasGroup>
      )}

      {tickets.length > 0 && (
        <div>
          <div className="flex items-center gap-[6px] mb-2">
            <Sparkles size={12} strokeWidth={1.6} className="text-ink-2" />
            <Eyebrow>Suggested tickets</Eyebrow>
          </div>
          <div className="flex flex-col gap-2">
            {tickets.map((t, i) => (
              <SuggestedTicketCard
                key={i}
                meetingId={meetingId}
                ticket={t}
                integrations={integrations}
                created={findCreated(createdTickets, t)}
                onCreated={(row) =>
                  setCreatedTickets((prev) => [row, ...prev])
                }
              />
            ))}
          </div>
        </div>
      )}

      {githubRefs.length > 0 && (
        <div>
          <div className="flex items-center gap-[6px] mb-2">
            <GitGraph size={12} strokeWidth={1.6} className="text-ink-2" />
            <Eyebrow>GitHub references</Eyebrow>
          </div>
          <div className="flex flex-col gap-[6px]">
            {githubRefs.map((ref, i) => (
              <GitHubRefChip key={i} ref_={ref} repos={githubRepos} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function findCreated(rows: CreatedTicket[], suggestion: SuggestedTicket) {
  // Match by suggestion_title (preferred — set at creation time) or fall back
  // to title equality. Case-insensitive so light edits don't drop the link.
  const needle = suggestion.title.trim().toLowerCase();
  return rows.find(
    (r) =>
      (r.suggestion_title ?? r.title).trim().toLowerCase() === needle
  );
}

function ExtrasGroup({
  eyebrow,
  icon,
  children,
}: {
  eyebrow: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-[6px] mb-2">
        {icon}
        <Eyebrow>{eyebrow}</Eyebrow>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-[7px]">{children}</ul>
    </div>
  );
}

function Person({ children }: { children: React.ReactNode }) {
  return <span className="text-slate text-[12.5px]">{children}</span>;
}

// ---- GitHub ref chip -------------------------------------------------------

const REF_ICON: Record<GithubRef["kind"], React.ComponentType<{ size: number; strokeWidth: number; className?: string }>> = {
  pr: GitPullRequest,
  issue: CircleHelp,
  commit: GitCommitHorizontal,
  branch: GitBranch,
};

const REF_LABEL: Record<GithubRef["kind"], string> = {
  pr: "PR",
  issue: "Issue",
  commit: "Commit",
  branch: "Branch",
};

function buildRefUrl(
  kind: GithubRef["kind"],
  identifier: string,
  repo: GithubRepo
): string {
  const base = `https://github.com/${repo.owner}/${repo.repo}`;
  if (kind === "pr") return `${base}/pull/${identifier}`;
  if (kind === "issue") return `${base}/issues/${identifier}`;
  if (kind === "commit") return `${base}/commit/${identifier}`;
  return `${base}/tree/${encodeURIComponent(identifier)}`;
}

function shortIdentifier(kind: GithubRef["kind"], identifier: string): string {
  if (kind === "commit") return identifier.slice(0, 7);
  if (kind === "pr" || kind === "issue") return `#${identifier}`;
  return identifier;
}

function pickRepo(refHint: string | null | undefined, repos: GithubRepo[]): GithubRepo | null {
  if (repos.length === 0) return null;
  if (refHint) {
    const needle = refHint.toLowerCase();
    const exact = repos.find(
      (r) => `${r.owner}/${r.repo}`.toLowerCase() === needle
    );
    if (exact) return exact;
    const byRepo = repos.find((r) => r.repo.toLowerCase() === needle);
    if (byRepo) return byRepo;
  }
  return repos[0];
}

function GitHubRefChip({
  ref_,
  repos,
}: {
  ref_: GithubRef;
  repos: GithubRepo[];
}) {
  const Icon = REF_ICON[ref_.kind];
  const initialRepo = pickRepo(ref_.repo_hint, repos);
  const [chosenRepo, setChosenRepo] = useState<GithubRepo | null>(initialRepo);
  const url = chosenRepo ? buildRefUrl(ref_.kind, ref_.identifier, chosenRepo) : null;
  const ambiguous = repos.length > 1 && !ref_.repo_hint;

  return (
    <div className="flex items-start gap-2 rounded-[6px] border border-mist bg-paper px-[10px] py-[7px]">
      <Icon size={13} strokeWidth={1.7} className="text-slate-2 mt-[2px] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2">
            {REF_LABEL[ref_.kind]}
          </span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12.5px] font-medium text-cortex-ink hover:underline inline-flex items-center gap-1"
            >
              {shortIdentifier(ref_.kind, ref_.identifier)}
              <ExternalLink size={10} strokeWidth={1.6} className="opacity-60" />
            </a>
          ) : (
            <span className="font-mono text-[12.5px] text-ink-2">
              {shortIdentifier(ref_.kind, ref_.identifier)}
            </span>
          )}
          {chosenRepo && (
            <span className="text-[11px] text-slate-2">
              in {chosenRepo.owner}/{chosenRepo.repo}
            </span>
          )}
          {ambiguous && (
            <Select
              size="sm"
              aria-label="Repository"
              className="text-[11px]"
              value={`${chosenRepo?.owner}/${chosenRepo?.repo}`}
              onChange={(v) => {
                const [owner, repo] = v.split("/");
                setChosenRepo({ owner, repo });
              }}
              options={repos.map((r) => ({
                value: `${r.owner}/${r.repo}`,
                label: `${r.owner}/${r.repo}`,
              }))}
            />
          )}
        </div>
        <p className="m-0 mt-[2px] text-[12.5px] text-slate leading-[1.45]">
          {ref_.context}
        </p>
      </div>
    </div>
  );
}

// ---- Suggested ticket card -------------------------------------------------

const TYPE_LABEL: Record<TicketType, string> = {
  story: "Story",
  task: "Task",
  bug: "Bug",
  epic: "Epic",
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  urgent: "bg-pulse-tint text-pulse-ink",
  high: "bg-amber-tint text-amber-ink",
  medium: "bg-paper-2 text-slate border border-mist",
  low: "bg-paper-2 text-slate border border-mist",
  none: "bg-paper-2 text-slate-2 border border-mist",
};

function SuggestedTicketCard({
  meetingId,
  ticket,
  integrations,
  created,
  onCreated,
}: {
  meetingId: string;
  ticket: SuggestedTicket;
  integrations: TicketProvider[];
  created: CreatedTicket | undefined;
  onCreated: (row: CreatedTicket) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-[8px] border border-mist bg-paper p-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-[6px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2">
              {TYPE_LABEL[ticket.type]}
            </span>
            <span
              className={[
                "text-[10.5px] font-medium px-[7px] py-[1px] rounded-full",
                PRIORITY_TONE[ticket.priority],
              ].join(" ")}
            >
              {ticket.priority}
            </span>
            {ticket.suggested_owner && (
              <span className="text-[11px] text-slate">
                @{ticket.suggested_owner}
              </span>
            )}
          </div>
          <p className="m-0 text-[14px] font-medium text-ink leading-[1.35]">
            {ticket.title}
          </p>
          <p className="m-0 mt-[6px] text-[13px] text-slate leading-[1.5]">
            {ticket.description}
          </p>
        </div>

        <div className="flex-shrink-0">
          {created ? (
            <a
              href={created.external_url ?? "#"}
              target={created.external_url ? "_blank" : undefined}
              rel="noreferrer"
              className="inline-flex items-center gap-[6px] px-[10px] py-[5px] rounded-[4px] bg-echo-tint text-echo-ink text-[12px] font-medium hover:opacity-90"
            >
              <CheckCircle2 size={12} strokeWidth={1.8} />
              {created.external_key}
              {created.external_url && (
                <ExternalLink size={11} strokeWidth={1.6} className="opacity-60" />
              )}
            </a>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(true)}
              leftIcon={<Plus size={12} strokeWidth={1.8} />}
              disabled={integrations.length === 0}
              title={
                integrations.length === 0
                  ? "Connect Jira or Linear to create tickets"
                  : "Create ticket"
              }
            >
              Create
            </Button>
          )}
        </div>
      </div>

      {open && (
        <CreateTicketModal
          meetingId={meetingId}
          ticket={ticket}
          integrations={integrations}
          onClose={() => setOpen(false)}
          onCreated={(row) => {
            onCreated(row);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---- Create-ticket modal ---------------------------------------------------

type JiraProject = { id: string; key: string; name: string };
type LinearTeam = { id: string; key: string; name: string };
type LinearProject = { id: string; name: string };

function CreateTicketModal({
  meetingId,
  ticket,
  integrations,
  onClose,
  onCreated,
}: {
  meetingId: string;
  ticket: SuggestedTicket;
  integrations: TicketProvider[];
  onClose: () => void;
  onCreated: (row: CreatedTicket) => void;
}) {
  // Default to whichever provider is available; if both, prefer the first
  // one the user connected (passed in `integrations` order).
  const [provider, setProvider] = useState<TicketProvider>(integrations[0] ?? "jira");
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Jira state
  const [jiraProjects, setJiraProjects] = useState<JiraProject[] | null>(null);
  const [jiraProjectKey, setJiraProjectKey] = useState<string>("");

  // Linear state
  const [linearTeams, setLinearTeams] = useState<LinearTeam[] | null>(null);
  const [linearTeamId, setLinearTeamId] = useState<string>("");
  const [linearProjects, setLinearProjects] = useState<LinearProject[]>([]);
  const [linearProjectId, setLinearProjectId] = useState<string>("");

  // Lazy-load the selected provider's pickers when the user lands on or
  // switches to that tab. Error is cleared in the provider button handler
  // (not here) to avoid a synchronous setState inside the effect.
  useEffect(() => {
    let cancelled = false;
    if (provider === "jira" && jiraProjects === null) {
      (async () => {
        try {
          const res = await fetch("/api/jira/projects");
          const j = await res.json();
          if (cancelled) return;
          if (!res.ok) {
            setError(j.error ?? "Couldn't load Jira projects");
            return;
          }
          const list = j.projects ?? [];
          setJiraProjects(list);
          if (list[0]) setJiraProjectKey(list[0].key);
        } catch {
          if (!cancelled) setError("Couldn't load Jira projects");
        }
      })();
    }
    if (provider === "linear" && linearTeams === null) {
      (async () => {
        try {
          const [teamsRes, projectsRes] = await Promise.all([
            fetch("/api/linear/teams"),
            fetch("/api/linear/projects"),
          ]);
          const teamsJson = await teamsRes.json();
          const projectsJson = await projectsRes.json();
          if (cancelled) return;
          if (!teamsRes.ok) {
            setError(teamsJson.error ?? "Couldn't load Linear teams");
            return;
          }
          const teamList = teamsJson.teams ?? [];
          setLinearTeams(teamList);
          if (teamList[0]) setLinearTeamId(teamList[0].id);
          setLinearProjects(projectsJson.projects ?? []);
        } catch {
          if (!cancelled) setError("Couldn't load Linear teams");
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [provider, jiraProjects, linearTeams]);

  const canSubmit =
    !!title.trim() &&
    (provider === "jira" ? !!jiraProjectKey : !!linearTeamId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body =
        provider === "jira"
          ? {
              provider: "jira" as const,
              project_key: jiraProjectKey,
              title,
              description,
              type: ticket.type,
              priority: ticket.priority,
              suggested_owner: ticket.suggested_owner ?? null,
              suggestion_title: ticket.title,
            }
          : {
              provider: "linear" as const,
              team_id: linearTeamId,
              project_id: linearProjectId || undefined,
              title,
              description,
              type: ticket.type,
              priority: ticket.priority,
              suggested_owner: ticket.suggested_owner ?? null,
              suggestion_title: ticket.title,
            };
      const res = await fetch(`/api/meetings/${meetingId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok && res.status !== 207) {
        setError(j.error ?? `Create failed (${res.status})`);
        return;
      }
      onCreated(j.ticket);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md" labelledBy="create-ticket-title">
      <ModalHeader id="create-ticket-title">Create ticket</ModalHeader>
      <ModalBody>
        {integrations.length > 1 && (
          <div className="flex gap-2 mb-3">
            {integrations.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setProvider(p);
                  setError(null);
                }}
                className={[
                  "px-3 py-[5px] rounded-[6px] text-[12px] font-medium border",
                  provider === p
                    ? "bg-ink text-paper border-ink"
                    : "bg-paper text-slate border-mist hover:bg-paper-2",
                ].join(" ")}
              >
                {p === "jira" ? "Jira" : "Linear"}
              </button>
            ))}
          </div>
        )}

        <FieldLabel>Title</FieldLabel>
        <Input
          aria-label="Ticket title"
          className="mb-3"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <FieldLabel>Description</FieldLabel>
        <Textarea
          aria-label="Ticket description"
          className="mb-3"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {provider === "jira" && (
          <>
            <FieldLabel>Project</FieldLabel>
            <Select
              fullWidth
              aria-label="Jira project"
              className="mb-2"
              value={jiraProjectKey}
              onChange={setJiraProjectKey}
              disabled={jiraProjects === null}
              placeholder={jiraProjects === null ? "Loading projects…" : "Select a project"}
              options={(jiraProjects ?? []).map((p) => ({
                value: p.key,
                label: `${p.key} — ${p.name}`,
              }))}
            />
          </>
        )}

        {provider === "linear" && (
          <>
            <FieldLabel>Team</FieldLabel>
            <Select
              fullWidth
              aria-label="Linear team"
              className="mb-2"
              value={linearTeamId}
              onChange={setLinearTeamId}
              disabled={linearTeams === null}
              placeholder={linearTeams === null ? "Loading teams…" : "Select a team"}
              options={(linearTeams ?? []).map((t) => ({
                value: t.id,
                label: `${t.key} — ${t.name}`,
              }))}
            />

            <FieldLabel>Project (optional)</FieldLabel>
            <Select
              fullWidth
              aria-label="Linear project"
              className="mb-2"
              value={linearProjectId}
              onChange={setLinearProjectId}
              options={[
                { value: "", label: "No project" },
                ...linearProjects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </>
        )}

        {error && (
          <p className="mt-2 mb-1 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={busy || !canSubmit}
          leftIcon={
            busy ? (
              <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
            ) : undefined
          }
        >
          {busy ? "Creating…" : `Create in ${provider === "jira" ? "Jira" : "Linear"}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11.5px] font-medium uppercase tracking-[0.05em] text-slate-2 mb-1">
      {children}
    </label>
  );
}
