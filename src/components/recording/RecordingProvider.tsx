"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  createClient as createDg,
  LiveTranscriptionEvents,
  type LiveClient,
} from "@deepgram/sdk";
import { RecordingPill } from "./RecordingPill";

// App-level recording engine. Owns the mic stream, the audio graph, and the
// Deepgram connection, so navigating between routes never interrupts a
// recording — the meeting page and the floating pill are both just views on
// this provider. Only an explicit Stop (or the window actually closing) ends
// a meeting.

export type StoredLine = {
  id: string;
  speaker: string | null;
  content: string;
  created_at: string;
};

export type RecordingSession = {
  meetingId: string;
  title: string;
  startedAt: number;
};

type LineListener = (meetingId: string, line: StoredLine) => void;

type RecordingContextValue = {
  session: RecordingSession | null;
  error: string | null;
  levelRef: { current: number };
  start: (opts: {
    meetingId: string;
    title: string;
    deviceId?: string;
  }) => Promise<void>;
  /** Tears down audio, ends the meeting, kicks off the server-side summary.
      Resolves with the summary POST response (ok => generation started). */
  stop: () => Promise<Response | null>;
  subscribeLines: (cb: LineListener) => () => void;
};

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used inside RecordingProvider");
  return ctx;
}

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

// Invoke a Tauri command from the remotely-loaded frontend. No-ops on the
// web; swallows rejections so an old shell (without the command or the
// remote capability) degrades to the in-app pill only.
function tauriInvoke(cmd: string) {
  try {
    const t = (
      window as unknown as {
        __TAURI__?: { core?: { invoke?: (c: string) => Promise<unknown> } };
      }
    ).__TAURI__;
    t?.core?.invoke?.(cmd)?.catch(() => {});
  } catch {
    // not in the desktop shell
  }
}

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const connRef = useRef<LiveClient | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Most recent chunk peak amplitude (0..1), read by waveform meters each frame.
  const levelRef = useRef(0);
  // Devicechange listener that re-tunes the live track's processing when the
  // output route changes mid-recording (e.g. AirPods connect).
  const retuneRef = useRef<(() => void) | null>(null);
  // Deepgram sometimes emits the same finalized segment twice; drop it
  // client-side and rely on the server's identical guard as a backstop.
  const lastTranscriptRef = useRef<{ key: string; ts: number } | null>(null);

  const sessionRef = useRef<RecordingSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const listenersRef = useRef<Set<LineListener>>(new Set());
  const subscribeLines = useCallback((cb: LineListener) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  // ----- Desktop widget bridge (BroadcastChannel, same origin) -------------
  const bcRef = useRef<BroadcastChannel | null>(null);
  const lastLevelPostRef = useRef(0);

  const postWidgetState = useCallback((s: RecordingSession | null) => {
    bcRef.current?.postMessage({ type: "state", session: s });
  }, []);

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
  // survive the window closing — so nothing can orphan the notes.
  const requestSummary = useCallback((meetingId: string): Promise<Response> => {
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
  }, []);

  const stop = useCallback(async (): Promise<Response | null> => {
    const s = sessionRef.current;
    teardownAudio();
    connRef.current?.finish();
    connRef.current = null;
    sessionRef.current = null;
    setSession(null);
    postWidgetState(null);
    tauriInvoke("widget_hide");
    if (!s) return null;
    return requestSummary(s.meetingId);
  }, [postWidgetState, requestSummary]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(
    async ({
      meetingId,
      title,
      deviceId,
    }: {
      meetingId: string;
      title: string;
      deviceId?: string;
    }) => {
      if (sessionRef.current) {
        if (sessionRef.current.meetingId === meetingId) return;
        throw new Error("Another meeting is already recording.");
      }
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
          } catch {
            setError("Microphone permission denied. Allow access and try again.");
            conn.finish();
            connRef.current = null;
            sessionRef.current = null;
            setSession(null);
            postWidgetState(null);
            tauriInvoke("widget_hide");
            return;
          }
          streamRef.current = stream;

          // Headphones plugged in / pulled out mid-recording → re-tune the
          // live track instead of making the user stop and restart.
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
            // Peak amplitude of this chunk — drives the live waveform meters.
            let p = 0;
            for (let i = 0; i < channel.length; i++) {
              const a = channel[i] < 0 ? -channel[i] : channel[i];
              if (a > p) p = a;
            }
            levelRef.current = p;
            // Feed the desktop widget's meter at ~6Hz, not per-chunk.
            const now = Date.now();
            if (now - lastLevelPostRef.current > 160) {
              lastLevelPostRef.current = now;
              bcRef.current?.postMessage({ type: "level", level: p });
            }

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

          const key = `${speaker}${transcript}`;
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
              const line: StoredLine = {
                id: j.id,
                speaker,
                content: transcript,
                created_at: new Date().toISOString(),
              };
              listenersRef.current.forEach((cb) => cb(meetingId, line));
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

        const s: RecordingSession = { meetingId, title, startedAt: Date.now() };
        sessionRef.current = s;
        setSession(s);
        postWidgetState(s);
        tauriInvoke("widget_show");
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : "Failed to start recording.");
        throw e;
      }
    },
    [postWidgetState]
  );

  // Widget bridge: the desktop pill window is a same-origin page, so state
  // flows over BroadcastChannel — no Tauri IPC needed for data.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("cb-recording");
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type?: string } | null;
      if (m?.type === "stop") {
        void stopRef.current();
      } else if (m?.type === "open") {
        const s = sessionRef.current;
        if (s) router.push(`/meetings/${s.meetingId}?continue=1`);
      } else if (m?.type === "hello") {
        // Widget just mounted and wants the current state.
        bc.postMessage({ type: "state", session: sessionRef.current });
      }
    };
    return () => {
      bcRef.current = null;
      bc.close();
    };
  }, [router]);

  // Hooks for the desktop shell: the widget's stop/open buttons go through
  // Rust commands that eval these globals in this window — unlike a
  // BroadcastChannel message, that works even while this window is minimized
  // and its JS would otherwise be suspended.
  useEffect(() => {
    const w = window as unknown as {
      __cbRecordingStop?: () => void;
      __cbRecordingOpen?: () => void;
    };
    w.__cbRecordingStop = () => void stopRef.current();
    w.__cbRecordingOpen = () => {
      const s = sessionRef.current;
      if (s) router.push(`/meetings/${s.meetingId}?continue=1`);
    };
    return () => {
      delete w.__cbRecordingStop;
      delete w.__cbRecordingOpen;
    };
  }, [router]);

  // The window actually closing (refresh, quit) must not orphan the meeting:
  // end it exactly like pressing Stop — keepalive requests outlive the page.
  // SPA route changes never fire pagehide, so navigation keeps recording.
  useEffect(() => {
    const onPageHide = () => {
      const s = sessionRef.current;
      if (!s) return;
      sessionRef.current = null;
      requestSummary(s.meetingId).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [requestSummary]);

  return (
    <RecordingContext.Provider
      value={{ session, error, levelRef, start, stop, subscribeLines }}
    >
      {children}
      <RecordingPill />
    </RecordingContext.Provider>
  );
}
