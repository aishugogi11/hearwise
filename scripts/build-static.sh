#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"

rm -rf "$OUT"
mkdir -p "$OUT/app"

cp -R "$ROOT/public/." "$OUT/"
rm -f "$OUT/CNAME"

cp "$ROOT/public/feedback-widget.css" "$ROOT/public/feedback-widget.js" \
   "$ROOT/public/manual-timer.css" "$ROOT/public/manual-timer.js" "$OUT/app/"
cp "$ROOT/index.html" "$OUT/app/"
cp "$ROOT/demo-profiles.js" "$ROOT/hearing-future.js" "$ROOT/coach-engine.js" "$OUT/app/"
cp "$ROOT/companion-progression.js" "$ROOT/hearwise-orchestrator.js" \
   "$ROOT/session-classifier.js" "$OUT/app/"
cp "$ROOT/listening-sessions.js" "$ROOT/challenges.js" "$ROOT/hearwise-beta.js" "$OUT/app/"

echo "Static site assembled in dist/"
