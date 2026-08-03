"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, Trash2 } from "lucide-react";
import {
  ContextSelector,
  type Selection,
} from "@/components/context/ContextSelector";
import { AssistantMarkdown } from "@/components/chat/AssistantMarkdown";
import type { Provider } from "@/lib/composio";
import type { ChipData } from "@/components/context/ContextChip";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmModal";
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

// Seed the picker from the space's default preset — that's the context
// "already part of" the space. The space itself always stays in scope
// (space_id is pinned to this space, never the preset's).
function defaultSelection(
  spaceId: string,
  chips: ChipData[],
  integrations: string[],
  preset: PresetSources
): Selection {
  if (!preset) {
    return {
      include_notes: false,
      external_context_ids: [],
      note_ids: [],
      space_id: spaceId,
      tag_ids: [],
      recent_summary_count: 5,
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
    space_id: spaceId,
    tag_ids: [],
    recent_summary_count: preset.recent_summary_count ?? 5,
    integrations: Object.keys(preset.integrations ?? {})
      .filter((p): p is Provider => validIntegrations.has(p))
      .map((provider) => ({ provider })),
  };
}

export function SpaceChatPanel({
  spaceId,
  spaceName,
  chips,
  integrations,
  presetSources,
  presetName,
  initialMessages = [],
}: {
  spaceId: string;
  spaceName: string;
  chips: ChipData[];
  integrations: string[];
  presetSources: PresetSources;
  presetName?: string | null;
  initialMessages?: Msg[];
}) {
  const confirm = useConfirm();
  const [selection, setSelection] = useState<Selection>(() =>
    defaultSelection(spaceId, chips, integrations, presetSources)
  );
  // "Whole space" = vector-search every meeting transcript + note in the
  // space. Off = only the picked sources/tags (plus recent space summaries,
  // which always ride along for continuity).
  const [wholeSpace, setWholeSpace] = useState(true);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendIconRef = useRef<AnimatedIconHandle | null>(null);

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
          selection: { ...selection, space_id: spaceId, space_wide: wholeSpace },
          space_id: spaceId,
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

  async function clearChat() {
    if (streaming || clearing || messages.length === 0) return;
    const ok = await confirm({
      title: "Clear this chat?",
      message: (
        <>
          Delete the conversation history for{" "}
          <span className="font-medium text-ink">{spaceName}</span>? This
          can&rsquo;t be undone.
        </>
      ),
      confirmLabel: "Clear chat",
    });
    if (!ok) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/chat`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      setMessages([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setWholeSpace((w) => !w)}
          title="Search every meeting transcript and note in this space"
          className={[
            "inline-flex items-center gap-[6px] rounded-[8px] border px-[12px] py-[7px] cursor-pointer transition-colors",
            wholeSpace
              ? "border-cortex bg-cortex-tint text-cortex-ink"
              : "border-mist bg-bone-2 text-slate-2 hover:bg-paper-2",
          ].join(" ")}
        >
          <Layers size={13} strokeWidth={1.7} />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
            Whole space
          </span>
        </button>
        <ContextSelector
          selection={selection}
          setSelection={setSelection}
          chips={chips}
          integrations={integrations}
          githubConnected={integrations.includes("github")}
          presetName={presetName ?? null}
        />
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            disabled={streaming || clearing}
            title="Clear chat history"
            className="ml-auto inline-flex items-center gap-[5px] rounded-[8px] border border-mist bg-bone-2 px-[10px] py-[7px] font-mono text-[11px] uppercase tracking-[0.08em] text-slate-2 hover:text-ink hover:bg-paper-2 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={12} strokeWidth={1.7} />
            Clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-bone-2 border border-mist rounded-[10px] p-[14px] flex flex-col gap-[14px]"
      >
        {messages.length === 0 ? (
          <p className="text-[13px] text-slate m-0">
            Ask anything about{" "}
            <span className="font-medium text-ink-2">{spaceName}</span> — every
            meeting, note, and source in this space is searchable. Narrow the
            scope with the context picker, or leave it and I&rsquo;ll go
            through everything here.
          </p>
        ) : (
          messages.map((m, i) => (
            <ChatMsg
              key={i}
              msg={m}
              streaming={streaming && i === messages.length - 1}
            />
          ))
        )}
      </div>

      {error && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
          {error}
        </p>
      )}

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
          placeholder={`Ask about ${spaceName}…`}
          className="flex-1 resize-none rounded-[6px] border border-mist bg-bone-2 text-[13px] leading-[1.5] text-ink px-3 py-[9px] outline-none"
        />
        <Button
          variant="primary"
          onClick={send}
          disabled={streaming || !input.trim()}
          className="self-stretch"
          onMouseEnter={() => sendIconRef.current?.startAnimation()}
          onMouseLeave={() => sendIconRef.current?.stopAnimation()}
          rightIcon={<SendIcon ref={sendIconRef} size={14} strokeWidth={1.6} />}
        >
          {streaming ? "…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function ChatMsg({ msg, streaming }: { msg: Msg; streaming: boolean }) {
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
          <AssistantMarkdown content={msg.content} />
        )}
        {!msg.content && streaming && "…"}
        {streaming && msg.content && (
          <span className="inline-block w-[7px] h-[14px] bg-cortex ml-[3px] align-[-3px] [animation:mb-blink_1s_steps(2)_infinite]" />
        )}
      </div>
    </div>
  );
}
