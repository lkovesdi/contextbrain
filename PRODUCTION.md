# ContextBrain — production rollout

The web app and the desktop app share one cloud backend. The desktop client (Tauri, later phases) doesn't carry any secrets; it talks to the same Vercel-hosted Next.js app that the browser talks to, just with a native shell wrapped around it.

This document tracks Phase 0 — standing that backend up to a production bar so the rest of the desktop work has a stable foundation.

---

## Phase 0 — production web baseline

Order matters where noted.

### 1. Commit + push the repo

The repo has zero commits as of writing — nothing to deploy from. Make an initial commit, push to `origin/main`. See the **CI gate** section below; the same checks run locally so a clean commit isn't a leap of faith.

```bash
# from the project root
git add .
git status      # look for anything that shouldn't be tracked
git commit -m "Initial commit: ContextBrain v1 scaffold"
git push -u origin main
```

`.env.local` is in `.gitignore` already; double-check the staged file list doesn't include any keys.

### 2. Production Supabase project

Two separate Supabase projects: keep the existing `nopzhjevenszabzkgdkl` (us-east-2) as **development**, create a new one for production.

1. supabase.com → New Project. Name it something like `contextbrain-prod`. Pick the same region as your Vercel deployment (or `us-east-1` if you're unsure).
2. Open SQL Editor and run both files in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_set_match_function_search_path.sql`
   - Plus any additional migrations that have landed since.
3. **Auth → URL Configuration** → add to **Redirect URLs**:
   - `https://contextbrain.app/auth/callback` (or your real domain)
   - `https://contextbrain.app/api/integrations/callback`
   - `contextbrain://auth/callback` (later, for the desktop deep link — fine to add now)
   - `contextbrain://api/integrations/callback`
4. **Auth → Email** → confirm the magic-link template; customize the sender name / subject before public launch.
5. **Settings → API Keys** → grab the **Publishable** + **Secret** keys for the next step.

Acceptance: 8 tables visible under Table Editor with RLS enabled; 3 `match_*` functions present and `search_path = public` (run `get_advisors` via MCP to confirm zero security lints from our migrations).

### 3. Vercel project

1. Push to GitHub first (step 1). Then vercel.com → **Add New… → Project** → import the GitHub repo.
2. **Framework preset**: Next.js (auto-detected).
3. **Build settings**: defaults. Tailwind v4 + Next 16 work out of the box.
4. **Environment variables** — paste these in. Use the production Supabase values from step 2.

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   SUPABASE_SECRET_KEY=sb_secret_…
   DEEPGRAM_API_KEY=…
   DEEPGRAM_PROJECT_ID=…
   OPENAI_API_KEY=…
   ANTHROPIC_API_KEY=…
   COMPOSIO_API_KEY=…
   COMPOSIO_GITHUB_AUTH_CONFIG=…
   COMPOSIO_JIRA_AUTH_CONFIG=…
   COMPOSIO_FIGMA_AUTH_CONFIG=…
   ```

   Mark them available to **Production**, **Preview**, and **Development** as appropriate. Secret keys should never appear in `NEXT_PUBLIC_` vars.

5. **Domains** → add your custom domain (e.g. `contextbrain.app`). DNS: a `CNAME` on `@` to `cname.vercel-dns.com` (or `A` records depending on your registrar's apex support). Vercel will issue a Let's Encrypt cert automatically.

6. Trigger a deploy. The first build will exercise the full pipeline against real production env vars.

Acceptance: `https://contextbrain.app/login` loads, magic-link sign-in works end to end, creating a meeting and recording produces real transcripts and a real summary.

### 4. Composio production wiring

Each provider's OAuth app needs the production callback added.

- GitHub OAuth App settings → **Authorization callback URL** → add `https://contextbrain.app/api/integrations/callback`.
- Jira OAuth → same.
- Figma OAuth → same.

You can keep the localhost callback in parallel for dev. Composio Auth Configs in the dashboard get the same treatment.

### 5. CI gate

A GitHub Actions workflow lives at `.github/workflows/ci.yml`. On every PR and on every push to `main` it runs:

- `npm run typecheck` — `tsc --noEmit`, zero errors.
- `npm run lint` — `eslint --max-warnings 0`, zero warnings.
- `npm run build` — full Next.js build against placeholder env vars.

In the GitHub repo settings → **Branches → main → Branch protection rule**, require the `verify` check to pass before merging. Optionally require a pull request review.

### 6. Observability (recommended before launch, not strictly Phase 0)

Two cheap wins:

- **Sentry** for crashes — `@sentry/nextjs` covers server, client, and edge. Free tier handles a low-traffic launch comfortably.
- **PostHog** for product analytics — track `meeting_started`, `transcript_persisted`, `chat_message_sent`, `integration_connected`, `summary_generated`. Use the free self-host or cloud tier.

I've left these out of the v1 scaffold so the dependency tree stays minimal. When you want them wired, say the word.

### 7. Domain + email

If ContextBrain will send email beyond Supabase's magic-link sender, set up:

- SPF + DKIM + DMARC on the sending domain.
- (Future) Resend / Postmark / SES for transactional mail when we add reminders or summary emails.

---

## What's deferred to Phase 1+

Everything below this line is _not_ Phase 0:

- Tauri shell (Phase 1)
- macOS Swift audio sidecar (Phase 2)
- macOS code signing + notarization (Phase 3)
- Windows audio sidecar (Phase 4)
- Windows EV cert + MSI installer (Phase 5)
- Auto-update channels (Phase 6)

Each gets its own checklist when we start.
