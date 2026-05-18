# Backlog

Out-of-scope items that came up during v1 build. See PRD §2 and §13.

## Supabase advisor follow-ups
- Move the `vector` extension out of the `public` schema (Supabase recommendation; requires updating every `vector(1536)` reference).
- Enable Auth → Leaked Password Protection in the Supabase dashboard if/when password login is added (currently magic-link only).

## Deferred from v1
- Remote meeting bots (Zoom/Meet/Teams)
- System audio capture (needs Tauri wrap)
- Team sharing / multi-user meetings
- Mobile apps
- Realtime collaboration on notes
- Audio playback / re-listening
- Speaker identity beyond Deepgram diarization labels
- Slack, Notion, HubSpot integrations
