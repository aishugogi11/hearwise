# HearWise — Project Overview

## Repository layout

```
HearWise/
├── index.html              # Frontend (single-page app)
├── server.js               # Express API entry point
├── hearing-future.js       # Hearing risk & dose calculations
├── coach-engine.js         # Aura coach responses
├── listening-sessions.js   # Safe listening sessions & ear rests
├── live-monitoring.js      # Slack huddle integration
├── demo-profiles.js        # Demo listening profiles
├── ml/                     # Optional server-side risk helpers
├── database/               # Connection pool + schema
├── docs/                   # Setup guides
└── package.json
```

## Technology stack

- **Backend:** Node.js, Express
- **Frontend:** Single HTML file with vanilla JavaScript
- **Integrations:** Spotify Web API, Slack Bolt API
- **Auth:** Spotify OAuth 2.0 with session storage

## How data flows

```
Spotify OAuth → listening & playback data
    ↓
Risk engine (hearing-future.js) → dose, Hearing Age, wellness scores
    ↓
Recovery Tracker (listening-sessions.js) → safe sprints & ear-rest timers
    ↓
Dashboard (index.html) → home, planner, Aura coach
```

## Main components

| Area | Files | Role |
|------|-------|------|
| UI | `index.html` | Home, Recovery Tracker, challenges, coach panel |
| API | `server.js` | Spotify OAuth, playback, Slack, coaching routes |
| Risk | `hearing-future.js` | NIOSH-aligned dose, forecasts, wellness metrics |
| Sessions | `listening-sessions.js`, `session-classifier.js` | Auto safe-listening sprints when Spotify plays |
| Planner | `index.html` (planner section) | Schedule listening blocks with live timers |
| Slack | `live-monitoring.js` | Huddle detection → meeting timer & ear rest |
| Coach | `coach-engine.js` | Profile-based tips from listening data |

See `docs/START_HERE.md` for how to run locally and what to open first.
