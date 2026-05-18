"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createClient as createDg,
  LiveTranscriptionEvents,
  type LiveClient,
} from "@deepgram/sdk";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/Button";

type StoredLine = {
  id: string;
  speaker: string | null;
  content: string;
  created_at: string;
};

const TARGET_SAMPLE_RATE = 16000;

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

function Waveform({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const N = 96;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const tick = () => {
      const t = Date.now() / 240;
      const bars = node.children;
      for (let i = 0; i < bars.length; i++) {
        const base =
          Math.sin(i * 0.31 + t * (active ? 1 : 0)) * 0.45 +
          Math.sin(i * 0.083 + t * (active ? 0.6 : 0)) * 0.4 +
          Math.sin(i * 0.21) * 0.15;
        const jitter = active ? (Math.random() - 0.5) * 0.2 : 0;
        const h = Math.max(3, Math.abs(base + jitter) * 38 + 5);
        (bars[i] as HTMLElement).style.height = `${h}px`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div
      ref={ref}
      className="h-[56px] bg-ink rounded-[8px] px-[14px] py-2 flex items-center gap-[2.5px]"
    >
      {Array.from({ length: N }).map((_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1.5px] opacity-[0.78]"
          style={{ background: "linear-gradient(180deg, var(--paper), #fff)" }}
        />
      ))}
    </div>
  );
}

export function Recorder({
  meetingId,
  initialLines,
}: {
  meetingId: string;
  initialLines: StoredLine[];
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredLine[]>(initialLines);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "open" | "closing" | "error"
  >("idle");
  const [chunks, setChunks] = useState(0);
  const [transcripts, setTranscripts] = useState(0);
  const [peak, setPeak] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [echoCancel, setEchoCancel] = useState(true);
  const [noiseSuppress, setNoiseSuppress] = useState(true);
  const [summaryState, setSummaryState] = useState<"idle" | "generating" | "error">(
    "idle"
  );
  const router = useRouter();
  const connRef = useRef<LiveClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunkLog = useRef(0);
  const peakSinceUpdateRef = useRef(0);
  const peakRafRef = useRef<number | null>(null);
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
    setChunks(0);
    setTranscripts(0);
    chunkLog.current = 0;
    setStatus("connecting");
    try {
      const res = await fetch("/api/deepgram/token");
      if (!res.ok) throw new Error("Could not get Deepgram token");
      const { key } = await res.json();

      const dg = createDg(key);
      const conn = dg.listen.live({
        model: "nova-2",
        language: "en-US",
        encoding: "linear16",
        sample_rate: TARGET_SAMPLE_RATE,
        smart_format: true,
        interim_results: false,
      });
      connRef.current = conn;

      conn.on(LiveTranscriptionEvents.Open, async () => {
        setStatus("open");
        let stream: MediaStream;
        try {
          const constraints: MediaTrackConstraints = {
            echoCancellation: echoCancel,
            noiseSuppression: noiseSuppress,
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
          setStatus("error");
          return;
        }
        streamRef.current = stream;

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
          // Peak amplitude of this chunk — surfaced live in the status bar.
          let p = 0;
          for (let i = 0; i < channel.length; i++) {
            const a = channel[i] < 0 ? -channel[i] : channel[i];
            if (a > p) p = a;
          }
          if (p > peakSinceUpdateRef.current) peakSinceUpdateRef.current = p;

          const downsampled = downsampleFloat32(
            channel,
            audioCtx.sampleRate,
            TARGET_SAMPLE_RATE
          );
          const pcm = floatTo16BitPCM(downsampled);
          conn.send(pcm);
          setChunks((c) => c + 1);
          if (chunkLog.current < 3) chunkLog.current += 1;
        };

        // Publish peak to React state ~10×/sec — re-rendering on every chunk
        // (~12×/sec from 4096-sample buffer at 48k) would be wasteful and
        // identical visually anyway.
        const pump = () => {
          setPeak(peakSinceUpdateRef.current);
          peakSinceUpdateRef.current = 0;
          peakRafRef.current = window.setTimeout(pump, 100) as unknown as number;
        };
        pump();

        source.connect(processor);
        // ScriptProcessor only fires onaudioprocess if it's connected to a
        // destination — pipe through a zero-gain node so we don't echo audio.
        const sink = audioCtx.createGain();
        sink.gain.value = 0;
        processor.connect(sink);
        sink.connect(audioCtx.destination);
      });

      conn.on(LiveTranscriptionEvents.Close, () => setStatus("closing"));

      conn.on(LiveTranscriptionEvents.Transcript, (data: {
        channel?: {
          alternatives?: {
            transcript?: string;
            words?: { speaker?: number }[];
          }[];
        };
      }) => {
        setTranscripts((n) => n + 1);
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
        setStatus("error");
      });

      setRecording(true);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to start recording.");
    }
  }

  function teardownAudio() {
    if (peakRafRef.current !== null) {
      clearTimeout(peakRafRef.current);
      peakRafRef.current = null;
    }
    peakSinceUpdateRef.current = 0;
    setPeak(0);
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
  }

  function stop() {
    setStatus("closing");
    teardownAudio();
    connRef.current?.finish();
    setRecording(false);
    setStatus("idle");
    fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ended_at: new Date().toISOString() }),
    }).catch(() => {});

    setSummaryState("generating");
    fetch(`/api/meetings/${meetingId}/summary`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          setSummaryState("error");
          return;
        }
        setSummaryState("idle");
        // Server-rendered meeting page reads summary + summary_title from
        // the row — refresh so the new title and body show up without a
        // hard reload.
        router.refresh();
      })
      .catch(() => setSummaryState("error"));
  }

  useEffect(() => () => {
    teardownAudio();
    connRef.current?.finish();
  }, []);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-[14px] flex-wrap">
        {recording ? (
          <Button variant="danger" onClick={stop}>
            <span className="w-[7px] h-[7px] rounded-full bg-white [animation:mb-pulse_1.4s_infinite]" />
            Stop recording
          </Button>
        ) : (
          <Button
            variant="ink"
            onClick={start}
            leftIcon={<Mic size={14} strokeWidth={1.6} />}
          >
            Start recording
          </Button>
        )}
        <div className="font-mono text-[11px] text-slate flex gap-[12px] ml-auto whitespace-nowrap">
          <span>
            ws · <b className="text-ink font-medium">{status}</b>
          </span>
          <span>
            chunks · <b className="text-ink font-medium">{chunks}</b>
          </span>
          <span>
            events · <b className="text-ink font-medium">{transcripts}</b>
          </span>
          <span>
            peak ·{" "}
            <b
              className={
                peak > 0.02
                  ? "text-emerald-600 font-medium"
                  : peak > 0.001
                  ? "text-ink font-medium"
                  : "text-pulse-ink font-medium"
              }
            >
              {peak.toFixed(3)}
            </b>
          </span>
        </div>
      </div>

      <Waveform active={recording} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-slate">
        <label className="flex items-center gap-2">
          <span className="uppercase tracking-[0.06em]">Input</span>
          <select
            value={deviceId}
            onChange={(e) => chooseDevice(e.target.value)}
            disabled={recording}
            className="bg-bone-2 border border-mist rounded-[4px] px-2 py-[3px] text-ink text-[11px] max-w-[280px] disabled:opacity-50"
          >
            <option value="">System default</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || `dev-${i}`} value={d.deviceId}>
                {d.label || `Microphone ${i + 1} (grant permission to see name)`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={echoCancel}
            onChange={(e) => setEchoCancel(e.target.checked)}
            disabled={recording}
          />
          <span>echo cancel</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={noiseSuppress}
            onChange={(e) => setNoiseSuppress(e.target.checked)}
            disabled={recording}
          />
          <span>noise suppress</span>
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
                  <div
                    className={[
                      "font-mono text-[11px] uppercase tracking-[0.06em] text-right pt-[3px]",
                      SPEAKER_COLOR[idx],
                    ].join(" ")}
                  >
                    {l.speaker || "Unknown"}
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
