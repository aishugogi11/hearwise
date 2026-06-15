# HearWise

HearWise is a hearing-health app that connects to Spotify and helps you listen safely. It tracks volume and session length, runs ear-rest timers, plans listening blocks, and surfaces wellness scores on a single dashboard.

## What it does

- **Spotify integration** — OAuth login, live playback, listening history
- **Recovery Tracker** — safe-listening sprints and scheduled listening blocks
- **Wellness metrics** — Hearing Age, dose estimates, and risk forecasts from your listening patterns
- **Aura coach** — tips and reminders based on your profile and session data
- **Slack (optional)** — huddle detection with automatic meeting timer and ear-rest nudge
- **Challenges & quests** — daily habits and gamified recovery goals

Demo profiles work without API keys so you can explore the full UI locally.

## Quick start

```bash
npm install
cp .env.example .env   # add Spotify / Slack keys if you use those integrations
npm start
```

For a guided tour of the codebase, see **`docs/START_HERE.md`**.

## Project layout

```
HearWise/
├── index.html            # Frontend SPA
├── server.js             # Express API
├── hearing-future.js     # Risk & dose engine
├── coach-engine.js       # Aura coach
├── listening-sessions.js # Safe listening sessions
├── live-monitoring.js    # Slack integration
├── demo-profiles.js      # Demo data
├── ml/                   # Server-side risk helpers
├── database/             # Schema & connection
└── docs/                 # Setup guides
```

## Environment variables

Copy `.env.example` to `.env` and fill in what you need:

| Variable | Purpose |
|----------|---------|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify OAuth |
| `SPOTIFY_REDIRECT_URI` | OAuth callback URL (must match your Spotify app settings) |
| `SESSION_SECRET` | Express session signing |
| `SLACK_*` | Optional Slack bot & socket mode |
| `PORT` | Server port (default `3000`) |

## Docs

- [`docs/START_HERE.md`](docs/START_HERE.md) — run locally and key files
- [`docs/ARCHITECTURE_SUMMARY.md`](docs/ARCHITECTURE_SUMMARY.md) — layout and components
- [`docs/SLACK_SETUP_GUIDE.md`](docs/SLACK_SETUP_GUIDE.md) — Slack app setup
