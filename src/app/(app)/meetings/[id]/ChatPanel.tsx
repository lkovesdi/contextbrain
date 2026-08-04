"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import {
  ContextSelector,
  type Selection,
} from "@/components/context/ContextSelector";
import { AssistantMarkdown } from "@/components/chat/AssistantMarkdown";
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
            isUser ? "bg-paper-2 text-ink" : "bg-cortex text-on-accent",
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
