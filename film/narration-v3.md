# Ark of the Covenant — Demo Video v3: Narration Script

- Voice: professional British male, edge-tts `en-GB-RyanNeural`, rate +0% — never slowed.
- Direction (Richard, 2026-11-11): a product film focused only on the
  project — what the Ark is and what it does. No narrator identity, no
  employer framing, no company name. Richard's name appears exactly
  once in the whole film: the closing card line "Built by Richard
  Vigslist". It is not spoken.
- Register: clean, confident, cinematic-professional, selling at full
  strength on the same honesty rails as v2: every claim is a capability
  the code has; the local attack suite is stated as local; the live run
  is stated as live; the private system appears once, in the Section 4
  roadmap beat, in roadmap tense, with no name and no mechanics.
- Banned phrases honored: no "delve", "no fluff", "tapestry",
  "in today's fast-paced world", "it's important to note", "as an AI",
  no "honestly" voucher, no "Read that again". Number ranges use "to".

## Section 1 — Cold open: the problem

One poisoned line is all it takes. An AI agent reads a page, finds an
instruction buried in it, and empties its wallet to an attacker —
because the agent holds the master key, and nothing between the agent
and the chain can say no. Agents are being given wallets everywhere.
The money is real. The attacks are real. This is the thing that says
no.

## Section 2 — What the Ark is

This is the Ark of the Covenant: a vault on NEAR that holds an agent's
funds and its secrets. The agent never holds a master key. It holds
one scoped function-call key — three methods, a small gas allowance.
Every release is bound to one recipient, one amount, and one purpose,
and signed by a separate gate. The contract itself then verifies the
signature, the spending caps, and the counterparty record before
anything moves. The rules live in the contract — beyond the reach of
a poisoned instruction.

## Section 3 — Counterparties and secrets

Counterparties are scored, never trusted on sight. A stranger triggers
a warning, and the money waits until the owner approves. A clean
history flows. A blocklisted account is refused by the contract
itself — no approval, no override. Secrets follow the same rule:
sealed inside the vault, used only by fingerprint. The plaintext
never comes out.

## Section 4 — The roadmap beat (the one mention)

And this is the floor, not the ceiling. This public build runs on
standard audited cryptography. The production Ark carries sealing
layers of its own — a private encryption system that never ships
publicly. What you're watching: the vault. The seal stays home.

## Section 5 — The four attacks (local suite)

The first attacks on the Ark came from its own builders: four
attacks, run locally against a mock chain. A drain — a poisoned order
sending ninety test NEAR to a blocklisted account. A bypass — a
direct release call with a forged signature, then a random one. A
replay — a spent signature and nonce, presented again. An
exfiltration — asking the vault for the secret. Four attacks. Four
stops. Then the drain was tried again, live.

## Section 6 — Live demo

Now watch it work, live on NEAR testnet. A first payment to a vendor
the vault had never paid pauses on a warning, until the owner
approves and the gate signs. Repeated, the same payment flows
straight through. The drain hits the blocklist and dies. The sealed
secret returns as a fingerprint only. Every step lands in an audit
log anyone can read.

## Section 7 — Close

That is the Ark of the Covenant. Give AI money without giving it the
keys to everything. The agent asks. The contract decides. Every
transaction in this film is on the public explorer, at the address on
screen.

---

## Timing validation

- Synthesis: edge-tts, `en-GB-RyanNeural`, `--rate=+0%`, per section.
  (In this sandbox, edge-tts needs a CA bundle that includes the
  egress proxy CA; a wrapper that patches `certifi.where()` to a
  combined bundle was used. No proxy flag — the websocket upgrade
  fails through the HTTP proxy; direct egress works with the combined
  bundle.)
- Pass 1: 430 words → 170.9s, over the 170s speech ceiling. Trimmed
  22 words of redundancy (no substance, no beats lost) → pass 2.
- Pass 2 (this script): **423 words → 168.8 seconds (2:48.8)** of
  speech — inside the 2:35 to 2:50 window.
- Per-section measured durations: S1 23.5s · S2 32.5s · S3 25.2s ·
  S4 17.7s · S5 30.8s · S6 24.0s · S7 15.2s.
- Placement in the film: S1 at 0:01.2 over the opening image, then
  S2 0:25.4 · S3 0:58.6 · S4 1:24.5 · S5 1:42.9 · S6 2:14.4 ·
  S7 2:39.1. Speech ends at 2:54.3; the film ends at 2:54.5.
- Audio: sections loudnormed to −16 LUFS after placement;
  `narration-v3.mp3` is the placed, loudnormed track.
- Underscore: none. A locally generated underscore was considered and
  skipped — synthesized tones risk muddiness under the narration; the
  film carries on voice and picture.
