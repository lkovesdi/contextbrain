// Per-integration adapters that drive the generic ContextSourcePicker.
// Adding a new integration means writing one config object below — the picker
// component itself stays the same.

export type ProviderId = "github" | "jira" | "linear" | "figma";

export type ContainerItem = {
  id: string;
  display: string;
  secondary?: string | null;
  badge?: string | null;
  // Raw data the config can read in containerToPayload / listChildren.
  raw: Record<string, unknown>;
};

export type ChildItem = {
  id: string;
  display: string;
  secondary?: string | null;
  meta?: string | null;
  iconKind: "folder" | "file" | "ticket";
  isNavigable: boolean;
  // For recursive providers (github folders), the path passed to listChildren
  // when the user drills in. Ignored for non-recursive providers.
  navigatePath?: string;
  raw: Record<string, unknown>;
};

export type SourceProviderConfig = {
  id: ProviderId;
  label: string;
  containerNoun: string;     // "repos", "projects" — used in placeholders
  childNoun: string;         // "files", "issues" — used in "Add this folder/issue" buttons
  childrenAreRecursive: boolean;
  // Optional override for the input placeholder. Defaults to
  // `Search <Label> <containerNoun> to add as context…`.
  containerPlaceholder?: string;
  // Shown in the dropdown when `searchContainers` returns nothing. Defaults
  // to "No <containerNoun> found." Use for providers where the empty state
  // means "you need to type something specific" rather than "no matches."
  emptyHint?: string;
  searchContainers: (query: string) => Promise<ContainerItem[]>;
  listChildren: (container: ContainerItem, path: string) => Promise<ChildItem[]>;
  createChipUrl: string;
  // Build the request body for "add the whole container as a chip".
  containerToPayload: (container: ContainerItem) => unknown;
  // Override the action button label per-container (defaults to "Whole <X>").
  // Lets a config flip the verb when context says "this is more specific" —
  // e.g. a Figma URL with a node-id targets a single frame.
  containerActionLabel?: (container: ContainerItem) => string;
  // Build the request body for "add this folder/file/issue as a chip".
  // For recursive providers, `child` may be undefined when the user clicks
  // "Add this folder" with no leaf selected (i.e. add the current path).
  childToPayload: (
    container: ContainerItem,
    child: ChildItem | null,
    currentPath: string
  ) => unknown;

  // Optional: when a container has multiple "scopes" the user can drill into
  // besides the default file/child tree (e.g. GitHub repo → branches, PRs).
  // Picker renders these as a tab strip at the top of the children view.
  // Each non-default mode shows a flat list (no recursion); clicking an item
  // adds it as a chip directly via `modeChildToPayload`.
  intermediateModes?: {
    // The first item is treated as the default (the existing tree view) and
    // doesn't need a `listForMode` — set its key to "__default".
    modes: Array<{ key: string; label: string }>;
    // Returns the flat list of items shown when `activeMode` ≠ "__default".
    listForMode: (
      container: ContainerItem,
      modeKey: string,
      query: string
    ) => Promise<ChildItem[]>;
    // Empty-state hint when listForMode returns 0 items.
    emptyHintForMode?: (modeKey: string) => string;
    // Build the request body for "add this branch/PR/etc."
    modeChildToPayload: (
      container: ContainerItem,
      modeKey: string,
      child: ChildItem
    ) => unknown;
  };
};

// ---------------- Helpers ----------------

async function getJson(url: string): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      data,
      error:
        (data as { error?: string }).error ?? `${res.status} ${res.statusText}`,
    };
  }
  return { ok: true, data };
}

// ---------------- GitHub ----------------

const githubProvider: SourceProviderConfig = {
  id: "github",
  label: "GitHub",
  containerNoun: "repos",
  childNoun: "files",
  childrenAreRecursive: true,

  async searchContainers(query) {
    const r = await getJson(`/api/github/repos?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(r.error);
    const repos =
      ((r.data as { repos?: Array<Record<string, unknown>> }).repos ?? []);
    return repos.map((repo) => ({
      id: String(repo.full_name ?? `${repo.owner}/${repo.name}`),
      display: String(repo.full_name ?? ""),
      secondary: (repo.description as string) ?? null,
      badge: repo.private ? "private" : null,
      raw: repo,
    }));
  },

  async listChildren(container, path) {
    const owner = String(container.raw.owner ?? "");
    const repo = String(container.raw.name ?? "");
    const ref = String(container.raw.default_branch ?? "");
    const params = new URLSearchParams({ owner, repo, path });
    if (ref) params.set("ref", ref);
    const r = await getJson(`/api/github/tree?${params.toString()}`);
    if (!r.ok) throw new Error(r.error);
    const entries =
      ((r.data as { entries?: Array<Record<string, unknown>> }).entries ?? []);
    return entries.map((e) => {
      const isDir = e.type === "dir";
      return {
        id: String(e.path ?? ""),
        display: String(e.name ?? ""),
        meta: !isDir && typeof e.size === "number" ? formatBytes(e.size as number) : null,
        iconKind: isDir ? "folder" : "file",
        isNavigable: isDir,
        navigatePath: isDir ? String(e.path ?? "") : undefined,
        raw: e,
      } as ChildItem;
    });
  },

  createChipUrl: "/api/contexts/github",

  containerToPayload(container) {
    return {
      kind: "repo",
      owner: String(container.raw.owner ?? ""),
      repo: String(container.raw.name ?? ""),
      ref: String(container.raw.default_branch ?? ""),
      path: "",
    };
  },

  childToPayload(container, child, currentPath) {
    const owner = String(container.raw.owner ?? "");
    const repo = String(container.raw.name ?? "");
    const ref = String(container.raw.default_branch ?? "");
    if (!child) {
      // "Add this folder" — currentPath may be "" meaning the whole repo.
      return {
        kind: currentPath ? "path" : "repo",
        owner,
        repo,
        ref,
        path: currentPath,
      };
    }
    return {
      kind: "file",
      owner,
      repo,
      ref,
      path: child.id,
    };
  },

  intermediateModes: {
    modes: [
      { key: "__default", label: "Files" },
      { key: "branches", label: "Branches" },
      { key: "prs", label: "Pull requests" },
    ],
    async listForMode(container, modeKey, query) {
      const owner = String(container.raw.owner ?? "");
      const repo = String(container.raw.name ?? "");
      if (modeKey === "branches") {
        const params = new URLSearchParams({ owner, repo, q: query });
        const r = await getJson(`/api/github/branches?${params.toString()}`);
        if (!r.ok) throw new Error(r.error);
        const branches =
          ((r.data as { branches?: Array<Record<string, unknown>> }).branches ?? []);
        return branches.map((b) => ({
          id: `branch:${String(b.name ?? "")}`,
          display: String(b.name ?? ""),
          secondary: b.protected ? "protected" : null,
          meta: typeof b.sha === "string" ? (b.sha as string).slice(0, 7) : null,
          iconKind: "folder",
          isNavigable: false,
          raw: b,
        }));
      }
      if (modeKey === "prs") {
        const params = new URLSearchParams({ owner, repo, q: query, state: "open" });
        const r = await getJson(`/api/github/prs?${params.toString()}`);
        if (!r.ok) throw new Error(r.error);
        const prs =
          ((r.data as { prs?: Array<Record<string, unknown>> }).prs ?? []);
        return prs.map((p) => {
          const number = typeof p.number === "number" ? p.number : Number(p.number);
          const draft = !!p.draft;
          const merged = !!p.merged;
          const state = String(p.state ?? "open");
          const statusLabel = merged ? "merged" : draft ? "draft" : state;
          return {
            id: `pr:${number}`,
            display: `#${number} · ${String(p.title ?? "")}`,
            secondary: p.author ? `by ${p.author}` : null,
            meta: statusLabel,
            iconKind: "ticket",
            isNavigable: false,
            raw: p,
          } as ChildItem;
        });
      }
      return [];
    },
    emptyHintForMode(modeKey) {
      if (modeKey === "branches") return "No branches match.";
      if (modeKey === "prs") return "No open PRs match. Try a different repo.";
      return "Nothing here.";
    },
    modeChildToPayload(container, modeKey, child) {
      const owner = String(container.raw.owner ?? "");
      const repo = String(container.raw.name ?? "");
      if (modeKey === "branches") {
        return {
          kind: "branch",
          owner,
          repo,
          branch: String(child.raw.name ?? ""),
          branch_sha: String(child.raw.sha ?? ""),
        };
      }
      if (modeKey === "prs") {
        const number =
          typeof child.raw.number === "number"
            ? child.raw.number
            : Number(child.raw.number);
        return {
          kind: "pr",
          owner,
          repo,
          pr_number: number,
          pr_title: String(child.raw.title ?? ""),
        };
      }
      return {};
    },
  },
};

// ---------------- Jira ----------------

const jiraProvider: SourceProviderConfig = {
  id: "jira",
  label: "Jira",
  containerNoun: "projects",
  childNoun: "issues",
  childrenAreRecursive: false,

  async searchContainers(query) {
    const r = await getJson(`/api/jira/projects?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(r.error);
    const projects =
      ((r.data as { projects?: Array<Record<string, unknown>> }).projects ?? []);
    return projects.map((p) => ({
      id: String(p.key ?? p.id ?? ""),
      display: `${p.key} · ${p.name}`,
      secondary: (p.description as string) ?? null,
      raw: p,
    }));
  },

  async listChildren(container) {
    const projectKey = String(container.raw.key ?? "");
    const r = await getJson(
      `/api/jira/issues?project=${encodeURIComponent(projectKey)}`
    );
    if (!r.ok) throw new Error(r.error);
    const issues =
      ((r.data as { issues?: Array<Record<string, unknown>> }).issues ?? []);
    return issues.map((i) => ({
      id: String(i.key ?? ""),
      display: `${i.key} · ${i.summary}`,
      meta: (i.status as string) ?? null,
      iconKind: "ticket",
      isNavigable: false,
      raw: i,
    }));
  },

  createChipUrl: "/api/contexts/jira",

  containerToPayload(container) {
    return {
      kind: "project",
      project_key: String(container.raw.key ?? ""),
      project_name: String(container.raw.name ?? ""),
    };
  },

  childToPayload(container, child) {
    if (!child) {
      return {
        kind: "project",
        project_key: String(container.raw.key ?? ""),
        project_name: String(container.raw.name ?? ""),
      };
    }
    return {
      kind: "issue",
      project_key: String(container.raw.key ?? ""),
      project_name: String(container.raw.name ?? ""),
      issue_key: String(child.raw.key ?? ""),
      issue_summary: String(child.raw.summary ?? ""),
    };
  },
};

// ---------------- Linear ----------------

const linearProvider: SourceProviderConfig = {
  id: "linear",
  label: "Linear",
  containerNoun: "projects",
  childNoun: "issues",
  childrenAreRecursive: false,

  async searchContainers(query) {
    const r = await getJson(`/api/linear/projects?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(r.error);
    const projects =
      ((r.data as { projects?: Array<Record<string, unknown>> }).projects ?? []);
    return projects.map((p) => ({
      id: String(p.id ?? ""),
      display: String(p.name ?? ""),
      secondary: (p.description as string) ?? null,
      raw: p,
    }));
  },

  async listChildren(container) {
    const projectId = String(container.raw.id ?? "");
    const r = await getJson(
      `/api/linear/issues?project=${encodeURIComponent(projectId)}`
    );
    if (!r.ok) throw new Error(r.error);
    const issues =
      ((r.data as { issues?: Array<Record<string, unknown>> }).issues ?? []);
    return issues.map((i) => ({
      id: String(i.id ?? ""),
      display: `${i.identifier} · ${i.title}`,
      meta: (i.state as string) ?? null,
      iconKind: "ticket",
      isNavigable: false,
      raw: i,
    }));
  },

  createChipUrl: "/api/contexts/linear",

  containerToPayload(container) {
    return {
      kind: "project",
      project_id: String(container.raw.id ?? ""),
      project_name: String(container.raw.name ?? ""),
    };
  },

  childToPayload(container, child) {
    if (!child) {
      return {
        kind: "project",
        project_id: String(container.raw.id ?? ""),
        project_name: String(container.raw.name ?? ""),
      };
    }
    return {
      kind: "issue",
      project_id: String(container.raw.id ?? ""),
      project_name: String(container.raw.name ?? ""),
      issue_id: String(child.raw.id ?? ""),
      issue_identifier: String(child.raw.identifier ?? ""),
      issue_title: String(child.raw.title ?? ""),
    };
  },
};

// ---------------- Figma ----------------

// Figma is unique: there's no "list all my files" endpoint, so the input is
// a URL paste. The user grabs a URL from Figma and we resolve it to the file
// + node tree. From there the picker behaves like the others.
const figmaProvider: SourceProviderConfig = {
  id: "figma",
  label: "Figma",
  containerNoun: "files",
  childNoun: "frames",
  childrenAreRecursive: false,
  containerPlaceholder: "Paste a Figma URL to add as context…",
  emptyHint:
    "Paste a full Figma URL — figma.com/file/…, /design/…, /board/…, /proto/…, or /slides/…",

  async searchContainers(query) {
    if (!query.trim()) return [];
    const r = await getJson(`/api/figma/resolve?url=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error(r.error);
    const files =
      ((r.data as { files?: Array<Record<string, unknown>> }).files ?? []);
    return files.map((f) => {
      const nodeId = (f.target_node_id as string) ?? null;
      const nodeName = (f.target_node_name as string) ?? null;
      return {
        id: String(f.file_key ?? ""),
        display: String(f.name ?? ""),
        secondary: nodeId
          ? `→ ${nodeName ?? `frame ${nodeId}`}`
          : f.last_modified
          ? `last modified ${f.last_modified}`
          : null,
        raw: f,
      };
    });
  },

  async listChildren(container) {
    const fileKey = String(container.raw.file_key ?? "");
    const r = await getJson(`/api/figma/nodes?file=${encodeURIComponent(fileKey)}`);
    if (!r.ok) throw new Error(r.error);
    const nodes =
      ((r.data as { nodes?: Array<Record<string, unknown>> }).nodes ?? []);
    return nodes.map((n) => ({
      id: String(n.id ?? ""),
      display: String(n.name ?? ""),
      meta: (n.type as string) ?? null,
      iconKind: "file",
      isNavigable: false,
      raw: n,
    }));
  },

  createChipUrl: "/api/contexts/figma",

  containerToPayload(container) {
    // If the URL targeted a specific node (dev links etc.), default to
    // chipping that frame — that's almost always what the user wants when
    // they paste a node-deep URL. They can still drill in for other frames.
    const nodeId = (container.raw.target_node_id as string) ?? null;
    const nodeName = (container.raw.target_node_name as string) ?? null;
    if (nodeId) {
      return {
        kind: "node",
        file_key: String(container.raw.file_key ?? ""),
        file_name: String(container.raw.name ?? ""),
        node_id: nodeId,
        node_name: nodeName ?? `Frame ${nodeId}`,
      };
    }
    return {
      kind: "file",
      file_key: String(container.raw.file_key ?? ""),
      file_name: String(container.raw.name ?? ""),
    };
  },

  containerActionLabel(container) {
    return container.raw.target_node_id ? "Add this frame" : "Whole file";
  },

  childToPayload(container, child) {
    if (!child) {
      return {
        kind: "file",
        file_key: String(container.raw.file_key ?? ""),
        file_name: String(container.raw.name ?? ""),
      };
    }
    return {
      kind: "node",
      file_key: String(container.raw.file_key ?? ""),
      file_name: String(container.raw.name ?? ""),
      node_id: String(child.raw.id ?? ""),
      node_name: String(child.raw.name ?? ""),
    };
  },
};

export const SOURCE_PROVIDERS: Record<ProviderId, SourceProviderConfig> = {
  github: githubProvider,
  jira: jiraProvider,
  linear: linearProvider,
  figma: figmaProvider,
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
