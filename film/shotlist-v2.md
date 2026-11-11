# Ark of the Covenant — Demo Video v2: Shot List + Timing Map

- Format: 1920×1080, H.264. Total runtime target **2:55** (hard cap: under 3:00).
- Title of the film throughout: **Ark of the Covenant**. Title and closing
  cards carry the security track's own tagline (nearhackathon.com):
  "Give AI money without giving it the keys to everything."
- Narration: Kai (edge-tts `en-US-AriaNeural`, +0%), measured 169.3s of
  speech, placed per the offsets below; sections per `narration-v2.md`.
  Selling register, honesty rails: local is called local, live is called
  live, and the private system appears once, as the Section 4 roadmap beat.
- Render route: the persisted v1 pipeline (`film/render.py`, PIL + ffmpeg
  terminal replay from a timestamped transcript) extended with explainer
  cards. The live segment replays the REAL Nov 12 film-run transcript
  (`film/live-demo-film-v2-transcript.jsonl`), never retyped lines.
  **Assembly caution:** use the pre-rendered `film/cards/title-v2.png` and
  `film/cards/closing-v2.png` (they carry the tagline). `film/render.py`
  still contains the v1 card functions without the tagline — do not let
  it regenerate the cards.

## Timing map

Narration starts at 0:02 (the title card breathes first), sections placed
with ~0.4s gaps; speech ends at ~2:54 and the film ends at 2:55.

| # | Film time | Length | On screen | Narration |
|---|-----------|--------|-----------|-----------|
| 1 | 0:00 to 0:08 | 8s | Title card (`film/cards/title-v2.png`): "ARK OF THE COVENANT" / "An agent vault on NEAR (testnet)" / tagline in green | S1 begins at 0:02 over the card |
| 2 | 0:08 to 0:29 | 21s | The PROBLEM card: an agent holding a master key; a poisoned line of text inside a page the agent reads, pointing at the wallet; caption "nothing says no" | S1 — the drain hook, the stakes, Kai introduces herself (27.3s from 0:02) |
| 3 | 0:30 to 1:01 | 31s | The ARK card: flow diagram in text — AGENT (scoped function-call key: request_release / release / use_secret, 0.25 NEAR gas allowance) → REQUEST (recipient + amount + purpose) → GATE SIGNS → CONTRACT VERIFIES (signature, caps 10 per tx / 25 per day, counterparty) → RELEASE. Side note: "the rules live in the contract" | S2 — what the Ark is (31.2s) |
| 4 | 1:01 to 1:25 | 24s | COUNTERPARTY card, three lanes: STRANGER → WARN, money waits for the owner · CLEAN HISTORY → ALLOW, flows · BLOCKLISTED → BLOCK, refused by the contract itself, no override. Bottom strip: SECRETS — sealed in · used by fingerprint · plaintext never comes out | S3 — scoring and secrets (23.2s) |
| 5 | 1:25 to 1:44 | 19s | ROADMAP card: the Section 4 beat as plain on-screen text — floor, not ceiling; this build on standard audited cryptography; the seal stays home. Nothing else on the card | S4 — the roadmap beat (18.9s) |
| 6 | 1:44 to 2:11 | 27s | ATTACK capture: terminal replay of the real local run of `node sim/attack-simulator.js` — A1 drain, A2 bypass, A3 replay, A4 exfiltration lines print in order, each landing on STOPPED; final line "RESULT: 4/4 attacks stopped" holds | S5 — the four attacks, local suite (26.9s) |
| 7 | 2:12 to 2:32 | 20s | LIVE capture part 1 (Nov 12 testnet transcript): header lines, [1] VAULT STATE BEFORE, [2] FIRST PAYMENT — request prints WARN "new account with no interaction history", owner approves, gate signs, RELEASED + tx hash + vendor balance 0 → 5 | S6 — live intro (20.5s) |
| 8 | 2:32 to 2:55 | 23s | LIVE capture part 2: [3] SAME PAYMENT AGAIN — ALLOW, released; [4] THE DRAIN — BLOCK with the blocklist reason, attacker balance 0; [5] SEALED SECRET — 64-char fingerprint + tx; [6] AUDIT LOG tail; [7] VAULT STATE AFTER. Closing card (`film/cards/closing-v2.png`) fades in at ~2:48 and holds: credits, tagline, vault explorer address, "Live on NEAR testnet" | S7 — close: tagline, the repeatable line "The agent asks. The contract decides.", explorer, credits (22.1s) |

Section starts (narration): S1 0:02 · S2 0:30 · S3 1:01 · S4 1:25 ·
S5 1:44 · S6 2:12 · S7 2:32.

## Judging criteria — where each one is answered

| Criterion | Answered by |
|-----------|-------------|
| Technical implementation | S2 + S3 (scoped function-call key, purpose-bound gate signatures, caps and counterparty scoring verified inside the contract) and the live capture itself — real testnet transactions, not a mock; README: Architecture + Status sections with explorer links |
| Design | The card sequence: problem → Ark diagram → three-lane counterparty card (Warn / Allow / Block) — one mental model, carried from card to terminal output to audit log |
| Impact | S1, the problem open: agents are getting wallets everywhere, the money is real, the attacks are real, and nothing between agent and chain says no |
| Originality | Purpose-bound signing (recipient + amount + purpose + nonce, verified against the stored tuple) plus enforcement inside the contract rather than in agent-side policy, and secret use by derived fingerprint — S2, S3, and the A2/A4 stops in S5 |
| Sustainability | The S4 roadmap beat (the production Ark's private sealing layers as the production direction) and the README roadmap (TEE-backed key custody next); the vault, tests, and demo stay live on testnet after the event |

## README notes for publish prep (do NOT edit the repo README yet)

At publish prep — before the clean export is snapshotted — the README
gets one roadmap addition, drafted here so the wording is settled:

> **Roadmap.** Next: hardware-backed key custody via a TEE, so the gate's
> signing key and the secret-derivation key live inside an enclave. The
> production Ark carries sealing layers of our own beyond this build — a
> private encryption system that never ships in the public build. This
> public build runs the same vault on standard audited cryptography: it
> shows what the Ark does, never how that seal works.

Rules for that edit: roadmap/production framing only; the private system
is mentioned once in the whole README; no name, no mechanics, no method
hints. The rest of the README must still match the code exactly (the
export checklist re-verifies this).

## Fresh vendor plan (planned here, executed Nov 12 — see run-of-show)

The filmed first-contact beat needs a vendor with NO interaction history.
The Nov 11 vendor, `ark3agent2120.testnet`, has history now (4 interactions),
so it can never produce the Warn again. Plan:

- Create ONE fresh named testnet account, `ark3vendor2120.testnet`
  (if taken: `ark3vendor2-2120.testnet`, etc.), inside the existing throwaway
  Meteor wallet (created Nov 11; password is the `walletPassword` field of
  `credentials/ark3-keys.json` — local file, never printed, never filmed).
  Meteor supports adding another account to the same wallet; the account is
  created on testnet and needs no funding to receive.
- Do NOT call `record_counterparty` for the vendor before filming. The
  contract scores an unrecorded account from the default record
  (first_seen_block null, 0 interactions) → Warn, "new account with no
  interaction history" — exactly the beat the film needs.
- Faucet note: the docs faucet per-IP rate limit from Nov 11 cleared around
  21:34 EST Nov 11, so funding routes are open again on Nov 12 if the vendor
  ever needs a balance of its own (it does not for this film — it only
  receives).
- Filmed flow budget inside the fresh Nov 12 daily cap (25 NEAR, resets at the
  UTC day boundary, 2026-11-12T00:00:00Z): payment 1 (Warn → approve → release)
  5 NEAR + payment 2 (Allow → release) 5 NEAR + drain attempt 1 NEAR (Blocked,
  no spend) = **11 NEAR of cap, 10 NEAR actually spent**. Vault contract
  balance ~19.99 NEAR covers it, with the drain target and caps unchanged.
- Runner: `film/live-demo-film-v2.js`, vendor id from `ARK_FILM_VENDOR` env
  (default `ark3vendor2120.testnet`). Full step order, signers, and expected
  contract responses: `film/run-of-show-nov12.md`.

## Capture notes for Nov 12 assembly

- Attack segment: run `node sim/attack-simulator.js` once on Nov 12 with the
  same timestamped-transcript capture the film runner uses (or reuse the
  committed v1 approach: capture stdout lines with ms offsets into JSONL).
  It is a local mock-chain run — labeled as the local attack suite on screen
  (the S5 narration already says "run locally"; keep the honesty on screen).
- Live segment: transcript comes from `film/live-demo-film-v2.js` itself
  (JSONL, one object per printed line). Replay scale is chosen at assembly so
  the last line lands by ~2:52; chain latency compresses, printed pauses stay
  proportional.
- Cards: title and closing are pre-rendered (`film/cards/`). Problem, Ark,
  counterparty, and roadmap cards are rendered by the assembly script from
  this shotlist's text — no other wording gets added on Nov 12.
