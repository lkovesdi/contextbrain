"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookmarkMinus,
  BookmarkPlus,
  ExternalLink,
  ImageOff,
  Loader2,
  RotateCw,
  Zap,
} from "lucide-react";
import { useImageLoadState } from "@/lib/useImageLoadState";
import { ContextSelector, type Selection } from "./ContextSelector";
import type { Provider } from "@/lib/composio";
import type { ChipData } from "@/components/context/ContextChip";
import type { Tag } from "@/lib/tags";
import { Button } from "@/components/ui/Button";
import SendIcon from "@/components/icons/SendIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";

type Msg = { role: "user" | "assistant"; content: string };

type PresetSources = {
  external_context_ids?: string[];
  note_ids?: string[];
  space_id?: string | null;
  recent_summary_count?: number;
  integrations?: Partial<Record<Provider, unknown>>;
} | null;

function defaultSelection(
  chips: ChipData[],
  integrations: string[],
  preset: PresetSources,
  tagIds: string[]
): Selection {
  if (!preset) {
    return {
      include_notes: false,
      external_context_ids: [],
      note_ids: [],
      space_id: null,
      tag_ids: tagIds,
      recent_summary_count: 3,
      integrations: [],
    };
  }
  const validExternal = new Set(chips.map((c) => c.id));
  const validIntegrations = new Set(integrations);
  return {
    include_notes: false,
    external_context_ids: (preset.external_context_ids ?? []).filter((id) =>
      validExternal.has(id)
    ),
    note_ids: preset.note_ids ?? [],
    space_id: preset.space_id ?? null,
    tag_ids: tagIds,
    recent_summary_count: preset.recent_summary_count ?? 3,
    integrations: Object.keys(preset.integrations ?? {})
      .filter((p): p is Provider => validIntegrations.has(p))
      .map((provider) => ({ provider })),
  };
}

export type PinnedImage = {
  url: string;
  alt: string | null;
  label: string | null;
};

export function ChatPanel({
  meetingId,
  chips,
  integrations,
  githubConnected,
  presetSources,
  presetName,
  tags = [],
  initialPinnedImages = [],
}: {
  meetingId: string;
  chips: ChipData[];
  integrations: string[];
  githubConnected: boolean;
  presetSources: PresetSources;
  presetName?: string | null;
  tags?: Tag[];
  initialPinnedImages?: PinnedImage[];
}) {
  const [selection, setSelection] = useState<Selection>(() =>
    defaultSelection(chips, integrations, presetSources, tags.map((t) => t.id))
  );
  const [pinnedUrls, setPinnedUrls] = useState<Set<string>>(
    () => new Set(initialPinnedImages.map((p) => p.url))
  );

  // Toggle a pin optimistically; rollback on server error.
  async function togglePin(url: string, alt: string, label: string) {
    const wasPinned = pinnedUrls.has(url);
    setPinnedUrls((prev) => {
      const next = new Set(prev);
      if (wasPinned) next.delete(url);
      else next.add(url);
      return next;
    });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/pin-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, alt, label, action: "toggle" }),
      });
      if (!res.ok) throw new Error(`pin failed (${res.status})`);
    } catch (e) {
      console.error("pin-image failed, rolling back:", e);
      setPinnedUrls((prev) => {
        const next = new Set(prev);
        if (wasPinned) next.add(url);
        else next.delete(url);
        return next;
      });
    }
  }
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendIconRef = useRef<AnimatedIconHandle | null>(null);

  // Cmd+K focuses the chat input (PRD §12 polish)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  // Read a text stream into the trailing (empty) assistant message.
  async function consume(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: acc };
        return copy;
      });
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          selection,
          meeting_id: meetingId,
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Chat failed");
        setError(errText || "Chat failed");
        setMessages((m) => m.slice(0, -1));
        return;
      }
      await consume(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  // Quick recap: 4–5 catch-up bullets for the whole meeting, then a one-paragraph
  // recap of the last ~5 minutes. Grounded in the live transcript server-side.
  async function catchUp() {
    if (streaming) return;
    setError(null);
    setMessages((m) => [
      ...m,
      { role: "user", content: "Catch me up" },
      { role: "assistant", content: "" },
    ]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/meetings/${meetingId}/catch-up`, {
        method: "POST",
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Catch-up failed");
        setError(errText || "Catch-up failed");
        setMessages((m) => m.slice(0, -1));
        return;
      }
      await consume(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Catch-up failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <ContextSelector
        selection={selection}
        setSelection={setSelection}
        chips={chips}
        integrations={integrations}
        githubConnected={githubConnected}
        presetName={presetName ?? null}
        tags={tags}
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-bone-2 border border-mist rounded-[10px] p-[14px] flex flex-col gap-[14px]"
      >
        {messages.length === 0 ? (
          <p className="text-[13px] text-slate m-0">
            Ask anything about this meeting, your notes, or the selected sources.
          </p>
        ) : (
          messages.map((m, i) => (
            <ChatMsg
              key={i}
              msg={m}
              streaming={streaming && i === messages.length - 1}
              pinnedUrls={pinnedUrls}
              onTogglePin={togglePin}
            />
          ))
        )}
      </div>

      {error && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            onClick={catchUp}
            disabled={streaming}
            leftIcon={<Zap size={13} strokeWidth={1.7} />}
          >
            Catch me up
          </Button>
        </div>
        <div className="flex items-stretch gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask… (⌘K)"
            className="flex-1 resize-none rounded-[6px] border border-mist bg-bone-2 text-[13px] leading-[1.5] text-ink px-3 py-[9px] outline-none"
          />
          <Button
            variant="primary"
            onClick={send}
            disabled={streaming || !input.trim()}
            className="self-stretch"
            onMouseEnter={() => sendIconRef.current?.startAnimation()}
            onMouseLeave={() => sendIconRef.current?.stopAnimation()}
            rightIcon={
              <SendIcon ref={sendIconRef} size={14} strokeWidth={1.6} />
            }
          >
            {streaming ? "…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatMsg({
  msg,
  streaming,
  pinnedUrls,
  onTogglePin,
}: {
  msg: Msg;
  streaming: boolean;
  pinnedUrls: Set<string>;
  onTogglePin: (url: string, alt: string, label: string) => void;
}) {
  const isUser = msg.role === "user";
  const role = isUser ? "You" : "ContextBrain";
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
        <span
          className={[
            "w-[14px] h-[14px] rounded-full grid place-content-center text-[9px]",
            isUser ? "bg-paper-2 text-ink" : "bg-cortex text-white",
          ].join(" ")}
        >
          {isUser ? "Y" : "●"}
        </span>
        {role}
      </div>
      <div className="text-[14px] leading-[1.6] text-ink">
        {isUser ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <AssistantMarkdown
            content={msg.content}
            pinnedUrls={pinnedUrls}
            onTogglePin={onTogglePin}
          />
        )}
        {!msg.content && streaming && "…"}
        {streaming && msg.content && (
          <span
            className="inline-block w-[7px] h-[14px] bg-cortex ml-[3px] align-[-3px] [animation:mb-blink_1s_steps(2)_infinite]"
          />
        )}
      </div>
    </div>
  );
}

// Renders assistant markdown (headings, lists, blockquotes, code, etc.) and
// routes images through ChatImage so the pin-to-summary right-click menu
// keeps working. Non-/api/ and non-https image URLs are rendered as text to
// avoid pulling in arbitrary outbound assets.
function AssistantMarkdown({
  content,
  pinnedUrls,
  onTogglePin,
}: {
  content: string;
  pinnedUrls: Set<string>;
  onTogglePin: (url: string, alt: string, label: string) => void;
}) {
  return (
    <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="text-[15px] font-semibold text-ink mt-3 mb-1.5 first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h4 className="text-[14px] font-semibold text-ink mt-3 mb-1.5 first:mt-0">
              {children}
            </h4>
          ),
          h3: ({ children }) => (
            <h5 className="text-[13.5px] font-semibold text-ink mt-2.5 mb-1 first:mt-0">
              {children}
            </h5>
          ),
          h4: ({ children }) => (
            <h6 className="text-[13px] font-semibold text-ink mt-2 mb-1 first:mt-0">
              {children}
            </h6>
          ),
          p: ({ children }) => (
            <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-1.5 space-y-[3px]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-1.5 space-y-[3px]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-[1.55] [&>p]:my-0">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-mist pl-3 my-1.5 text-slate [&>p]:my-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2.5 border-0 border-t border-mist" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-cortex underline underline-offset-2"
            >
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="my-2 rounded-[6px] bg-paper-2 border border-mist p-2 font-mono text-[12px] overflow-x-auto">
              {children}
            </pre>
          ),
          code: ({ className, children, ...rest }) => {
            if (className?.startsWith("language-")) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-[4px] bg-paper-2 border border-mist px-[5px] py-[1px] font-mono text-[12px]">
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="border-collapse text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-mist px-2 py-1 text-left font-semibold bg-paper-2">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-mist px-2 py-1 align-top">{children}</td>
          ),
          img: ({ src, alt }) => {
            if (typeof src !== "string") return null;
            const safe = src.startsWith("/api/") || src.startsWith("https://");
            if (!safe) return <>{`![${alt ?? ""}](${src})`}</>;
            return (
              <ChatImage
                url={src}
                alt={alt || ""}
                isPinned={pinnedUrls.has(src)}
                onTogglePin={() => onTogglePin(src, alt || "", alt || "")}
              />
            );
          },
        }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ----- Chat image with right-click menu -----------------------------------

function ChatImage({
  url,
  alt,
  isPinned,
  onTogglePin,
}: {
  url: string;
  alt: string;
  isPinned: boolean;
  onTogglePin: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Close on outside click or escape — use a single document-level listener
  // for both since we only have one menu open at a time.
  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest("[data-chat-image-menu]")) {
        setMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const loader = useImageLoadState(url);

  return (
    <span className="relative block my-2 max-w-full">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        className="block max-w-full"
      >
        {loader.state === "loading" && (
          <FrameImagePlaceholder
            tone="loading"
            label="Rendering frame…"
            isPinned={isPinned}
          />
        )}
        {loader.state === "errored" && (
          <FrameImagePlaceholder
            tone="errored"
            label="Couldn't render — retrying…"
            isPinned={isPinned}
            onRetry={(e) => {
              e.preventDefault();
              e.stopPropagation();
              loader.retryNow();
            }}
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={loader.src}
          alt={alt || "screenshot"}
          onLoad={loader.onLoad}
          onError={loader.onError}
          className={[
            "max-w-full max-h-[320px] rounded-[6px] border bg-paper-2 object-contain transition-shadow",
            loader.state === "loaded" ? "block" : "hidden",
            isPinned
              ? "border-cortex shadow-[0_0_0_2px_var(--cortex-tint)]"
              : "border-mist",
          ].join(" ")}
        />
        {isPinned && loader.state === "loaded" && (
          <span className="absolute top-1 right-1 px-[6px] py-[1px] rounded-full bg-cortex text-white font-mono text-[9px] uppercase tracking-[0.07em] pointer-events-none">
            in summary
          </span>
        )}
      </a>

      {menu &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-chat-image-menu
            className="fixed z-[60] min-w-[200px] rounded-[8px] border border-mist bg-bone-2 py-[4px] text-[13px]"
            style={{
              top: menu.y,
              left: menu.x,
              boxShadow: "var(--shadow-3)",
            }}
          >
            <button
              onClick={() => {
                onTogglePin();
                setMenu(null);
              }}
              className="w-full text-left px-3 py-[7px] text-ink hover:bg-paper-2 cursor-pointer bg-transparent border-0 flex items-center gap-2"
            >
              {isPinned ? (
                <>
                  <BookmarkMinus size={13} strokeWidth={1.6} className="text-slate" />
                  Remove from summary
                </>
              ) : (
                <>
                  <BookmarkPlus size={13} strokeWidth={1.6} className="text-cortex" />
                  Use in summary
                </>
              )}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenu(null)}
              className="w-full text-left px-3 py-[7px] text-ink hover:bg-paper-2 cursor-pointer flex items-center gap-2 no-underline"
            >
              <ExternalLink size={13} strokeWidth={1.6} className="text-slate" />
              Open original
            </a>
          </div>,
          document.body
        )}
    </span>
  );
}

// Calm placeholder shown while an image is loading or failed. Same footprint
// as the eventual image so the layout doesn't shift when the real frame
// drops in. The retry button only renders when an `onRetry` is provided.
function FrameImagePlaceholder({
  tone,
  label,
  isPinned,
  onRetry,
}: {
  tone: "loading" | "errored";
  label: string;
  isPinned: boolean;
  onRetry?: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      className={[
        "flex items-center gap-2 px-3 py-[14px] rounded-[6px] border bg-paper-2 text-[12px] text-slate min-h-[80px]",
        isPinned
          ? "border-cortex shadow-[0_0_0_2px_var(--cortex-tint)]"
          : "border-mist",
        tone === "errored" ? "text-amber-ink" : "",
      ].join(" ")}
    >
      {tone === "loading" ? (
        <Loader2 size={14} strokeWidth={1.6} className="animate-spin text-slate-2" />
      ) : (
        <ImageOff size={14} strokeWidth={1.6} className="text-amber" />
      )}
      <span className="flex-1 font-mono uppercase tracking-[0.06em] text-[10.5px]">
        {label}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-2 py-[2px] rounded-[4px] text-[10.5px] font-medium text-ink-2 bg-bone-2 border border-mist hover:bg-paper-2 cursor-pointer"
        >
          <RotateCw size={10} strokeWidth={1.6} />
          Retry now
        </button>
      )}
    </span>
  );
}
