# Ark of the Covenant — Run of Show, Nov 12 Filming (v2 demo video)

Everything before Step 3 is preparation and checks. Step 3 runs ONCE.
Pre-written runner: `film/live-demo-film-v2.js` (do not edit its flow on the
day; if reality disagrees with the expectations below, stop and report —
never improvise a second take that double-spends).

## Preconditions

- Time: after **2026-11-12T00:00:00Z**. The vault's daily counter rolls on
  the UTC day boundary, so Nov 11's spend (20 of 25) reads as spent today
  0 of 25, and the full 25 NEAR daily cap is available.
- Tests green from prep: npm 56/56, cargo 13/13 (re-run once on the day
  before filming; both are local and free).
- No secret is ever printed, filmed, or pasted anywhere: credential files
  are loaded for signing only. The film transcript and all cards contain
  public account ids, amounts, decisions, and tx hashes only.

## Step 0 — Create the fresh vendor (browser, Meteor)

1. Open Meteor Wallet (testnet) and unlock the throwaway wallet created
   Nov 11. Password: the `walletPassword` field of
   `credentials/ark3-keys.json` (read it locally; never type it anywhere
   else, never film this step).
2. Add account → create new named account: **ark3vendor2120.testnet**
   (if taken: ark3vendor2-2120.testnet — then use that exact id as
   `ARK_FILM_VENDOR` in Step 2 and note it in the BUILD-LOG).
3. Do NOT fund it (it only receives) and do NOT call `record_counterparty`
   for it. Its absence from the vault's records is what produces the Warn.
4. Sanity: the account exists on testnet (explorer or RPC view_account).

## Step 1 — Pre-flight chain checks (read-only)

Via the fixed client views (or the runner's own [1] state print on a dry
look — views only, no transactions):

- `get_vault_state` on ark3vault2120.testnet: expect balance ≈ 19.993 NEAR,
  **daily_spent 0**, daily_cap 25 NEAR, audit_count 16.
  If daily_spent is not 0, STOP — the UTC day has not rolled or something
  spent; do not film.
- `get_counterparty(ark3vendor2120.testnet)`: expect the default record —
  first_seen_block null, interactions 0. Anything else means the vendor is
  not fresh; STOP and pick a new vendor name.
- `get_blocklist`: expect ark3gate2120.testnet present, evidence
  "reported drain attempt, 2026-11-10".

## Step 2 — Set the vendor

`export ARK_FILM_VENDOR=ark3vendor2120.testnet` (skip if the default name
was free; the runner defaults to it).

## Step 3 — The take: `node film/live-demo-film-v2.js`

Runs once. Who signs what, in order, and what the contract must answer:

| # | Action | Signed / called by | Expected contract response |
|---|--------|--------------------|----------------------------|
| 1 | View vault state + vendor balance | nobody (read-only) | balance ≈ 19.993, spent today 0 of 25, audit 16; vendor ≈ 0 |
| 2 | `request_release` — pay vendor 5 NEAR, purpose "API subscription renewal" | agent: vault account via the SCOPED function-call key (request_release / release / use_secret only, 0.25 NEAR allowance) | **WARN** — "new account with no interaction history"; a pending release is created, nothing moves |
| 3 | `approve_release` for that release id | OWNER account (ark3owner2120.testnet, full-access key) | approval recorded; audit entry "approved by owner" (only the owner can call this) |
| 4 | Gate decision + signature | gate service, off-chain: raw ed25519 over recipient + amount + purpose-hash + nonce + expiry | decision: sign (the gate re-checks purpose category and blocklist before signing) |
| 5 | `release` with the gate signature | agent (scoped key) | contract verifies the signature against the stored pending tuple, re-checks caps, then pays: **RELEASED**, tx hash printed; vendor balance 0 → 5; vendor record created with interactions 1 |
| 6 | `request_release` — the identical payment again | agent (scoped key) | **ALLOW** — "ok" (the vendor now has a clean interaction on record) |
| 7 | Gate sign + `release` | gate (off-chain), then agent (scoped key) | **RELEASED**, tx hash printed; vendor balance 5 → 10; daily_spent now 10 of 25 |
| 8 | `request_release` — the drain: pay ark3gate2120.testnet 1 NEAR, purpose "vendor invoice payment" | agent (scoped key) | **BLOCK** — "on shared blocklist: reported drain attempt, 2026-11-10"; no pending release is created; the block itself is written to the audit log |
| 9 | Attacker balance view | nobody (read-only) | still 0 NEAR — nothing moved |
| 10 | `use_secret("api-key-1", "call billing api")` | agent (scoped key) | returns ONLY the 64-char derived digest (same value as Nov 11: 95a5d438…3161d714 — the derivation is deterministic) + tx hash; no plaintext, no ciphertext |
| 11 | Audit log tail + final state views | nobody (read-only) | audit_count 16 → **23** (+7: request-warn, approve, release, request-allow, release, request-block, use_secret); vault balance ≈ 9.99 NEAR; spent today 10 of 25; pending 0 |

Abort conditions during the take: payment 1 does not return WARN; any step
throws; any output line contains a secret (prefix `ed25519:` attached to a
key, the wallet password, the seed phrase). On abort: keep the transcript,
do NOT re-run, report exactly where it stopped — a partial chain state is
documented plainly in the BUILD-LOG, as with the Nov 11 run.

## Step 4 — Post-take verification

- NearBlocks testnet: open the two release txs, the block request tx, and
  the use_secret tx; confirm each matches the transcript.
- Vault state: balance ≈ 9.99 NEAR, daily_spent 10 of 25, audit_count 23.
- Secret sweep of `film/live-demo-film-v2-transcript.jsonl`: grep for
  `ed25519:` and for every value in `credentials/` — expect zero hits.
- Append the BUILD-LOG film entry (tx hashes, final state) and commit
  locally. Nothing is published on Nov 12 without Richard's go.

## Step 5 — Assembly (per `film/shotlist-v2.md`)

- Render the attack segment from a fresh timestamped capture of
  `node sim/attack-simulator.js` (local, mock chain — labeled as the local
  attack suite on screen and in narration).
- Render the live segment from `film/live-demo-film-v2-transcript.jsonl`
  with the persisted pipeline (`film/render.py`); choose the replay scale
  so the last line lands by ~2:52.
- Cards: `film/cards/title-v2.png` and `film/cards/closing-v2.png`
  (pre-rendered, both carry the track tagline — use these files; do not
  regenerate cards from `film/render.py`, whose built-in card functions
  are the v1 versions without the tagline) plus the problem / Ark /
  counterparty / roadmap cards built from the shotlist text — no added
  wording.
- Mix `film/narration-v2.mp3` (loudnorm to −16 LUFS as on v1) at the
  shotlist offsets; total runtime 2:55, hard cap under 3:00.
- Final frame check: extract the closing frame and read it — name spelled
  V-I-G-S-L-I-S-T; sample frames across both captures for secrets (none
  may appear).
- Deliverable: `~/workspace/your_files/ark-demo-video-v2.mp4`.
