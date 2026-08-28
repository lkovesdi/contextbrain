"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";
import { getAuthUser } from "@/lib/supabase/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  AttachControls,
  AttachmentTray,
  MessageAttachments,
  toRequestAttachments,
  useChatAttachments,
  type ChatAttachment,
} from "@/components/chat/attachments";
import { LogoMark } from "@/components/ui/Logo";
import { Eyebrow } from "@/components/ui/typography";

type Line = {
  id: string;
  speaker: string | null;
  content: string;
  created_at: string;
};
type Note = { id: string; content: string; is_checked: boolean };
type Meeting = {
  title: string;
  summary_title: string | null;
  started_at: string | null;
  ended_at: string | null;
  speaker_names: Record<string, string> | null;
};
type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

type Phase = "checking" | "join" | "ready" | "error";

export default function GuestMeetingPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const meetingId = params.id;
  const token = search.get("t") ?? "";
  const supabase = useMemo(() => createClient(), []);

  const [phase, setPhase] = useState<Phase>("checking");
  const [fatal, setFatal] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  const loadView = useCallback(async () => {
    const [{ data: m }, { data: t }, { data: n }] = await Promise.all([
      supabase
        .from("meetings")
        .select("title,summary_title,started_at,ended_at,speaker_names")
        .eq("id", meetingId)
        .single(),
      supabase
        .from("transcripts")
        .select("id,speaker,content,created_at")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true }),
      supabase
        .from("notes")
        .select("id,content,is_checked")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true }),
    ]);
    if (!m) {
      setFatal("You don't have access to this meeting.");
      setPhase("error");
      return;
    }
    setMeeting(m as Meeting);
    setLines((t ?? []) as Line[]);
    setNotes((n ?? []) as Note[]);
    setPhase("ready");
  }, [supabase, meetingId]);

  // On mount: if this browser already joined (anonymous session + participant
  // row), skip the form. Otherwise show the join form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: participant } = await supabase
        .from("meeting_participants")
        .select("name")
        .eq("meeting_id", meetingId)
        .maybeSingle();
      if (cancelled) return;
      if (participant) {
        await loadView();
      } else {
        setPhase("join");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, meetingId, loadView]);

  // Live transcript via Realtime once we're in.
  useEffect(() => {
    if (phase !== "ready") return;
    const channel = supabase
      .channel(`guest-transcripts-${meetingId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transcripts",
          filter: `meeting_id=eq.${meetingId}`,
        },
        (payload) => {
          const row = payload.new as Line;
          setLines((prev) =>
            prev.some((l) => l.id === row.id) ? prev : [...prev, row]
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meetingId, phase]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const sessionUser = await getAuthUser(supabase);
      if (!sessionUser) {
        const { error: anonErr } = await supabase.auth.signInAnonymously();
        if (anonErr) {
          setJoinError(
            "Guest access isn't enabled for this workspace yet."
          );
          setJoining(false);
          return;
        }
      }
      const { error: joinErr } = await supabase.rpc("join_meeting_by_token", {
        p_token: token,
        p_name: name.trim(),
        p_email: email.trim(),
      });
      if (joinErr) {
        setJoinError(joinErr.message || "Couldn't join this meeting.");
        setJoining(false);
        return;
      }
      await loadView();
    } catch {
      setJoinError("Something went wrong. Please try again.");
    } finally {
      setJoining(false);
    }
  }

  const displaySpeaker = (raw: string | null) => {
    const key = raw || "Unknown";
    return meeting?.speaker_names?.[key] ?? key;
  };

  if (phase === "checking") {
    return (
      <Centered>
        <p className="font-mono text-[12px] uppercase tracking-[0.07em] text-slate-2">
          Loading…
        </p>
      </Centered>
    );
  }

  if (phase === "error") {
    return (
      <Centered>
        <div className="flex max-w-[360px] flex-col items-center gap-2 text-center">
          <LogoMark size={28} />
          <p className="text-[15px] text-ink">{fatal}</p>
        </div>
      </Centered>
    );
  }

  if (phase === "join") {
    const invalidLink = !token;
    return (
      <Centered>
        <div className="flex w-full max-w-[380px] flex-col gap-6">
          <div className="flex items-center gap-[10px]">
            <LogoMark size={26} />
            <span className="font-display text-[24px] leading-none tracking-[-0.015em] text-ink">
              ContextBrain
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-display text-[28px] leading-[1.1] tracking-[-0.015em] text-ink">
              Join the meeting
            </h1>
            <p className="m-0 text-[14px] text-slate">
              Enter your name to follow along live. Add an email and we&apos;ll
              send you the summary afterward.
            </p>
          </div>
          {invalidLink ? (
            <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
              This invite link is missing its access token. Ask the host for a
              fresh link.
            </p>
          ) : (
            <form onSubmit={join} className="flex flex-col gap-4">
              <Input
                label="Your name"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
              <Input
                label="Email (optional)"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                hint="We'll email you the summary after the meeting."
              />
              {joinError && (
                <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
                  {joinError}
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={joining || !name.trim()}
                className="w-full justify-center"
              >
                {joining ? "Joining…" : "Join meeting"}
              </Button>
            </form>
          )}
        </div>
      </Centered>
    );
  }

  // phase === "ready"
  const ended = !!meeting?.ended_at;
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex items-center justify-between gap-4 border-b border-mist bg-bone-2 px-[22px] py-[14px]">
        <div className="flex min-w-0 items-center gap-[10px]">
          <LogoMark size={22} />
          <span className="truncate font-display text-[18px] leading-none tracking-[-0.01em] text-ink">
            {meeting?.summary_title || meeting?.title || "Meeting"}
          </span>
        </div>
        {ended ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate">
            Ended
          </span>
        ) : (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11px] uppercase tracking-[0.08em] text-pulse">
            <span className="h-[6px] w-[6px] rounded-full bg-pulse [animation:mb-pulse_1.4s_infinite]" />
            Live
          </span>
        )}
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1.3fr_1fr]">
        <section className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-mist p-[22px] lg:border-b-0 lg:border-r">
          <div>
            <Eyebrow className="mb-[12px]">Transcript</Eyebrow>
            <TranscriptList lines={lines} displaySpeaker={displaySpeaker} />
          </div>
          {notes.length > 0 && (
            <div>
              <Eyebrow className="mb-[12px]">Notes</Eyebrow>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-start gap-2 text-[14px] leading-[1.55] text-ink"
                  >
                    <span className="mt-[7px] h-[5px] w-[5px] flex-shrink-0 rounded-full bg-cortex" />
                    <span className={n.is_checked ? "line-through text-slate" : ""}>
                      {n.content}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-col p-[22px]">
          <Eyebrow className="mb-[12px]">Ask about this meeting</Eyebrow>
          <GuestChat meetingId={meetingId} />
        </section>
      </div>
    </div>
  );
}

function TranscriptList({
  lines,
  displaySpeaker,
}: {
  lines: Line[];
  displaySpeaker: (raw: string | null) => string;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  if (lines.length === 0) {
    return (
      <p className="m-0 text-[13px] text-slate">
        Waiting for the conversation to start…
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l) => (
        <div
          key={l.id}
          className="grid items-baseline gap-[14px]"
          style={{ gridTemplateColumns: "84px 1fr" }}
        >
          <div className="break-words text-right font-mono text-[11px] uppercase tracking-[0.06em] text-cortex-ink">
            {displaySpeaker(l.speaker)}
          </div>
          <div className="text-[14px] leading-[1.55] text-ink">{l.content}</div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function GuestChat({ meetingId }: { meetingId: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const att = useChatAttachments();

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  async function send() {
    const content = input.trim();
    const attachments = att.attachments;
    if ((!content && attachments.length === 0) || streaming) return;
    setInput("");
    att.clear();
    setError(null);
    const next: ChatMsg[] = [...messages, { role: "user", content, attachments }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({
            role: m.role,
            content: m.content,
            attachments: toRequestAttachments(m.attachments),
          })),
          meeting_id: meetingId,
        }),
      });
      if (!res.ok || !res.body) {
        setError(
          res.status === 403
            ? "Your access to this meeting has ended."
            : "Couldn't get an answer. Try again."
        );
        setMessages((m) => m.slice(0, -1));
        return;
      }
      const reader = res.body.getReader();
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
    } catch {
      setError("Couldn't get an answer. Try again.");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto rounded-[10px] border border-mist bg-bone-2 p-[14px]"
      >
        {messages.length === 0 ? (
          <p className="m-0 text-[13px] text-slate">
            Ask anything about what&apos;s being discussed or the context the
            host attached.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-[5px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
                {m.role === "user" ? "You" : "ContextBrain"}
              </div>
              <div className="text-[14px] leading-[1.6] text-ink">
                {m.role === "user" ? (
                  <>
                    <MessageAttachments attachments={m.attachments} />
                    {m.content && (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-2 [&_a]:text-cortex [&_a]:underline [&_li]:ml-4 [&_ul]:list-disc">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content || (streaming ? "…" : "")}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {error && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
          {error}
        </p>
      )}
      <div
        className="flex flex-col gap-2"
        onDrop={att.onDrop}
        onDragOver={att.onDragOver}
      >
        <AttachmentTray
          attachments={att.attachments}
          onRemove={att.remove}
          busy={att.busy}
          error={att.error}
          recording={att.recording}
        />
        <div className="flex items-stretch gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={att.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask…"
            className="flex-1 resize-none rounded-[6px] border border-mist bg-bone-2 px-3 py-[9px] text-[13px] leading-[1.5] text-ink outline-none"
          />
          <div className="flex items-center gap-[6px]">
            <AttachControls
              onCapture={att.capture}
              onRecord={att.startRecording}
              onStopRecording={att.stopRecording}
              recording={att.recording}
              onFiles={(files) => void att.addBlobs(files)}
              busy={att.busy}
              disabled={streaming}
            />
          </div>
          <Button
            variant="primary"
            onClick={send}
            disabled={streaming || (!input.trim() && att.attachments.length === 0)}
            className="self-stretch"
          >
            {streaming ? "…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      {children}
    </div>
  );
}
