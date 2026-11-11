#!/bin/sh
# Synthesize the v2 narration with Kai's voice (edge-tts, en-US-AriaNeural,
# rate +0% — NEVER slowed) from narration-v2-tts.txt, then print the measured
# duration. Uses film/ttsenv if present, else the v1 venv, else creates
# film/ttsenv. The Nov 12 assembly loudnorms to -16 LUFS (as v1 did);
# loudnorm does not change duration, so timing validation uses this raw take.
set -e
cd "$(dirname "$0")"
if [ -x ./ttsenv/bin/edge-tts ]; then
  EDGE_TTS=./ttsenv/bin/edge-tts
elif [ -x /tmp/ark-film/ttsenv/bin/edge-tts ]; then
  EDGE_TTS=/tmp/ark-film/ttsenv/bin/edge-tts
else
  python3 -m venv ./ttsenv
  ./ttsenv/bin/pip install --quiet edge-tts
  EDGE_TTS=./ttsenv/bin/edge-tts
fi
"$EDGE_TTS" --voice en-US-AriaNeural --rate=+0% \
  --file narration-v2-tts.txt --write-media narration-v2.mp3
ffprobe -v error -show_entries format=duration -of csv=p=0 narration-v2.mp3
