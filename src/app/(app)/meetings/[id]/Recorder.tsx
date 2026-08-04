"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createClient as createDg,
  LiveTranscriptionEvents,
  type LiveClient,
} from "@deepgram/sdk";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Popover } from "@/components/ui/Popover";
import { Input } from "@/components/ui/Input";

type SpeakerNames = Record<string, string>;

type StoredLine = {
  id: string;
  speaker: string | null;
  content: string;
  created_at: string;
};

const TARGET_SAMPLE_RATE = 16000;

// ----- Automatic audio processing ------------------------------------------
// Nobody should have to know what "echo cancellation" means — the right
// setting is derivable from where audio is playing:
//  - Speakers: the other participants' voices reach the mic as room bleed,
//    and that bleed IS our only signal for their side of the call. Echo
//    cancellation would classify exactly that as echo and delete it, and
//    noise suppression eats quiet far-field speech — so both stay off.
//    Deepgram copes with noise far better than with missing audio.
//  - Headphones: nothing from the call can reach the mic, so there is no
//    bleed to preserve — noise suppression safely cleans the user's channel.
// Output labels are only readable once mic permission exists; when unknown we
// default to raw capture, the failure mode that never loses speech.
const HEADPHONE_HINT =
  /headphone|headset|airpod|ear ?pod|earbud|ear ?buds|wh-?1000|wf-?1000|arctis|hyperx|jabra|plantronics/i;

async function usingHeadphones(): Promise<boolean> {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const outs = list.filter((d) => d.kind === "audiooutput");
    const def = outs.find((d) => d.deviceId === "default") ?? outs[0];
    return !!def && HEADPHONE_HINT.test(def.label);
  } catch {
    return false;
  }
}

function downsampleFloat32(
  input: Float32Array,
  inputRate: number,
  targetRate: number
): Float32Array {
  if (targetRate >= inputRate) return input;
  const ratio = inputRate / targetRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let i = 0;
  let o = 0;
  while (o < outLen) {
    const next = Math.floor((o + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (; i < next && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    out[o++] = count > 0 ? sum / count : 0;
  }
  return out;
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

const SPEAKER_COLOR = ["text-cortex-ink", "text-echo-ink", "text-amber-ink"];
function speakerIndex(speaker: string | null): number {
  if (!speaker) return 0;
  const m = speaker.match(/\d+/);
  return m ? parseInt(m[0], 10) % 3 : 0;
}

// Tiny in-button level meter driven by the live mic signal. `levelRef` carries
// the most recent chunk peak (0..1); each frame we smooth it (fast attack /
// slow release, like a VU meter) and drive a small equalizer: center bars run
// taller and a per-bar time wobble keeps it shimmering while someone speaks.
const MINI_BARS = 5;
const MINI_MAX_PX = 14;
const MINI_BASE_PX = 2;

function MiniWaveform({
  active,
  levelRef,
  barClassName = "bg-white",
}: {
  active: boolean;
  levelRef: { current: number };
  barClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const displayRef = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const tick = () => {
      // Perceptual curve so quiet speech is still visible; sqrt ≈ loudness.
      const target = active
        ? Math.min(1, Math.sqrt(Math.max(0, levelRef.current)) * 1.4)
        : 0;
      const d = displayRef.current;
      const k = target > d ? 0.5 : 0.14;
      displayRef.current = d + (target - d) * k;

      const lvl = displayRef.current;
      const t = performance.now() / 140;
      const mid = (MINI_BARS - 1) / 2;
      const bars = node.children;
      for (let i = 0; i < bars.length; i++) {
        const center = 1 - Math.abs(i - mid) / mid; // 1 at center, 0 at edges
        const wobble = 0.6 + 0.4 * Math.sin(t + i * 1.7);
        const h =
          MINI_BASE_PX +
          lvl * (MINI_MAX_PX - MINI_BASE_PX) * (0.45 + 0.55 * center) * wobble;
        (bars[i] as HTMLElement).style.height = `${h}px`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active, levelRef]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="inline-flex h-[14px] items-center gap-[2px]"
    >
      {Array.from({ length: MINI_BARS }).map((_, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-[1px] ${barClassName}`}
          style={{ height: `${MINI_BASE_PX}px` }}
        />
      ))}
    </span>
  );
}

// A transcript speaker label that opens a rename popover on click. The raw
// diarization label ("Speaker 0", "Unknown") is the stable key; `displayName`
// is the resolved name (or the raw label when no override exists).
function SpeakerLabel({
  rawKey,
  displayName,
  colorClass,
  onSave,
}: {
  rawKey: string;
  displayName: string;
  colorClass: string;
  onSave: (rawKey: string, value: string) => void;
}) {
  const named = displayName !== rawKey;
  return (
    <Popover
      align="start"
      width={224}
      trigger={
        <button
          type="button"
          title="Rename speaker"
          className={[
            "cursor-pointer break-words text-right font-mono text-[11px] uppercase tracking-[0.06em] decoration-dotted underline-offset-2 hover:underline",
            colorClass,
          ].join(" ")}
        >
          {displayName}
        </button>
      }
    >
      {(close) => (
        <RenameSpeakerForm
          rawKey={rawKey}
          initial={named ? displayName : ""}
          onSave={(value) => {
            onSave(rawKey, value);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function RenameSpeakerForm({
  rawKey,
  initial,
  onSave,
}: {
  rawKey: string;
  initial: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2">
        Rename {rawKey}
      </p>
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. Laszlo"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(draft.trim());
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onSave(draft.trim())}>
          Save
        </Button>
        {initial && (
          <Button size="sm" variant="ghost" onClick={() => onSave("")}>
            Clear
          </Button>
        )}
      </div>
      <p className="m-0 text-[11px] leading-[1.4] text-slate-2">
        Applies to every “{rawKey}” line in this meeting.
      </p>
    </div>
  );
}

export function Recorder({
  meetingId,
  initialLines,
  initialSpeakerNames = {},
  initialSummaryStatus = null,
}: {
  meetingId: string;
  initialLines: StoredLine[];
  initialSpeakerNames?: SpeakerNames;
  // meetings.summary_status at render time — 'generating' means a server-side
  // run is already in flight (e.g. the user left mid-generation and came back).
  initialSummaryStatus?: string | null;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredLine[]>(initialLines);
  // Per-meeting overrides mapping a raw diarization label ("Speaker 0",
  // "Unknown") to a name the user attached. Applied at display time so the
  // raw labels stay intact and new live lines pick up the name automatically.
  const [speakerNames, setSpeakerNames] = useState<SpeakerNames>(initialSpeakerNames);

  function displaySpeaker(raw: string | null): string {
    const key = raw || "Unknown";
    return speakerNames[key] ?? key;
  }

  function saveSpeakerName(rawKey: string, value: string) {
    const next = { ...speakerNames };
    if (value) next[rawKey] = value;
    else delete next[rawKey];
    setSpeakerNames(next);
    fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker_names: next }),
    }).catch(() => {});
  }
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  // Devicechange listener that re-tunes the live track's processing when the
  // output route changes mid-recording (e.g. AirPods connect). Held in a ref
  // so teardownAudio can unregister it.
  const retuneRef = useRef<(() => void) | null>(null);
  const [summaryState, setSummaryState] = useState<"idle" | "generating" | "error">(
    initialSummaryStatus === "generating"
      ? "generating"
      : initialSummaryStatus === "error"
        ? "error"
        : "idle"
  );
  const router = useRouter();
  const connRef = useRef<LiveClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Most recent chunk peak amplitude (0..1), read by the Waveform each frame.
  const levelRef = useRef(0);
  // Track the most recent transcript line for dedup. Deepgram sometimes emits
  // the same finalized segment twice, and any duplicated audio pipeline
  // (Strict Mode, second tab, Fast Refresh during recording) will also push
  // the same text through. Drop it client-side and rely on the server's
  // identical guard as a backstop.
  const lastTranscriptRef = useRef<{ key: string; ts: number } | null>(null);
  const wellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (wellRef.current) wellRef.current.scrollTop = wellRef.current.scrollHeight;
  }, [stored]);

  // Resizable transcript well — default fits roughly 4 transcript lines.
  // Drag the handle ABOVE the well to grow/shrink. Persisted per-user.
  const TRANSCRIPT_HEIGHT_KEY = "mb_transcript_well_height";
  const TRANSCRIPT_DEFAULT_HEIGHT = 280;
  const TRANSCRIPT_MIN_HEIGHT = 120;
  const TRANSCRIPT_MAX_HEIGHT = 1400;
  const [transcriptHeight, setTranscriptHeight] = useState<number>(
    TRANSCRIPT_DEFAULT_HEIGHT
  );
  const transcriptHeightRef = useRef(transcriptHeight);
  useEffect(() => {
    transcriptHeightRef.current = transcriptHeight;
  }, [transcriptHeight]);
  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window === "undefined") return;
      const saved = window.localStorage.getItem(TRANSCRIPT_HEIGHT_KEY);
      if (!saved) return;
      const n = parseInt(saved, 10);
      if (
        Number.isFinite(n) &&
        n >= TRANSCRIPT_MIN_HEIGHT &&
        n <= TRANSCRIPT_MAX_HEIGHT
      ) {
        setTranscriptHeight(n);
      }
    });
  }, []);

  function startTranscriptResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = transcriptHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      // Pull DOWN on the handle (which sits above the well) → grow the well.
      const next = Math.max(
        TRANSCRIPT_MIN_HEIGHT,
        Math.min(TRANSCRIPT_MAX_HEIGHT, startH + (ev.clientY - startY))
      );
      setTranscriptHeight(next);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(
          TRANSCRIPT_HEIGHT_KEY,
          String(transcriptHeightRef.current)
        );
      } catch {
        // localStorage can throw in private mode — non-fatal.
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Restore last-chosen device + load the device list. Labels are blank until
  // the user has granted mic permission at least once; we re-enumerate after
  // start() succeeds to pick those up.
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem("mb_audio_input_device") ?? ""
        : "";
    // Hydration-safe: the initial render uses the default empty string so SSR
    // and the first client render agree, then we overwrite once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceId(saved);

    async function refresh() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    }
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  function chooseDevice(id: string) {
    setDeviceId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("mb_audio_input_device", id);
    }
  }

  async function start() {
    setError(null);
    try {
      const res = await fetch("/api/deepgram/token");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not get Deepgram token");
      }
      const { key } = await res.json();

      const dg = createDg(key);
      const conn = dg.listen.live({
        model: "nova-2",
        language: "en-US",
        encoding: "linear16",
        sample_rate: TARGET_SAMPLE_RATE,
        smart_format: true,
        interim_results: false,
        // Separate speakers so each line is tagged Speaker 0/1/2 instead of
        // collapsing into one "Unknown" bucket. Labels are per-session.
        diarize: true,
      });
      connRef.current = conn;

      conn.on(LiveTranscriptionEvents.Open, async () => {
        let stream: MediaStream;
        try {
          const headphones = await usingHeadphones();
          const constraints: MediaTrackConstraints = {
            echoCancellation: false,
            noiseSuppression: headphones,
            autoGainControl: true,
            channelCount: 1,
          };
          if (deviceId) constraints.deviceId = { exact: deviceId };
          stream = await navigator.mediaDevices.getUserMedia({
            audio: constraints,
          });
          // Permission may have been granted just now — re-enumerate so
          // labels (which were blank pre-permission) populate the picker.
          navigator.mediaDevices
            .enumerateDevices()
            .then((list) =>
              setDevices(list.filter((d) => d.kind === "audioinput"))
            )
            .catch(() => {});
        } catch {
          setError("Microphone permission denied. Allow access and try again.");
          conn.finish();
          setRecording(false);
          return;
        }
        streamRef.current = stream;

        // Headphones plugged in / pulled out mid-recording → re-tune the live
        // track instead of making the user stop and restart.
        const retune = () => {
          void usingHeadphones().then((hp) => {
            streamRef.current
              ?.getAudioTracks()[0]
              ?.applyConstraints({ noiseSuppression: hp })
              .catch(() => {});
          });
        };
        retuneRef.current = retune;
        navigator.mediaDevices?.addEventListener?.("devicechange", retune);

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;
        // ScriptProcessorNode is deprecated in favour of AudioWorklet but
        // ships in every current browser and avoids a separate worklet file
        // for a v1 prototype. Buffer of 4096 gives ~85ms latency at 48kHz.
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (conn.getReadyState() !== 1) return;
          const channel = ev.inputBuffer.getChannelData(0);
          // Peak amplitude of this chunk — drives the live waveform meter.
          let p = 0;
          for (let i = 0; i < channel.length; i++) {
            const a = channel[i] < 0 ? -channel[i] : channel[i];
            if (a > p) p = a;
          }
          levelRef.current = p;

          const downsampled = downsampleFloat32(
            channel,
            audioCtx.sampleRate,
            TARGET_SAMPLE_RATE
          );
          const pcm = floatTo16BitPCM(downsampled);
          conn.send(pcm);
        };

        source.connect(processor);
        // ScriptProcessor only fires onaudioprocess if it's connected to a
        // destination — pipe through a zero-gain node so we don't echo audio.
        const sink = audioCtx.createGain();
        sink.gain.value = 0;
        processor.connect(sink);
        sink.connect(audioCtx.destination);
      });

      conn.on(LiveTranscriptionEvents.Transcript, (data: {
        channel?: {
          alternatives?: {
            transcript?: string;
            words?: { speaker?: number }[];
          }[];
        };
      }) => {
        const alt = data.channel?.alternatives?.[0];
        const transcript = alt?.transcript;
        if (!transcript) return;
        const sp = alt?.words?.[0]?.speaker;
        const speaker = sp !== undefined ? `Speaker ${sp}` : "Unknown";

        const key = `${speaker}${transcript}`;
        const now = Date.now();
        const last = lastTranscriptRef.current;
        if (last && last.key === key && now - last.ts < 5_000) {
          // Deepgram double-fire (or a second pipeline running) — server has
          // the same dedup window so the row already exists. Skip silently.
          return;
        }
        lastTranscriptRef.current = { key, ts: now };

        fetch(`/api/meetings/${meetingId}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speaker, text: transcript }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (!j.ok || j.deduped) return;
            setStored((prev) => {
              // Belt-and-braces: if we already have this row id (or an
              // identical content+speaker within the last few seconds),
              // don't append again.
              if (prev.some((p) => p.id === j.id)) return prev;
              const cutoff = Date.now() - 5_000;
              const recentDup = prev
                .slice(-3)
                .some(
                  (p) =>
                    p.content === transcript &&
                    p.speaker === speaker &&
                    new Date(p.created_at).getTime() > cutoff
                );
              if (recentDup) return prev;
              return [
                ...prev,
                {
                  id: j.id,
                  speaker,
                  content: transcript,
                  created_at: new Date().toISOString(),
                },
              ];
            });
          })
          .catch((e) => console.error("transcript persist failed:", e));
      });

      conn.on(LiveTranscriptionEvents.Error, (e: unknown) => {
        const detail: Record<string, unknown> = {};
        if (e && typeof e === "object") {
          for (const k of ["type", "message", "code", "reason", "name", "error", "wasClean"]) {
            const v = (e as Record<string, unknown>)[k];
            if (v !== undefined) detail[k] = v;
          }
        }
        const msg =
          (detail.message as string | undefined) ||
          (detail.reason as string | undefined) ||
          (detail.code !== undefined ? `code=${detail.code}` : null) ||
          "Transcription error.";
        setError(`Deepgram: ${msg} — stop and start again to reconnect.`);
      });

      setRecording(true);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to start recording.");
    }
  }

  function teardownAudio() {
    if (retuneRef.current) {
      navigator.mediaDevices?.removeEventListener?.("devicechange", retuneRef.current);
      retuneRef.current = null;
    }
    levelRef.current = 0;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
  }

  // The two "meeting is over" requests. Summary generation runs server-side
  // (the POST returns 202 immediately), and `keepalive` lets both requests
  // survive navigation or the window closing — so leaving the meeting can't
  // orphan the notes.
  function requestSummary(): Promise<Response> {
    fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ended_at: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
    return fetch(`/api/meetings/${meetingId}/summary`, {
      method: "POST",
      keepalive: true,
    });
  }

  function stop() {
    teardownAudio();
    connRef.current?.finish();
    setRecording(false);
    setSummaryState("generating");
    requestSummary()
      .then((res) => {
        // 202 = generation started server-side; the poll effect below picks
        // up the outcome. Anything else is an immediate failure.
        if (!res.ok) setSummaryState("error");
      })
      .catch(() => setSummaryState("error"));
  }

  // While a server-side generation is in flight, poll for the outcome; when
  // the summary lands, refresh so the page swaps to the summary view.
  useEffect(() => {
    if (summaryState !== "generating") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/summary`);
        if (!res.ok) return;
        const j = await res.json();
        if (j.status === "error") {
          setSummaryState("error");
        } else if (!j.status && j.hasSummary) {
          setSummaryState("idle");
          router.refresh();
        }
      } catch {
        // transient network failure — keep polling
      }
    }, 4000);
    return () => clearInterval(t);
  }, [summaryState, meetingId, router]);

  // Auto-start recording when we arrive from the desktop "Meeting Detected"
  // popup — the quick-start route redirects here with `?record=1`. Runs once,
  // and strips the flag so a refresh doesn't kick off another recording.
  // (Restored: this shipped in eedf2e6 and was accidentally reverted by the
  // agent-chat working-copy commit 1612b4a.)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("record") !== "1") return;
    autoStartedRef.current = true;
    window.history.replaceState(null, "", `/meetings/${meetingId}`);
    // Defer out of the effect body so the synchronous setState inside start()
    // doesn't trip the cascading-render rule, and the page can paint first.
    queueMicrotask(() => void start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // Mirror `recording` into a ref so the unmount cleanup below sees the
  // current value without re-registering.
  const recordingRef = useRef(false);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => () => {
    // Backing out of the meeting mid-recording must not orphan it: end the
    // meeting and kick off server-side notes exactly like pressing Stop —
    // the keepalive requests outlive this component (and the window).
    if (recordingRef.current) {
      recordingRef.current = false;
      requestSummary().catch(() => {});
    }
    teardownAudio();
    connRef.current?.finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate">
        {recording ? (
          <Button
            variant="danger"
            size="md"
            onClick={stop}
            aria-label="Stop recording"
            title="Stop recording"
            leftIcon={<Square size={12} strokeWidth={0} fill="currentColor" />}
            rightIcon={<MiniWaveform active levelRef={levelRef} />}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="ink"
            size="md"
            onClick={start}
            aria-label="Start recording"
            title="Start recording"
            leftIcon={<Mic size={14} strokeWidth={1.6} />}
          >
            Record
          </Button>
        )}

        <label className="flex items-center gap-2">
          <span className="uppercase tracking-[0.06em]">Input</span>
          <Select
            size="sm"
            aria-label="Input device"
            className="font-mono text-[11px] max-w-[280px]"
            value={deviceId}
            onChange={chooseDevice}
            disabled={recording}
            options={[
              { value: "", label: "System default" },
              ...devices.map((d, i) => ({
                value: d.deviceId,
                label:
                  d.label || `Microphone ${i + 1} (grant permission to see name)`,
              })),
            ]}
          />
        </label>
      </div>

      {error && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
          {error}
        </p>
      )}

      {summaryState === "generating" && (
        <p className="rounded-[6px] border border-mist bg-bone-2 px-3 py-2 text-[12.5px] text-slate-2 flex items-center gap-2">
          <span className="w-[6px] h-[6px] rounded-full bg-cortex [animation:mb-pulse_1.4s_infinite]" />
          Generating summary with Claude Opus — this can take 30-60 seconds.
        </p>
      )}
      {summaryState === "error" && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
          Summary failed. You can retry later from this page.
        </p>
      )}

      <div
        ref={wellRef}
        style={{ height: transcriptHeight }}
        className="bg-bone-2 border border-mist rounded-[10px] px-[18px] py-[14px] flex flex-col gap-3 overflow-y-auto"
      >
        {stored.length === 0 ? (
          <p className="text-[13px] text-slate m-0">
            Transcript will appear here once recording starts.
          </p>
        ) : (
          (() => {
            const VISIBLE = 10;
            const older = stored.length > VISIBLE ? stored.slice(0, -VISIBLE) : [];
            const recent = stored.slice(-VISIBLE);
            const renderLine = (l: StoredLine) => {
              const idx = speakerIndex(l.speaker);
              return (
                <div
                  key={l.id}
                  className="grid items-baseline gap-[14px]"
                  style={{ gridTemplateColumns: "74px 1fr" }}
                >
                  <div className="flex justify-end pt-[3px]">
                    <SpeakerLabel
                      rawKey={l.speaker || "Unknown"}
                      displayName={displaySpeaker(l.speaker)}
                      colorClass={SPEAKER_COLOR[idx]}
                      onSave={saveSpeakerName}
                    />
                  </div>
                  <div className="text-[14px] leading-[1.55] text-ink">
                    <span className="font-mono text-[10.5px] text-slate-3 mr-2">
                      {new Date(l.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: false,
                      })}
                    </span>
                    {l.content}
                  </div>
                </div>
              );
            };
            return (
              <>
                {older.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer select-none list-none font-mono text-[10.5px] uppercase tracking-[0.07em] text-slate-2 hover:text-ink py-1">
                      <span className="group-open:hidden">
                        Show {older.length} earlier line{older.length === 1 ? "" : "s"} ↓
                      </span>
                      <span className="hidden group-open:inline">
                        Hide earlier lines ↑
                      </span>
                    </summary>
                    <div className="flex flex-col gap-3 pt-2 pb-1 opacity-80">
                      {older.map(renderLine)}
                    </div>
                  </details>
                )}
                {recent.map(renderLine)}
              </>
            );
          })()
        )}
      </div>

      {/* Drag down to grow the transcript, up to shrink. Persists per-user. */}
      <div
        onMouseDown={startTranscriptResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize transcript"
        className="group h-[8px] -mt-[2px] cursor-ns-resize flex items-center justify-center"
      >
        <div className="h-[3px] w-[36px] rounded-full bg-mist-2 group-hover:bg-cortex transition-colors" />
      </div>
    </div>
  );
}
