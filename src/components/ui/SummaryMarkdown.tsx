"use client";

// Intentionally minimal markdown renderer for meeting summaries. The summary
// prompt constrains the model to: H3 section headers (### ), unordered bullets
// (- ) with at most one level of nesting, inline **bold** / *italic* / `code`,
// and `![alt](url)` images for screenshots.

import { Fragment } from "react";
import { ImageOff, Loader2, RotateCw } from "lucide-react";
import { useImageLoadState } from "@/lib/useImageLoadState";
import { MermaidDiagram } from "./MermaidDiagram";

type Block =
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: { text: string; children: string[] }[] }
  | { kind: "img"; alt: string; url: string }
  | { kind: "mermaid"; code: string }
  | { kind: "code"; lang: string | null; code: string };

function tokenize(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      out.push({ kind: "h3", text: line.slice(4).trim() });
      i++;
      continue;
    }

    // Fenced code block — `mermaid` renders as a diagram, anything else
    // renders as a plain code block. Consume until the closing fence.
    const fenceOpen = line.match(/^```(\w+)?\s*$/);
    if (fenceOpen) {
      const lang = (fenceOpen[1] ?? "").toLowerCase() || null;
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      // Skip the closing fence if present.
      if (i < lines.length) i++;
      const code = buf.join("\n");
      if (lang === "mermaid") out.push({ kind: "mermaid", code });
      else out.push({ kind: "code", lang, code });
      continue;
    }

    // Lone image line (`![alt](url)` on its own) gets a full-width block —
    // crisper than rendering it inline within a paragraph wrapper.
    const imgOnly = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgOnly) {
      out.push({ kind: "img", alt: imgOnly[1], url: imgOnly[2] });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: { text: string; children: string[] }[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const top = l.match(/^[-*]\s+(.*)$/);
        if (top) {
          items.push({ text: top[1], children: [] });
          i++;
          continue;
        }
        const nested = l.match(/^\s{2,}[-*]\s+(.*)$/);
        if (nested && items.length > 0) {
          items[items.length - 1].children.push(nested[1]);
          i++;
          continue;
        }
        break;
      }
      out.push({ kind: "ul", items });
      continue;
    }

    // Regular paragraph: greedily consume non-empty, non-header, non-bullet,
    // non-fence lines.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("### ") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push({ kind: "p", text: paraLines.join(" ") });
  }

  return out;
}

function renderImage(url: string, alt: string, key: string): React.ReactNode {
  const safe = url.startsWith("/api/") || url.startsWith("https://");
  if (!safe) return <Fragment key={key}>{`![${alt}](${url})`}</Fragment>;
  return <SummaryImage key={key} url={url} alt={alt} />;
}

// Image with load-state + auto-retry. The render endpoint can rate-limit;
// the placeholder hides the failure and a 90s timer retries automatically.
function SummaryImage({ url, alt }: { url: string; alt: string }) {
  const loader = useImageLoadState(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block my-2 max-w-full"
    >
      {loader.state === "loading" && (
        <span className="flex items-center gap-2 px-3 py-[14px] rounded-[6px] border border-mist bg-paper-2 text-[12px] text-slate min-h-[80px]">
          <Loader2 size={14} strokeWidth={1.6} className="animate-spin text-slate-2" />
          <span className="font-mono uppercase tracking-[0.06em] text-[10.5px]">
            Rendering frame…
          </span>
        </span>
      )}
      {loader.state === "errored" && (
        <span className="flex items-center gap-2 px-3 py-[14px] rounded-[6px] border border-mist bg-paper-2 text-[12px] text-amber-ink min-h-[80px]">
          <ImageOff size={14} strokeWidth={1.6} className="text-amber" />
          <span className="flex-1 font-mono uppercase tracking-[0.06em] text-[10.5px]">
            Couldn&apos;t render — retrying…
          </span>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              loader.retryNow();
            }}
            className="flex items-center gap-1 px-2 py-[2px] rounded-[4px] text-[10.5px] font-medium text-ink-2 bg-bone-2 border border-mist hover:bg-paper-2 cursor-pointer"
          >
            <RotateCw size={10} strokeWidth={1.6} />
            Retry now
          </button>
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={loader.src}
        alt={alt || "screenshot"}
        onLoad={loader.onLoad}
        onError={loader.onError}
        className={[
          "max-w-full max-h-[320px] rounded-[6px] border border-mist bg-paper-2 object-contain",
          loader.state === "loaded" ? "block" : "hidden",
        ].join(" ")}
      />
    </a>
  );
}

// Inline pass for **bold**, *italic*, `code`, and `![alt](url)` images.
// Order matters: handle images and code first so we don't mangle their
// contents with bold/italic regex.
function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  let nodeIdx = 0;

  // Split on image syntax up-front; keep text fragments for the inline pass
  // and replace image fragments with rendered <img>.
  const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const segments: { kind: "text" | "img"; alt?: string; url?: string; text?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(text)) !== null) {
    if (m.index > last) segments.push({ kind: "text", text: text.slice(last, m.index) });
    segments.push({ kind: "img", alt: m[1], url: m[2] });
    last = IMG_RE.lastIndex;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  if (segments.length === 0) segments.push({ kind: "text", text });

  for (const segment of segments) {
    if (segment.kind === "img" && segment.url) {
      nodes.push(renderImage(segment.url, segment.alt ?? "", `${keyPrefix}-img-${nodeIdx++}`));
      continue;
    }
    if (!segment.text) continue;
    const codeSplit = segment.text.split(/(`[^`]+`)/g);
    codeSplit.forEach((seg) => {
      if (seg.startsWith("`") && seg.endsWith("`") && seg.length >= 2) {
        nodes.push(
          <code
            key={`${keyPrefix}-${nodeIdx++}`}
            className="rounded bg-bone-2 border border-mist px-[5px] py-[1px] font-mono text-[12px] text-ink"
          >
            {seg.slice(1, -1)}
          </code>
        );
        return;
      }
      const boldSplit = seg.split(/(\*\*[^*]+\*\*)/g);
      boldSplit.forEach((s) => {
        if (s.startsWith("**") && s.endsWith("**") && s.length >= 4) {
          nodes.push(
            <strong key={`${keyPrefix}-${nodeIdx++}`} className="font-semibold text-ink">
              {s.slice(2, -2)}
            </strong>
          );
          return;
        }
        const italicSplit = s.split(/(\*[^*]+\*)/g);
        italicSplit.forEach((part) => {
          if (part.startsWith("*") && part.endsWith("*") && part.length >= 2 && !part.startsWith("**")) {
            nodes.push(
              <em key={`${keyPrefix}-${nodeIdx++}`} className="italic">
                {part.slice(1, -1)}
              </em>
            );
            return;
          }
          if (part) nodes.push(<Fragment key={`${keyPrefix}-${nodeIdx++}`}>{part}</Fragment>);
        });
      });
    });
  }

  return nodes;
}

export function SummaryMarkdown({ source }: { source: string }) {
  const blocks = tokenize(source);
  return (
    <div className="flex flex-col gap-[14px] text-[14px] leading-[1.6] text-ink">
      {blocks.map((b, i) => {
        if (b.kind === "h3") {
          return (
            <h3
              key={i}
              className="text-[15px] font-semibold tracking-[-0.005em] text-ink m-0 mt-[2px]"
            >
              {renderInline(b.text, `h${i}`)}
            </h3>
          );
        }
        if (b.kind === "p") {
          return (
            <p key={i} className="m-0">
              {renderInline(b.text, `p${i}`)}
            </p>
          );
        }
        if (b.kind === "img") {
          return (
            <Fragment key={i}>
              {renderImage(b.url, b.alt, `img${i}`)}
            </Fragment>
          );
        }
        if (b.kind === "mermaid") {
          return <MermaidDiagram key={i} code={b.code} />;
        }
        if (b.kind === "code") {
          return (
            <pre
              key={i}
              className="m-0 rounded-[6px] border border-mist bg-paper-2 p-3 overflow-x-auto font-mono text-[12px] text-ink leading-[1.5]"
            >
              {b.lang && (
                <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2 mb-2">
                  {b.lang}
                </div>
              )}
              {b.code}
            </pre>
          );
        }
        return (
          <ul key={i} className="m-0 pl-[18px] list-disc flex flex-col gap-[5px]">
            {b.items.map((item, j) => (
              <li key={j} className="leading-[1.55]">
                {renderInline(item.text, `li${i}-${j}`)}
                {item.children.length > 0 && (
                  <ul className="m-0 pl-[16px] mt-[3px] list-[circle] flex flex-col gap-[3px] text-ink-2">
                    {item.children.map((c, k) => (
                      <li key={k} className="leading-[1.5]">
                        {renderInline(c, `li${i}-${j}-${k}`)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
