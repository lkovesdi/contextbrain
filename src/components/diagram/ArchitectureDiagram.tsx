"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Activity, BarChart3, Boxes, Braces, Cloud, Cpu, CreditCard, Database,
  FileText, GitBranch, Globe, HardDrive, KeyRound, ListOrdered, Mail,
  Maximize2, MessageSquare, Minus, Monitor, Network, Plug, Plus, Rocket,
  Search, Server, Settings, Shield, Smartphone, Sparkles, Timer, User,
  Webhook, Zap,
} from "lucide-react";
import type { DiagramGraph, DiagramGroup, DiagramIcon, GroupTone } from "@/lib/diagrams";
import { edgeKey } from "@/lib/diagrams";

// Azure-architecture-style renderer: icon tiles on a grid, labeled group
// boxes for boundaries, and flow edges whose dashes march in the direction of
// the data. Dark canvas on purpose — the one deliberately dark surface in the
// app, matching the genre of diagram it imitates.

type LucideIcon = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;

const ICON_META: Record<DiagramIcon, { icon: LucideIcon; color: string }> = {
  user:      { icon: User,          color: "#7DD3FC" },
  browser:   { icon: Globe,         color: "#7DD3FC" },
  mobile:    { icon: Smartphone,    color: "#7DD3FC" },
  frontend:  { icon: Monitor,       color: "#7DD3FC" },
  server:    { icon: Server,        color: "#A5B4FC" },
  api:       { icon: Network,       color: "#A5B4FC" },
  service:   { icon: Boxes,         color: "#A5B4FC" },
  worker:    { icon: Cpu,           color: "#A5B4FC" },
  function:  { icon: Braces,        color: "#A5B4FC" },
  queue:     { icon: ListOrdered,   color: "#F0ABFC" },
  scheduler: { icon: Timer,         color: "#F0ABFC" },
  database:  { icon: Database,      color: "#6EE7B7" },
  cache:     { icon: Zap,           color: "#6EE7B7" },
  storage:   { icon: HardDrive,     color: "#6EE7B7" },
  auth:      { icon: KeyRound,      color: "#FCD34D" },
  security:  { icon: Shield,        color: "#FCD34D" },
  webhook:   { icon: Webhook,       color: "#FCD34D" },
  mail:      { icon: Mail,          color: "#FCA5A5" },
  payment:   { icon: CreditCard,    color: "#FCA5A5" },
  chat:      { icon: MessageSquare, color: "#FCA5A5" },
  ai:        { icon: Sparkles,      color: "#C4B5FD" },
  search:    { icon: Search,        color: "#C4B5FD" },
  analytics: { icon: BarChart3,     color: "#5EEAD4" },
  monitor:   { icon: Activity,      color: "#5EEAD4" },
  pipeline:  { icon: Rocket,        color: "#E2E8F0" },
  repo:      { icon: GitBranch,     color: "#E2E8F0" },
  config:    { icon: Settings,      color: "#E2E8F0" },
  doc:       { icon: FileText,      color: "#E2E8F0" },
  cloud:     { icon: Cloud,         color: "#93C5FD" },
  external:  { icon: Plug,          color: "#93C5FD" },
};

const TONE_COLOR: Record<GroupTone, string> = {
  neutral: "#94A3B8",
  cortex:  "#8B8AF0",
  violet:  "#C084FC",
  amber:   "#E0A65A",
  green:   "#4ADE80",
  red:     "#F87171",
};

const STATUS_COLOR = { added: "#4ADE80", removed: "#F87171", modified: "#FBBF24" } as const;

const ZOOM_BTN =
  "cursor-pointer flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.06)] text-[#C9CBD4] transition-colors duration-[120ms] ease-[var(--ease-out)] hover:bg-[rgba(255,255,255,0.12)]";

const CELL_W = 170;
const CELL_H = 138;
const PAD = 72;
const TILE = 54;

const CANVAS_BG = "#111217";

function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Same tint as rgba(hex, alpha) painted on the canvas, but fully opaque — used
// for node tiles so edges routed underneath can't show through them.
function onCanvas(hex: string, alpha: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const mix = (i: number) =>
    Math.round(alpha * ch(hex, i) + (1 - alpha) * ch(CANVAS_BG, i));
  return `rgb(${mix(1)}, ${mix(3)}, ${mix(5)})`;
}

// Point on a cubic bezier at parameter t, one axis at a time.
function bez(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function wrapLabel(label: string, max = 17): string[] {
  if (label.length <= max) return [label];
  const words = label.split(" ");
  if (words.length === 1) return [label.slice(0, max - 1) + "…"];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    lines.length = 2;
    lines[1] = lines[1].slice(0, max - 1) + "…";
  }
  return lines;
}

type Rect = { x: number; y: number; w: number; h: number };

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export type DiagramHighlight = {
  nodes?: Record<string, "added" | "removed" | "modified">;
  edges?: Record<string, "added" | "removed">;
};

export function ArchitectureDiagram({
  graph,
  highlight,
  height = 560,
  className = "",
}: {
  graph: DiagramGraph;
  highlight?: DiagramHighlight;
  height?: number;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const interactedRef = useRef(false);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // ----- Geometry -----------------------------------------------------------

  const nodePos = new Map<string, { cx: number; cy: number }>();
  let maxCol = 0;
  let maxRow = 0;
  for (const n of graph.nodes) {
    maxCol = Math.max(maxCol, n.col);
    maxRow = Math.max(maxRow, n.row);
    nodePos.set(n.id, {
      cx: PAD + n.col * CELL_W + CELL_W / 2,
      cy: PAD + n.row * CELL_H + 46,
    });
  }
  const contentW = PAD * 2 + (maxCol + 1) * CELL_W;
  const contentH = PAD * 2 + (maxRow + 1) * CELL_H;

  // Group rectangles, computed bottom-up so parents wrap their children.
  const groupById = new Map(graph.groups.map((g) => [g.id, g]));
  const childrenOf = new Map<string, DiagramGroup[]>();
  for (const g of graph.groups) {
    if (g.parent && groupById.has(g.parent)) {
      childrenOf.set(g.parent, [...(childrenOf.get(g.parent) ?? []), g]);
    }
  }
  const rectCache = new Map<string, Rect | null>();
  const rectFor = (g: DiagramGroup): Rect | null => {
    if (rectCache.has(g.id)) return rectCache.get(g.id)!;
    let r: Rect | null = null;
    for (const n of graph.nodes) {
      if (n.group !== g.id) continue;
      r = union(r, {
        x: PAD + n.col * CELL_W + 16,
        y: PAD + n.row * CELL_H + 2,
        w: CELL_W - 32,
        h: CELL_H - 18,
      });
    }
    for (const child of childrenOf.get(g.id) ?? []) {
      const cr = rectFor(child);
      if (cr) r = union(r, cr);
    }
    if (r) r = { x: r.x - 16, y: r.y - 26, w: r.w + 32, h: r.h + 40 };
    rectCache.set(g.id, r);
    return r;
  };
  const depthOf = (g: DiagramGroup): number =>
    g.parent && groupById.has(g.parent) ? 1 + depthOf(groupById.get(g.parent)!) : 0;
  const orderedGroups = [...graph.groups].sort((a, b) => depthOf(a) - depthOf(b));

  // ----- Pan / zoom ---------------------------------------------------------

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (!cw || !ch) return;
    const k = Math.min(Math.max(Math.min((cw - 24) / contentW, (ch - 24) / contentH), 0.2), 1.1);
    setView({ x: (cw - contentW * k) / 2, y: (ch - contentH * k) / 2, k });
  }, [contentW, contentH]);

  useLayoutEffect(() => {
    interactedRef.current = false;
    fit();
  }, [fit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!interactedRef.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Wheel-zoom needs preventDefault, which React's passive wheel listener
  // forbids — attach natively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      interactedRef.current = true;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(Math.max(v.k * Math.exp(-e.deltaY * 0.0016), 0.15), 2.5);
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    interactedRef.current = true;
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const mx = (rect?.width ?? 0) / 2;
    const my = (rect?.height ?? 0) / 2;
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, 0.15), 2.5);
      return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    });
  };

  // ----- Render -------------------------------------------------------------

  const nodeStatus = highlight?.nodes ?? {};
  const edgeStatus = highlight?.edges ?? {};

  return (
    <div
      ref={containerRef}
      className={[
        "relative overflow-hidden rounded-[14px] border border-mist bg-[#111217]",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      ].join(" ")}
      style={{ height }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Clicks on the zoom controls must not start a pan — capturing the
        // pointer here would swallow the button's click event.
        if ((e.target as HTMLElement).closest("button")) return;
        interactedRef.current = true;
        dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
    >
      <style>{`
        @keyframes cbDiagramFlow { to { stroke-dashoffset: -18; } }
        .cb-edge-flow { stroke-dasharray: 5 13; animation: cbDiagramFlow 1.1s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .cb-edge-flow { animation: none; } }
      `}</style>

      <svg className="absolute inset-0 h-full w-full" role="img" aria-label="Architecture diagram">
        <defs>
          <pattern id={`${uid}-dots`} width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.045)" />
          </pattern>
          {(["flow", "dashed", "added", "removed"] as const).map((kind) => (
            <marker
              key={kind}
              id={`${uid}-arrow-${kind}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 1 L 8 5 L 0 9"
                fill="none"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                stroke={
                  kind === "flow"
                    ? "rgba(226,232,240,0.75)"
                    : kind === "dashed"
                      ? "rgba(226,232,240,0.4)"
                      : STATUS_COLOR[kind]
                }
              />
            </marker>
          ))}
        </defs>

        <g transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}>
          <rect x="0" y="0" width={contentW} height={contentH} fill={`url(#${uid}-dots)`} />

          {/* Group boxes (parents first, children painted over them) */}
          {orderedGroups.map((g) => {
            const r = rectFor(g);
            if (!r) return null;
            const tone = TONE_COLOR[g.tone];
            return (
              <g key={g.id}>
                <rect
                  x={r.x} y={r.y} width={r.w} height={r.h} rx="14"
                  fill={rgba(tone, 0.045)}
                  stroke={rgba(tone, 0.55)}
                  strokeWidth="1.2"
                />
                <text
                  x={r.x + 14} y={r.y + 19}
                  fontSize="10" fontWeight="600" letterSpacing="0.1em"
                  fill={tone}
                  style={{ fontFamily: "var(--font-geist-mono, monospace)", textTransform: "uppercase" }}
                >
                  {g.label}
                </text>
              </g>
            );
          })}

          {/* Edges under nodes */}
          {graph.edges.map((e) => {
            const s = nodePos.get(e.from);
            const t = nodePos.get(e.to);
            if (!s || !t) return null;
            const dx = t.cx - s.cx;
            const dy = t.cy - s.cy;
            const horizontal = Math.abs(dx) >= Math.abs(dy);
            const gap = TILE / 2 + 8;
            const sx = horizontal ? s.cx + Math.sign(dx) * gap : s.cx;
            const sy = horizontal ? s.cy : s.cy + Math.sign(dy) * gap;
            const tx = horizontal ? t.cx - Math.sign(dx) * (gap + 3) : t.cx;
            const ty = horizontal ? t.cy : t.cy - Math.sign(dy) * (gap + 3);
            const c1x = horizontal ? sx + (tx - sx) * 0.45 : sx;
            const c1y = horizontal ? sy : sy + (ty - sy) * 0.45;
            const c2x = horizontal ? tx - (tx - sx) * 0.45 : tx;
            const c2y = horizontal ? ty : ty - (ty - sy) * 0.45;
            const d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
            const key = edgeKey(e);
            const status = edgeStatus[key];
            const baseColor = status
              ? STATUS_COLOR[status]
              : e.style === "flow"
                ? "rgba(226,232,240,0.5)"
                : "rgba(226,232,240,0.32)";
            // Label at the curve midpoint — unless that lands on a node tile
            // or its caption (generated layouts do this a lot), in which case
            // slide along the curve to the nearest clear spot.
            let lt = 0.5;
            for (const cand of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22]) {
              const px = bez(cand, sx, c1x, c2x, tx);
              const py = bez(cand, sy, c1y, c2y, ty);
              const clear = graph.nodes.every((nn) => {
                const q = nodePos.get(nn.id)!;
                return (
                  px < q.cx - 64 || px > q.cx + 64 ||
                  py < q.cy - TILE / 2 - 10 || py > q.cy + TILE / 2 + 44
                );
              });
              if (clear) {
                lt = cand;
                break;
              }
            }
            const midX = bez(lt, sx, c1x, c2x, tx);
            const midY = bez(lt, sy, c1y, c2y, ty);
            return (
              <g key={key}>
                <path
                  d={d}
                  fill="none"
                  stroke={baseColor}
                  strokeWidth="1.4"
                  strokeDasharray={e.style === "dashed" ? "4 7" : undefined}
                  markerEnd={`url(#${uid}-arrow-${status ?? e.style})`}
                />
                {e.style === "flow" && (
                  <path
                    className="cb-edge-flow"
                    d={d}
                    fill="none"
                    stroke={status ? STATUS_COLOR[status] : "#A5B4FC"}
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                )}
                {e.label && (
                  <text
                    x={midX} y={midY - 6}
                    textAnchor="middle" fontSize="9.5"
                    fill="rgba(226,232,240,0.65)"
                    stroke={CANVAS_BG} strokeWidth="4" paintOrder="stroke"
                    style={{ fontFamily: "var(--font-geist-mono, monospace)" }}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {graph.nodes.map((n) => {
            const p = nodePos.get(n.id)!;
            const meta = ICON_META[n.icon] ?? ICON_META.service;
            const Icon = meta.icon;
            const status = nodeStatus[n.id];
            const lines = wrapLabel(n.label);
            return (
              <g key={n.id}>
                {status && (
                  <rect
                    x={p.cx - TILE / 2 - 6} y={p.cy - TILE / 2 - 6}
                    width={TILE + 12} height={TILE + 12} rx="16"
                    fill="none"
                    stroke={STATUS_COLOR[status]}
                    strokeWidth="1.6"
                    opacity="0.9"
                  />
                )}
                <rect
                  x={p.cx - TILE / 2} y={p.cy - TILE / 2}
                  width={TILE} height={TILE} rx="13"
                  fill={onCanvas(meta.color, 0.13)}
                  stroke={rgba(meta.color, 0.5)}
                  strokeWidth="1.2"
                />
                <g transform={`translate(${p.cx - 11}, ${p.cy - 11})`}>
                  <Icon size={22} strokeWidth={1.7} color={meta.color} />
                </g>
                {lines.map((line, i) => (
                  <text
                    key={i}
                    x={p.cx} y={p.cy + TILE / 2 + 16 + i * 14}
                    textAnchor="middle" fontSize="11.5"
                    fill="#E6E7EB"
                    stroke={CANVAS_BG} strokeWidth="4" paintOrder="stroke"
                  >
                    {line}
                  </text>
                ))}
                {n.sublabel && (
                  <text
                    x={p.cx} y={p.cy + TILE / 2 + 16 + lines.length * 14}
                    textAnchor="middle" fontSize="8.5" letterSpacing="0.06em"
                    fill="rgba(226,232,240,0.55)"
                    stroke={CANVAS_BG} strokeWidth="4" paintOrder="stroke"
                    style={{ fontFamily: "var(--font-geist-mono, monospace)", textTransform: "uppercase" }}
                  >
                    {n.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-[6px]">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoomBy(1.25)}
          className={ZOOM_BTN}
        >
          <Plus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoomBy(1 / 1.25)}
          className={ZOOM_BTN}
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Fit to view"
          title="Fit to view"
          onClick={() => {
            interactedRef.current = false;
            fit();
          }}
          className={ZOOM_BTN}
        >
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
