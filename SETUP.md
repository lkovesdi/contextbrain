# ContextBrain — manual setup checklist

The agent has implemented the codebase. Before `npm run dev` will actually serve pages, you must complete these external steps. Order matters where noted.

## 1. Fill in `.env.local`

Copy `.env.example` to `.env.local` and populate every key.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # starts with sb_publishable_…
SUPABASE_SECRET_KEY=                    # starts with sb_secret_…  (server-only)
DEEPGRAM_API_KEY=
DEEPGRAM_PROJECT_ID=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
COMPOSIO_API_KEY=
COMPOSIO_GITHUB_AUTH_CONFIG=
COMPOSIO_JIRA_AUTH_CONFIG=
COMPOSIO_FIGMA_AUTH_CONFIG=
```

These are Supabase's **new API keys** (publishable + secret), not the legacy `anon` / `service_role` JWTs. Grab them from your project's **Settings → API Keys** page. Without the URL + publishable key, the proxy throws on every request → 500.

## 2. Supabase project

1. Create a new Supabase project (free tier is fine).
2. Open SQL Editor and paste-and-run the entire SQL block from **PRD §4** (`prd.md`, lines 88–258). This:
   - Enables `vector` + `pgcrypto`
   - Creates `meetings`, `transcripts`, `notes`, `context_presets`, `external_contexts`, `external_chunks`, `integrations`, `chat_messages`
   - Sets RLS policies on all of them
   - Defines `match_transcripts`, `match_notes`, `match_external_chunks` RPC functions
3. **Auth settings → URL Configuration**: add `http://localhost:3000/auth/callback` to **Redirect URLs** (and your production URL when you deploy).
4. **Auth settings → Email**: confirm magic-link email template is enabled.

Acceptance: visit Table Editor → see all 8 tables. Database → Functions → see the three `match_*` functions.

## 3. Deepgram

1. Sign up at deepgram.com, create a project.
2. Generate an API key with **admin** scope (needed to mint ephemeral browser keys).
3. Copy the API key into `DEEPGRAM_API_KEY` and the project ID into `DEEPGRAM_PROJECT_ID`.

## 4. OpenAI

API key with embedding access → `OPENAI_API_KEY`.

## 5. Anthropic

API key from console.anthropic.com → `ANTHROPIC_API_KEY`.

## 6. Composio (per-provider — only needed before Step 10 works)

1. Sign up at composio.dev, get API key → `COMPOSIO_API_KEY`.
2. In the dashboard, create one **Auth Config** each for GitHub, Jira, Figma, then copy their IDs into `COMPOSIO_GITHUB_AUTH_CONFIG`, `COMPOSIO_JIRA_AUTH_CONFIG`, `COMPOSIO_FIGMA_AUTH_CONFIG`.
3. In each provider's OAuth app settings, add `http://localhost:3000/api/integrations/callback` as a redirect URL.

## 7. Capturing system audio on macOS (optional, recommended for meetings)

The browser can only record what the OS hands it on a microphone input. Out of the box, that means your physical mic — fine for in-person meetings, useless for Zoom/Meet calls where you also want the other participants' voices. The workaround is a free virtual audio cable + a macOS aggregate device. ~3 minutes one-time setup; never needed again.

This is what Granola / Otter / Fellow do under the hood as native apps. We get to it from a web app by routing system audio through a virtual input device that the browser sees as a regular mic. (When ContextBrain ships as a Tauri desktop app — PRD §13 — this won't be needed; we'll use `ScreenCaptureKit` directly. Tracked in [BACKLOG.md](BACKLOG.md).)

### Step 1 — Install BlackHole

```bash
brew install blackhole-2ch
```

BlackHole is an open-source virtual audio driver. After install, it shows up in your audio device list as **BlackHole 2ch** — anything routed to it becomes available as a recording source.

### Step 2 — Build the devices in Audio MIDI Setup

Open `/Applications/Utilities/Audio MIDI Setup.app` (Spotlight: "audio midi").

**Multi-Output Device** — so you still hear sound while a copy is fed into BlackHole.

1. Bottom-left **+** → **Create Multi-Output Device**.
2. Check **your normal output** (built-in speakers, headphones, or whatever you actually listen on) **and BlackHole 2ch**.
3. Optional: set **Drift Correction** on BlackHole 2ch (right column) to keep streams aligned.
4. Rename it to something memorable, e.g. "ContextBrain Output".

**Aggregate Device** — your mic + BlackHole, presented to the browser as one input.

1. Bottom-left **+** → **Create Aggregate Device**.
2. Check your **real mic** (e.g. MacBook Pro Microphone) **and BlackHole 2ch**.
3. Set the real mic as **Clock Source** (right column).
4. Rename to "ContextBrain Input".

### Step 3 — Route system output through it

Sound icon in the menu bar (or **System Settings → Sound → Output**) → pick **ContextBrain Output**.

Play any audio; you should still hear it through your real speakers/headphones. A copy is now silently being fed into BlackHole.

### Step 4 — Point ContextBrain at the aggregate input

In a meeting workspace, under the recorder waveform:

- **Input** dropdown → **ContextBrain Input** (the aggregate). Saved to `localStorage` so you only pick it once.
- Uncheck **echo cancel** and **noise suppress**. Both are tuned for human voice on a call — they'll dampen music, TTS, and the other-side audio that's coming in over BlackHole.

Hit Start. Play YouTube or join a Zoom — the `peak` indicator should jump to 0.05–0.5 and transcripts should stream as both you and the other speakers talk. Deepgram's diarization will label them Speaker 0 / Speaker 1.

### Reverting when you're done

When you don't need system audio, just switch **System Settings → Sound → Output** back to your real speakers. The Multi-Output and Aggregate devices stay configured for next time.

## 8. Housekeeping

- There's a stray `/Users/<you>/package-lock.json` in your home directory left over from somewhere. It no longer affects this app (the workspace root is pinned in `next.config.ts`), but you may want to delete it.

## Verification once everything is set

```bash
npm run dev
```

Then:
- `/login` should load and accept your email.
- After clicking the magic link, `/` shows the (empty) meetings dashboard.
- Creating a meeting and hitting **Start recording** should stream transcripts in real time.
