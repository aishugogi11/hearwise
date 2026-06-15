# HearWise — Project Guide

Quick map of this repository.

## Run locally

```bash
npm install
cp .env.example .env   # add Spotify/Slack keys if testing integrations
npm start
```

Open **http://127.0.0.1:3000**

Demo profiles work without API keys — representative listening data is built in.

## What to look at first

| Priority | File / folder | What it does |
|----------|---------------|--------------|
| 1 | `index.html` | Full SPA UI — home, Recovery Tracker, Aura coach |
| 2 | `hearing-future.js` | Explainable risk engine — Hearing Age, NIOSH dose, forecasts |
| 3 | `coach-engine.js` | Data-driven coach responses from profile data |
| 4 | `server.js` | Express API — Spotify OAuth, Slack huddles, coaching endpoints |
| 5 | `ml/` | Server-side risk helpers and forecasting |
| 6 | `ml-client.js` | Browser-side risk scoring |
| 7 | `live-monitoring.js` | Slack huddle detection → auto meeting timer |
| 8 | `docs/ARCHITECTURE_SUMMARY.md` | Project layout and components |

## Root layout

```
HearWise/
├── index.html          # Frontend (single page)
├── server.js           # Backend entry point
├── hearing-future.js   # Core risk engine
├── coach-engine.js     # Aura coach logic
├── ml-client.js        # Browser risk scoring
├── listening-sessions.js / session-classifier.js  # Recovery Tracker
├── live-monitoring.js  # Slack integration
├── challenges.js       # Gamification
├── demo-profiles.js    # Representative listening profiles for demo
├── ml/                 # Server ML modules
├── database/           # SQLite/Postgres connection + schema
├── data/               # Local SQLite DB (gitignored)
└── docs/               # Architecture, Slack setup, this guide
```

## VS Code

Open **`HearWise.code-workspace`** for a multi-folder view (App, ML, Database, Documentation).

Related scripts are **nested under `index.html` and `server.js`** in the file explorer (file nesting).

## Demo profiles

The app uses **representative Spotify listening profiles** so risk forecasting and recommendations show consistently in demo mode. The same engine works with live Spotify when connected.
