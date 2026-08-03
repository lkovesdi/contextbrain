"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useImageLoadState } from "@/lib/useImageLoadState";

// Renders assistant markdown (headings, lists, blockquotes, code, etc.) and
// routes images through ChatImage. Non-/api/ and non-https image URLs are
// rendered as text to avoid pulling in arbitrary outbound assets.
//
// Pinning is optional: meeting chat passes `pinnedUrls` + `onTogglePin` to get
// the pin-to-summary right-click menu; space chat omits them and images just
// offer "Open original".
export function AssistantMarkdown({
  content,
  pinnedUrls,
  onTogglePin,
}: {
  content: string;
  pinnedUrls?: Set<string>;
  onTogglePin?: (url: string, alt: string, label: string) => void;
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
                isPinned={pinnedUrls?.has(src) ?? false}
                onTogglePin={
                  onTogglePin
                    ? () => onTogglePin(src, alt || "", alt || "")
                    : undefined
                }
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
  onTogglePin?: () => void;
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
            {onTogglePin && (
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
            )}
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
