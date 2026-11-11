#!/usr/bin/env python3
"""Assemble Ark demo video v4: v3 picture re-timed to Richard's OWN
ElevenLabs clone narration ("Richard Vigslist V1", recorded 2026-11-11).
Section boundaries measured from his actual audio (faster-whisper base,
word timestamps, cross-checked against silencedetect gaps):
  audio: S1 0.00 S2 22.58 S3 54.56 S4 77.24 S5 93.36 S6 122.14 S7 144.26
  speech ends 157.04, file 157.39s. Film offset +1.2s.
Visual spans follow those boundaries; closing lands with S7.
Total 160.0s (2:40) - under the 3:00 hard cap."""
import importlib.util
import json
import subprocess
import sys

spec = importlib.util.spec_from_file_location("av3", "/tmp/ark-v3/assemble-v3.py")
av3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(av3)
av2 = av3.av2

WORK = "/home/hatch/ark-v4-work"
REPO = "/home/hatch/workspace/ark-of-the-covenant"


def main():
    closing = f"{REPO}/film/cards/closing-v3.png"

    av2.stream(av3.opening_frames(7.0), f"{WORK}/seg-opening.mp4")            # 0 -> 7.00
    av2.stream(av2.hold(av2.problem_card(), 16.78), f"{WORK}/seg-problem.mp4")  # -> 23.78 (S2)
    av2.stream(av2.hold(av2.ark_card(), 31.98), f"{WORK}/seg-ark.mp4")          # -> 55.76 (S3)
    av2.stream(av2.hold(av2.lanes_card(), 22.68), f"{WORK}/seg-lanes.mp4")      # -> 78.44 (S4)
    av2.stream(av2.hold(av3.roadmap_card_v3(), 16.12), f"{WORK}/seg-roadmap.mp4")  # -> 94.56 (S5)

    atk = av2.wrap_attack("/tmp/ark-v2/attack-output.txt")
    av2.stream(av2.replay(av2.even_events(atk, 26.78), 28.78), f"{WORK}/seg-attack.mp4")  # -> 123.34 (S6)

    deploy = [
        "FROM THE LIVE DEPLOYMENT RUN - NEAR testnet, 2026-11-11 (the record)",
        "",
        "[FIRST PAYMENT - a vendor the vault had never paid]",
        "    agent asks: pay 5 NEAR to ark3agent2120.testnet",
        '    purpose: "API subscription renewal"',
        "    contract decision: WARN - new account with no interaction history",
        "    owner approves the release",
        "    gate signs this exact payment: recipient + amount + purpose + nonce",
        "    RELEASED. tx BEcmAdRTwsnhZkxgh2hLuWYijwQ4jaQ1d8MhBUwySebB",
        "    vendor balance: 5.000 -> 10.000 NEAR",
    ]
    av2.stream(av2.replay(av2.even_events(deploy, 6.4), 8.4), f"{WORK}/seg-deploy.mp4")  # -> 131.74

    with open(f"{REPO}/sim/live-demo-film-transcript.jsonl") as fh:
        raw = [json.loads(line) for line in fh if line.strip()]
    scale = (13.72 - 2.0) / 28.124
    events = [(e["t"] / 1000.0 * scale, e["line"]) for e in raw]
    av2.stream(av3.replay_live(events, 13.72), f"{WORK}/seg-live.mp4")       # -> 145.46 (S7)

    av2.stream(av3.closing_frames(closing, 14.64), f"{WORK}/seg-closing.mp4")  # -> 160.10
    print("segments done", file=sys.stderr)


if __name__ == "__main__":
    main()
