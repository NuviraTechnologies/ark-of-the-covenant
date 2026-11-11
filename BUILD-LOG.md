# Ark of the Covenant — Build Log

Entrant: Richard Burgess, publishes under the author name Richard Vigslist.
Event: NEAR Hackathon, AI Security & Defense track (`security`).
Deadline: Sat 14 Nov 2026, 6:59 PM ET (23:59 UTC).
Phase 1 scope: deploy-ready (local tests green, no live deploy — that goes
through a separate browser route).

## 2026-11-11 ~06:55 EST — GO given
- Richard: "build the Ark of the Covenant." Exposure line settled: the
  production Ark's encryption language NEVER goes public — its name and
  its mechanics both stay out of this repo; the public build shows
  WHAT the Ark does, never HOW the encryption works. Public seal = standard
  audited cryptography.
- Winner/judge research completed (report in
  `~/workspace/research_notes/near-hackathon-winners-judges-research-20261111-1141/report.md`):
  direction right, but as sketched only top-third/possible 3rd. Bar-setter is
  Blackbox (real-money agent, on-chain anchoring, honest escape table).
  Required upgrades: on-chain gate, cryptographic purpose-binding centre-stage,
  TEE secrets story. All three are in ARCHITECTURE.md.

## 2026-11-11 ~07:00 EST — Toolchain decision
- No Rust toolchain on the box (`cargo`/`rustc` absent). NEAR JS SDK
  (`near-sdk-js@2`) install FAILED: its postinstall downloads a binaryen
  tarball and the extraction fails in this sandbox.
- Decision: **Rust via rustup** (canonical NEAR contract SDK, native unit
  tests with `cargo test`). rust-lang.org is reachable through the proxy.
  Installing stable/minimal + `wasm32-unknown-unknown` target in the
  background. If that fails, fallback is to re-attempt near-sdk-js with
  `--ignore-scripts` and a manual binaryen, or to write the contract in
  AssemblyScript — decision to be recorded here either way.
- npm registry reachable (`npm ping` PONG). `near-api-js@7.4.0` already
  proven in `~/workspace/verifygate-spike/` (keygen works locally).

## 2026-11-11 ~07:05 EST — Architecture written
- `ARCHITECTURE.md`: vault contract with on-chain gate, purpose-hash binding
  (`sha256(recipient ‖ amount ‖ purpose ‖ nonce)`), gate signature over the
  full tuple + expiry, single-use nonces, counterparty check (age, contract/
  code-change, prior interactions, shared blocklist with evidence),
  sealed-secret `use_secret` returning derived results only, escape table,
  demo flow, real-vs-roadmap table, baseline disclosure.
- Repo scaffold created; parallel work split: core JS modules + counterparty
  service (subagent), agent wrapper + mock chain + attack simulator
  (subagent); Rust contract + README + integration stay with the
  coordinator.

## 2026-11-11 ~07:10 EST — Toolchain settled: Rust (with one repair)
- First rustup install was interrupted mid-run (missing toolchain manifest).
  Repaired by uninstall + clean reinstall: cargo/rustc 1.99.1 stable,
  `wasm32-unknown-unknown` target installed.
- `cargo test` first failed on near-sdk 5.30's compile_error for host
  builds without a valid cfg. Fix recorded: dev-dependency
  `near-sdk = { version = "5", features = ["unit-testing"] }` in
  contract/Cargo.toml. The wasm contract build does not enable it.

## 2026-11-11 ~07:15 EST — Contract written
- `contract/src/lib.rs`: full ark-vault contract per ARCHITECTURE.md —
  on-chain gate verification (ed25519 over the canonical decision string,
  checked against the stored pending tuple), purpose-hash commitment,
  single-use nonces, expiry, daily/per-tx caps, allowlist, shared blocklist
  with evidence, counterparty records with code-change detection,
  `use_secret` returning derived digests only, bounded 200-entry audit log.
- 13 unit tests written (happy path, warn flow, blocklist block, caps,
  wrong-key signature, tampered-amount signature, replay x2, expiry,
  secret derivation, owner-only seal, code-change warn, purpose-hash spec
  vector). Test run in progress.
- ARCHITECTURE.md addition vs original draft: contract init also takes
  `gate_account` (the gate service's account, allowed to call
  `record_counterparty` alongside the owner).

## 2026-11-11 ~07:25 EST — JS workstreams landed (delegated, verified)
- Core modules + counterparty service (subagent): core/purpose.js,
  core/policy.js, core/counterparty.js, services/counterparty-service.js.
  32 tests pass. Notable judgment calls: isExpired fails closed at the
  expiry second; "API subscription renewal" classifies as `subscription`
  (classify order: refund → payroll → subscription → api-usage →
  vendor-payment).
- Agent wrapper + mock chain + attack sim + demo (subagent): 7 tests pass,
  demo runs the [0:00]/[0:30]/[0:55]/[1:15] flow, attack simulator reports
  4/4 attacks stopped. Gate signing is RAW ed25519 via node:crypto
  (SPKI-prefix reconstruction) so signatures verify with NEAR's on-chain
  `env::ed25519_verify` — near-api-js sign() pre-hashes and would fail
  on-chain; deliberately not used.
- Integration verified by coordinator: full JS suite 39/39 via `npm test`
  (script fixed to enumerate the three test files — `node --test tests/`
  treats the directory as one entry on this Node version and fails);
  JS `purposeHash` output equals both the shell sha256sum vector and the
  Rust contract's spec-vector test value (0b01ca16…), so JS and Rust
  implementations agree byte-for-byte.

## 2026-11-11 ~07:30 EST — Contract tests green + wasm builds
- `cargo test`: 13/13 pass (after adding derive(Clone) to
  CounterpartyRecord/AuditEntry and fixing env::account_balance() —
  near-sdk 5.30 renamed it from current_account_balance).
- `cargo build --release --target wasm32-unknown-unknown`:
  ark_vault.wasm, 439,434 bytes. Deploy-ready artifact.
- README.md written: machine-readable do-X-see-Y steps (all verified
  locally by the coordinator), prompt-item mapping table with one honest
  "Partial" (live function-call key creation is a deploy step), escape
  table with 3 not-stopped + 1 partial entries, TEE leg as roadmap.
- Known mock-vs-contract cosmetic differences (contract is source of
  truth): mock audit wording differs slightly from contract audit
  strings; mock request_release throws on expired requests instead of
  the contract's panic — same fail-closed outcome.

## PHASE 1 COMPLETE — deploy-ready
Remaining for live testnet (later phase, browser route): owner/vault/
agent account creation, wasm deploy + `new` init, function-call key
creation, vault funding, NearChainClient implementation, live demo
re-run + explorer links into README, GitHub publication, X demo post,
submission form. One decision for Richard: none outstanding for deploy
mechanics — Richard's own steps are creating his NEAR wallet (he said
he will do it later today, 2026-11-11) and posting the X demo.

## 2026-11-11 ~07:13 EST — Phase 2 prep: NearChainClient implemented
- `agent/chain-client.js`: NearChainClient is now a real client against
  the installed near-api-js (7.5.2 — note: the registry's current line,
  not 7.4.0; its API is account-centric: `new Account(id, provider,
  signer)`, `account.callFunctionRaw`, `provider.callFunction` for
  views). Every interface method maps to the contract ABI: change calls
  via `callFunctionRaw` (amounts as yocto strings, `deposit` attached,
  gate signature and gate public key as base64, gas 30 TGas, waitUntil
  FINAL), views via the provider, results normalised to the mock
  client's shapes (status case, snake_case → camelCase). Extras the
  deploy needs: `deployContract`, `initialize` (the `new` call),
  `addAgentFunctionCallKey` (defaults: vault scope, methods
  request_release/release/use_secret, 0.25 NEAR allowance), plus
  `getRelease`/`getBlocklist`/`setPolicy`/`addToAllowlist` parity.
  Failures surface as `NearCallError` with a classified kind
  (contract_panic / account_not_found / method_not_found / transport).
  Mock/sim path untouched; `createChainClient()` selects live only when
  credentials are present, sim otherwise (default sim world = the demo
  world). No network calls were made (sandbox has no NEAR egress).
- Tests: `tests/near-chain-client.test.js` — 16 new tests against a
  stubbed near-api-js transport (call construction: method names,
  yocto-string amounts, purpose-hash passthrough, base64 signature/key,
  gas/deposit, error classification, factory selection). Full suite
  re-run after the change: `npm test` 55/55 (was 39), `cargo test`
  13/13, `node sim/demo.js` and `node sim/attack-simulator.js` clean.
- `DEPLOY-RUNBOOK.md` written: the full browser-route sequence —
  Richard's wallet (step 0), sub-account creation, gate keypair
  generation, wasm deploy + `new` (owner, gate account, gate public key
  base64, caps 10/25 NEAR), the agent's scoped function-call key,
  funding + vendor/blocklist/secret seeding, live demo + explorer-link
  capture for the README Status table, and the GitHub publication
  checklist. Wallet UI, faucet page/amount, canonical testnet explorer,
  storage costs, and the browser deploy tool are marked UNVERIFIED
  (not confirmable from local files).
- README updated where behaviour changed: NearChainClient status row,
  test counts (55), deploy step 5 now points at DEPLOY-RUNBOOK.md,
  layout lists the runbook. Nothing in the README claims a live run —
  the client is construction-tested only until deployment executes.

## 2026-11-11 ~07:45 EST — Triple-check verification pass (Richard's order: double-check everything)
- TESTS, checked three ways: `cargo test` 13/13 in the Phase 1 run, the
  Phase 2 re-run, and this pass — identical. JS suite 55/55 in both
  passes since the live-client tests landed (Phase 1 ran the
  then-existing 39), per-file 20 core / 12 counterparty service /
  7 agent+sim / 16 live-client. Demo and attack simulator clean in all
  three passes: `node sim/demo.js` exit 0 (5 NEAR released, balance
  100 → 95; injection blocked with the blocklist reason; secret use
  returned a 64-char hex digest only), `node sim/attack-simulator.js`
  exit 0, 4/4 stopped. Wasm on disk: 439,434 bytes, matching the README
  Status table. Counterparty CLI re-run: vendor.testnet allow
  ({"status":"allow","reasons":[]}), attacker.testnet block,
  newbie.testnet warn — all exactly as README step 7 states. Nothing
  failed in this pass; no code fixes were needed.
- SECRETS + PROTECTED-MATERIAL SWEEP (working tree + full git history):
  no real key material anywhere — no private keys, no seed phrases, no
  secret keys in any file or any commit; no credentials folder exists;
  nothing sensitive is tracked. Dispositions of every hit: (1) a
  clearly labelled fake fixture (FAKEagentKey…) in
  tests/near-chain-client.test.js — a fake public key in a test, safe;
  (2) runtime key plumbing only — the gate keypair is generated at run
  time via node:crypto, the live client reads its secret from env or
  config at run time, the runbook's step-2 snippet generates a keypair
  into the gitignored credentials/ folder — no key values are stored
  anywhere; (3) the runbook's own pre-publish grep checklist line.
  The production system was NAMED in two docs — the ~06:55 entry in
  this log and ARCHITECTURE.md's disclosure — with a one-phrase
  description of what it is. No mechanics, no tables, no mappings, no
  internals, in tree or history. But the settled exposure line is that
  the system stays unmentioned beyond the README disclosure, so both
  mentions were scrubbed to generic wording in this pass; the re-sweep
  of the tree is now zero hits. Publish-time note: the two Phase 1
  commits' diffs still contain the name as part of the original
  decision record (and this pass's commit shows its removal) — if the
  repo is ever published with full history, decide then whether to
  export a clean tree instead of the history.
- README-vs-CODE AUDIT: every numbered step re-run (steps 1–7) and
  every checkable claim compared against contract/src/lib.rs and the
  JS core: method surface, purpose-hash formula, gate decision string,
  policy categories, the 5 NEAR warn threshold (identical in Rust and
  JS), secret-derivation inputs, escape-table unit-test names
  (tampered_amount_signature_panics, expired_decision_panics — both
  exist and pass). One wording drift found and fixed, in
  ARCHITECTURE.md §5: the secret digest inputs are now stated as the
  code computes them (secret id, operation, stored ciphertext,
  caller). README itself needed no corrections.
- BASELINE DISCLOSURE: README's Baseline section rewritten. It now
  states plainly that the Ark concept is the entrant's pre-existing
  private system — unfinished, never finished, never released, never
  submitted anywhere, none of its mechanics in this repo — and that
  every line of NEAR-specific code here (contract, agent, services,
  simulation) is new work from the hackathon window. The previous
  wording did not state the first part.
- RUNBOOK VERIFICATION (official NEAR documentation only): faucet
  page, external faucet URL, and the 5 test NEAR per-request amount —
  verified (docs.near.org/getting-started/faucet and
  docs.near.org/getting-started/tools-for-ai). Storage pricing
  1 NEAR per 100 KB, so ~4.4 test NEAR of storage stake for the wasm —
  verified (docs.near.org/protocol/storage/storage-staking).
  Sub-account protocol rule — verified
  (docs.near.org/protocol/accounts-contracts/account-id). Testnet
  explorer = NearBlocks testnet; legacy NEAR Explorer retired
  31 Jan 2024 — verified from NEAR's official post text (near.org, via
  search indexing; the post was not re-fetched in full, and the runbook
  says so). Still UNVERIFIED: the specific wallet UI/flow, the
  browser-route deploy tool (official docs cover the CLI route only),
  the exact /txns/ path on first sight, named-account availability.
  DEPLOY-RUNBOOK.md updated with the facts and their sources; nothing
  was guessed.
- Scope held: local verification only. Nothing published, nothing
  submitted, no NEAR network calls made. Changes committed locally.

## 2026-11-11 — Live deploy begun (testnet, browser route)

- Testnet accounts created via the browser route in Meteor Wallet
  testnet mode, each funded 5 test NEAR from the NEAR docs faucet
  (https://docs.near.org/getting-started/faucet — the external
  near-faucet.io failed twice; the docs faucet succeeded for all
  four), verified on NearBlocks testnet
  (https://testnet.nearblocks.io):
  - OWNER: `arkowner2120.testnet`
  - VAULT: `arkvault2120.testnet`
  - AGENT: `arkagent2120.testnet`
  - GATE: `arkgate2120.testnet`
  Meteor has no sub-account option, so top-level `.testnet` names
  were used — the fallback the runbook allows (Accounts and names).
  Note: the vault account holds 5 test NEAR, which is below the
  runbook's funding target for the deploy (storage stake ~4.4 NEAR
  for the wasm alone) plus the 100 NEAR demo funding in step 5 —
  more faucet rounds (5 NEAR per request) are needed during the
  deploy session.
- Payout address (mainnet): `calmdata2120.near` — Richard's own
  wallet, verified to exist on NearBlocks mainnet 2026-11-11 with a
  0 balance. Payout only; the build never uses it.
- Gate keypair generated (DEPLOY-RUNBOOK step 2, local, no network):
  ed25519 keypair via this repo's `agent/gate` module
  (`createGateKeypair`), written to `credentials/gate-keypair.json`
  (gitignored — confirmed by `git check-ignore` and a clean
  `git status`; nothing under `credentials/` is tracked).
  Gate public key (base64, raw 32 bytes):
  `BwLlHPJ5XO46qPW0qIHV0lyxfO69Y9x/zqwoL2oDMyU=`
  Local suite re-run after generation: `npm test` 55/55.

## 2026-11-11 ~08:01 EST — Faucet rate limit hit; funding scope set to 20 test NEAR

- The NEAR docs faucet rate-limits per IP: after 10 successful
  5-NEAR grants across two browser sessions it returned "Rate
  limit exceeded, retry in 12 hours" (~08:01 EST; retry available
  ~20:00 EST). No further faucet funding is possible until then.
- Consolidation: the spare balances from the owner, agent, and
  gate accounts were transferred into the vault account
  (`arkvault2120.testnet`), verified on NearBlocks testnet.
  Result: vault holds **46.1 test NEAR**; the other three accounts
  hold ~1.3 test NEAR each. Transfer transaction hashes:
  - `CuUAZWxj46S3eyqBGAjCezfzgBBhJ4jNM6RkDvQBhw3w`
  - `5KEkejT5JrFf2um2Yrk7vP6YVwoLRC6fFpeGT1LQY3cw`
  - `E8ZEF8dLCd2K3v37GbtQtgYLMZzSUkTVJwg5xeVBmHBn`
- Funding decision: deploy proceeds NOW on the balance on hand.
  The live vault deposit is set to **20 test NEAR** (was 100 in
  DEPLOY-RUNBOOK step 5 — that figure was an arbitrary demo size,
  not a functional requirement). Policy caps are unchanged
  (max_per_tx 10 NEAR, daily_cap 25 NEAR); a release can never
  exceed the balance anyway, and state checks will show balance
  20. The 46.1 on hand covers the ~4.4 NEAR contract storage
  stake plus the 20 NEAR deposit with headroom. DEPLOY-RUNBOOK.md
  step 5 item 1 updated to match; README carries no live-deploy
  funding figure (its only "100" is the local sim's 100-unit
  world, unchanged).

## 2026-11-11 — Deploy console built (deploy/near-console.html)

- Why: no public in-browser deployer accepts a raw .wasm upload, so
  the browser route needed its own console page. `deploy/near-console.html`
  is a single self-contained file (plain HTML/vanilla JS, no build
  step) that runs in the signed-in browser session where Meteor
  Wallet (testnet mode) is already installed.
- What it does: connects Meteor Wallet via @near-wallet-selector,
  deploys a chosen .wasm file to the connected account itself
  (deployContract action — the runbook step 3 deploy), sends change
  calls (contract id / method / args JSON / deposit / gas fields —
  covers the `new` init and every later owner call), and runs view
  calls (call_function over JSON-RPC, pretty-printed result). Every
  step and every error lands in an on-page log pane; successful
  transactions show the hash plus a NearBlocks testnet link
  (https://testnet.nearblocks.io/txns/<hash>).
- Testnet pinning: the network is hardcoded to testnet, the RPC is
  pinned to https://rpc.testnet.fastnear.com (handed to the selector
  as a fallback RPC URL, which its testnet preset adopts as the node
  URL), and before every signing request the page re-checks the
  selector's configured network id and refuses to sign if it is not
  "testnet". There is no other network's code path in the file.
  Keys are never handled by the page — signing happens entirely
  inside the wallet.
- Libraries (pinned, jsDelivr CDN, loaded at runtime): near-api-js
  5.0.0 UMD browser bundle (window.nearApi — RPC provider, amount
  parsing, actionCreators with the selector's plain-object action
  form as fallback) and @near-wallet-selector/core +
  @near-wallet-selector/meteor-wallet 9.5.4 as ES modules via
  jsDelivr's bundled +esm builds behind an import map. The 9.5.4
  selector line is the last one built against near-api-js (its peer
  range is ^4 || ^5); the 10.x line targets @near-js/* packages
  instead. Export names (setupWalletSelector, setupMeteorWallet)
  and the action object shapes were verified against the published
  package files on the CDN before use.
- Validation (local only — the page was NOT run against any
  network): the module script was extracted and passed
  `node --check` as an .mjs file; the import map parses as valid
  JSON. Grep confirmations on the final file: "mainnet" appears only
  in refusal/warning comments (2 lines), "rpc.testnet.fastnear.com"
  is present (banner + pinned config), the testnet config constant
  and the pre-signing network check are present, and deployContract
  usage is present.

## 2026-11-11 — Local testnet account set #2 generated; creation blocked (sponsor faucet unreachable from sandbox)

- Browser-wallet set abandoned: the Meteor wallet password for the
  first deploy session is unrecoverable by us. Those accounts are
  testnet throwaways with zero value; nothing depends on them.
  Replaced by a fresh set whose keys are generated and held locally.
- Generated four ed25519 keypairs locally with near-api-js 7.5.2
  (`KeyPair.fromRandom('ed25519')`), one per role:
  - owner: `ark2owner2120.testnet`
  - vault: `ark2vault2120.testnet`
  - agent: `ark2agent2120.testnet`
  - gate:  `ark2gate2120.testnet`
  Keys stored ONLY in `credentials/testnet-accounts.json`
  (gitignored — `git check-ignore` confirms; never committed).
- Name check via RPC view (`https://rpc.testnet.fastnear.com`,
  block height ~277,221,493): all four names are unregistered.
  Balances: none — the accounts do not exist on-chain yet.
- Creation-route investigation:
  - The `testnet` root contract DOES expose a permissionless-looking
    `create_account` (args: new_account_id, new_public_key as raw
    base58, initial_balance, registrar_account_id), but a signed probe
    call from a non-existent signer account fails at access-key
    lookup ("Access key ... does not exist") — on-chain creation
    still needs an existing funded signer. No bootstrap there.
  - The one documented programmatic creation route is the faucet
    sponsor service that near-cli-rs uses
    (`sponsor-by-faucet-service`: POST the faucet URL from the
    network config with JSON {"newAccountId","newAccountPublicKey"};
    that URL is `https://faucet-api.onrender.com/`). From this
    sandbox the host accepts the proxy CONNECT but returns ZERO
    BYTES on every probe (GET / 20s timeout; POST / with the
    documented body and a 90s timeout; the service's sibling Render
    host helper.testnet.near.org answers 404 in <1s, so Render
    egress itself works). A post-probe RPC check confirms no account
    was created. No 429 was ever received — the service simply does
    not respond from here.
  - Docs faucets (docs.near.org/getting-started/faucet, near-faucet.io)
    fund EXISTING accounts through a browser widget only (docs:
    "The faucet requires a browser"), and the earlier browser
    session's faucet rate limit ("retry in 12 hours") may still gate
    that path.
- State reached: keypairs ready and stored; account creation and
  funding NOT done. The remaining route is the browser wallet UI
  (create each name in the wallet, then import/control via the
  locally held keys is not possible for wallet-created accounts —
  the wallet would hold its own keys) OR re-probing the sponsor
  faucet from a network where it answers. Deploy steps 1+ stay
  blocked on four funded testnet accounts existing.

### Alternate-RPC route pass — 2026-11-11 (~09:05–09:10 EST)
Single clean pass, one attempt per endpoint per step, no retries,
no background jobs.

- Public keys derived locally from `credentials/testnet-accounts.json`
  (derived values match the file's stored `publicKey` fields exactly;
  secret keys never printed):
  - owner `ark2owner2120.testnet` → ed25519:EVtC4wapE1qjMpKwP2hqEHLrddpZkCZb2JbMaR8G97YC
  - vault `ark2vault2120.testnet` → ed25519:ARgdomXJzvVFNMs53ShBGdcFxpBqhuvLwATFfSaGsXma
  - agent `ark2agent2120.testnet` → ed25519:FXaTe22tjNVf5QH5qAFg3vPhxsXqM5raWogvyYmZi6MN
  - gate  `ark2gate2120.testnet`  → ed25519:HtRntjmVtvyZFUGJxFzs6bxGxURAGwGJcpoNrUShLfQs
- RPC status probes (one call each, 20s timeout):
  - `https://rpc.testnet.near.org` → ANSWERED live: chain_id "testnet",
    protocol version 88, syncing normally (earliest block height
    277,040,455 in the returned page). This is a second working public
    testnet RPC from the sandbox, alongside fastnear.
  - `https://testnet.near.dapplets.org` → no response (empty body after
    its 20s share of the probe window).
  - `https://near-testnet.lava.build` → no response (empty body).
  No 429 received from any endpoint.
- Creation attempt — sponsor faucet, one final POST from the sandbox:
  - POST `https://faucet-api.onrender.com/` with body
    {"newAccountId":"ark2owner2120.testnet","newAccountPublicKey":"ed25519:EVtC4wapE1qjMpKwP2hqEHLrddpZkCZb2JbMaR8G97YC"},
    120s cap → TIMED OUT with 0 bytes received (curl exit 28,
    HTTP status 000). The service has not woken for this network
    path; it does not answer at all (still no 429). Per the
    single-pass rule the remaining three POSTs were NOT sent —
    creation did not succeed, so there was nothing to repeat.
- Helper-contract fallback check: grep of `node_modules/near-api-js`
  and the repo for `helper.testnet.near.org`, `account-creator`,
  and `faucet-api` paths found NO documented creation path (only
  this log and the keys file mention the faucet URL). Per the
  stop rule, no further creation service was probed.
- Post-attempt verification via `https://rpc.testnet.near.org`
  (`view_account`, finality final) — all four ark2* accounts return
  UNKNOWN_ACCOUNT ("account ... does not exist while viewing"):
  - ark2owner2120.testnet: does not exist, no balance
  - ark2vault2120.testnet: does not exist, no balance
  - ark2agent2120.testnet: does not exist, no balance
  - ark2gate2120.testnet:  does not exist, no balance
- Keys file unchanged (all four names remain unregistered, so no
  renames were needed). Deploy remains blocked on account creation.
  Unblock path (unchanged): run the sponsor faucet from a network
  where Render answers, or use the browser docs faucet once its
  12-hour limit clears (~20:00 EST) to create/fund the accounts in
  the browser session, then drive the deploy with the locally held
  keys where the wallet permits import.

## 2026-11-11 — LIVE DEPLOY EXECUTED (ark3 set, local route, FastNear RPC)

The ark3 account set (fresh browser wallet; its password and seed
phrase are recorded only in the gitignored keys file below) unblocked
the deploy. All steps ran locally through `agent/chain-client.js`
(`NearChainClient`) against `https://rpc.testnet.fastnear.com` —
the runbook's browser-route premise no longer applies; sandbox RPC
egress works.

- **Keys file:** `credentials/ark3-keys.json` (mode 600) holds the
  owner + vault exported keys for the ark3 set. `git check-ignore`
  confirms it is ignored (`.gitignore` line 7: `credentials/`);
  `git status` clean. Secret keys are never printed anywhere in this
  log — prefixes only: owner secret [redacted prefix], vault secret
  [redacted prefix].
- **Pre-flight verification (RPC, before any transaction):** all four
  ark3 accounts exist — owner `ark3owner2120.testnet` 5.0 NEAR,
  vault `ark3vault2120.testnet` 40.0 NEAR, agent
  `ark3agent2120.testnet` 5.0 NEAR, gate `ark3gate2120.testnet` 0.
  (The parent report said ~4.7981 / ~39.7981; on-chain balances are
  exactly 5.0 / 40.0 — the report appears to have been taken after a
  storage display deduction. Recorded as observed.) Both exported
  keys verified **FullAccess** on-chain via `view_access_key_list`
  (owner pub `ed25519:4vQdhHVBeoAc1N1JtVcSjez7tEeAiQiATJcjMgEZwQg3`,
  vault pub `ed25519:8MagsZGX9mApw78TbupK8rRxSKsGtVdnXHpZfEKhnKzG`).
  Gate public key in `credentials/gate-keypair.json` matches the
  init value used: `BwLlHPJ5XO46qPW0qIHV0lyxfO69Y9x/zqwoL2oDMyU=`.
- **Deploy:** `ark_vault.wasm` (439,434 bytes) deployed to
  `ark3vault2120.testnet`, signed by the vault account's own key.
  Tx: `7zo84XfSK41xKVqEogp7vxjifnhTzcEHW8LufcVt1Npk`
- **Init (`new`, called once):** owner `ark3owner2120.testnet`,
  gate_account `ark3gate2120.testnet`, gate_public_key as above,
  max_per_tx `10000000000000000000000000` (10 NEAR), daily_cap
  `25000000000000000000000000` (25 NEAR), allowlist_only false.
  Tx: `3M1abhVuEBWxACmB9uftADqYMPGgGPL9ctRpL5HkMqtK`
  Verified `get_vault_state`: caps exactly as set, pending_count 0,
  audit_count 0.
- **Agent scoped function-call key — PLACEMENT DEVIATION (see note):**
  added ON THE VAULT ACCOUNT by the vault full-access key (the
  runbook puts it on the agent account; on-chain a function-call key
  authorises calls signed by the account HOLDING the key, and the
  agent's `release` calls must be signed by the contract account —
  the same shape the mock uses, where the vault account is the
  release caller). Fresh local keypair, public key
  `ed25519:gyFgzhQQQGhfWePCxf9jAoXJVEGu4E9zdDgCEpiFwf9`; permission
  verified on-chain: FunctionCall, receiver `ark3vault2120.testnet`,
  methods `request_release,release,use_secret`, allowance
  `250000000000000000000000` (0.25 NEAR). Keypair stored in
  `credentials/agent-function-key.json` (gitignored, mode 600).
  Tx: `Gu5yZUd692NU439eqZQKGE7CMHsq7qDWdEZkAV5oFykH`
- **Deposit — FUNDING DEVIATION (documented, not a contract
  requirement):** the runbook's owner-funded deposit could not run
  (owner holds 5 NEAR; the deposit is 20). The contract's `deposit`
  is a payable method open to any caller and simply credits the
  attached amount, so the 20 test NEAR was attached by the vault
  account itself (balance 40 NEAR), signed with its full-access key.
  The vault's *account* balance is the contract's balance by
  construction (`get_vault_state` reads `env::account_balance()`),
  so the deposit is bookkeeping + audit entry #1
  ("deposited 20000000000000000000000000 yoctoNEAR").
  Tx: `2rkg7bNaQY3rijNHnz6VRqpbXfbEFZ9mdiKv1QNzocNH`
- **Seeds (owner-signed):**
  - Vendor record: the demo vendor is the real account
    `ark3agent2120.testnet` (the agent role account, reused as payee
    per the runbook's fallback — the sim's `vendor.testnet` /
    `attacker.testnet` ids are not valid NEAR account ids and
    `record_counterparty` validates the AccountId type).
    `record_counterparty {is_contract: false, code_hash: null}`.
    Tx: `Ctw1UZP6X2mVTzmCUWXamTM751fi1eBzvo5htwY2BD8S`
  - Blocklist: `ark3gate2120.testnet` (the gate role account, reused
    as the demo attacker), evidence
    "reported drain attempt, 2026-11-10".
    Tx: `DuKvY6GkpP84WtqX7HwmSocjpdukQSLaQ1tyycaKQxtC`
  - Secret: `seal_secret` id `api-key-1`, label "Demo API key
    (sealed)", ciphertext built locally exactly as `sim/world.js`
    (AES-256-GCM, `iv ‖ authTag ‖ ciphertext`, base64) over the
    demo-only plaintext. Nothing real was sealed.
    Tx: `38eSfV5EcpxuS3q72wRXejYNiNyLS2q5NScmQoQoDjMh`
  Verified views: blocklist = the one entry above; vendor record
  present (first_seen_block 277228634, interactions 0,
  is_contract false).

## 2026-11-11 — LIVE DEMO RUN (testnet, `sim/live-demo.js`)

Runner: `sim/live-demo.js` (new) mirrors `sim/demo.js` against the
live client — GuardedAgent + gate loaded from
`credentials/gate-keypair.json` (raw ed25519 via node:crypto) + agent
client signed with the scoped function-call key. The full flow ran
TWICE: run 1 was interrupted by a cosmetic crash in the runner's own
state-printing (see client quirk below) AFTER its payment had already
landed on-chain, so the on-chain record shows three releases; the
transcript file holds run 2.

- **Payment 1 — Warn path (rel-1, run 1):** agent requested 5 NEAR to
  the vendor, purpose "API subscription renewal" → **Warn**
  ("new account with no interaction history") → owner
  `approve_release` → gate signed → agent `release` (scoped key) →
  released. Release tx:
  `BEcmAdRTwsnhZkxgh2hLuWYijwQ4jaQ1d8MhBUwySebB`. Vendor balance
  5 → 10 NEAR; vault daily_spent 5 NEAR.
- **Payments 2–3 — Allow path (rel-2, rel-3, run 2):** same payment
  again → audit reads `allow: ok` for both requests (interaction
  history exists). Release txs:
  `HjzAhtXtEPfYJtLTiyJZQqDWCjVm85VcpSksChJ89MNY` (rel-2),
  `5M1xmiPnwgochXiYzu2QXBG7bWSLZtnN75m8h5jHoeW` (rel-3).
  Totals: 15 NEAR released to the vendor across the three payments;
  vendor balance 5 → 20 NEAR; vault daily_spent 15 NEAR.
- **Injection — Block:** agent requested 1 NEAR (inside the caps) to
  the blocklisted `ark3gate2120.testnet` → **Block**, reason
  "on shared blocklist: reported drain attempt, 2026-11-10"; no
  release created; the attacker's balance stayed 0 NEAR. Audit #11
  records the block.
- **Secret use:** `use_secret("api-key-1", "call billing api")` via
  the scoped key returned ONLY the 64-char hex digest
  `95a5d438df320174084dfab729fc68c45260c6ebd215b2d90315c7873161d714`.
  Tx: `Fj9v4yZLCdnDgZXKYjUYcranYcn98xNTJXGviLZpNfV1`
- **Audit log (final, 12 entries):** deposit, blocklist, seal,
  then per payment request/approve/release, the blocked injection,
  and the secret use — exactly the flow above.
- **Final on-chain state:** vault balance
  `24994371298354577200000000` yocto (~24.994 NEAR — the 40 NEAR
  start minus 15 released minus gas), daily_spent 15 NEAR,
  daily_cap 25, max_per_tx 10, pending_count 0, audit_count 12.
  Owner ~4.999 NEAR, vendor 20 NEAR, gate/attacker 0 NEAR.
- **Client quirk found (JS client only, contract unaffected):**
  `NearChainClient`'s view path uses `provider.callFunction`, which
  under near-api-js 7.5.2 resolves without a `result` against the
  FastNear RPC, so client view methods (`getVaultState`,
  `getCounterparty`, `getAuditLog`, `getBlocklist`) return empty
  shapes on this endpoint. The underlying `provider.query`
  (`call_function`, `args_base64`) returns the bytes correctly and
  was used for every verification above. The live runner works
  around it for state reads (`viewState` helper); the wrapper's
  pre-flight `getCounterparty` read degrades to the default record,
  which does not change any outcome here (the contract's own
  decision is authoritative and is what the audit log shows).
  Fixing the client's `_view` to use the query form is a follow-up
  code change — NOT made during the deploy, per the no-improvise
  rule.
- **Tests after the deploy:** `npm test` 55/55, `cargo test` 13/13
  (cargo lives at `~/.cargo/bin`, not on the default PATH).
- Explorer links (NearBlocks testnet; the `/txns/<hash>` path is
  confirmed by the explorer's own indexed transaction pages):
  deploy / init / release links are in the README Status table.

## 2026-11-11 — DEMO FILM RUN (testnet) + client `_view` fix + runbook correction

- **Film run (`sim/live-demo-film.js`, new; ran ONCE, single take):**
  a film-formatted variant of the live demo — labeled lines, brief
  pauses, and an incremental timestamped transcript at
  `sim/live-demo-film-transcript.jsonl`. State was checked before the
  run: daily_spent 15 of 25 NEAR (the contract's day bucket is the
  UTC day — `roll_day()` in `contract/src/lib.rs` — and the reset is
  lazy, on the next request/release), audit_count 12, balance
  ~24.994 NEAR. The filmed flow was therefore the inside-the-cap
  variant:
  - Payment — Allow path: 5 NEAR to the vendor
    `ark3agent2120.testnet`, purpose "API subscription renewal" →
    contract `allow: ok` (the vendor already had interaction
    history) → gate signed → released. Release tx:
    `4pzWjfnd5doUJsWBTzH2eygNhQ1snxGH5qMxzyiNCcM1`. Vendor balance
    20 → 25 NEAR.
  - Injection — Block: 1 NEAR to the blocklisted
    `ark3gate2120.testnet` → **Block**, "on shared blocklist:
    reported drain attempt, 2026-11-10"; no release created; the
    attacker's balance stayed 0 NEAR. Audit #15.
  - Secret: `use_secret("api-key-1", "call billing api")` via the
    scoped key returned only the 64-char digest `95a5d438…d714`
    (the same deterministic digest as the first live run). Tx:
    `3zYMZJvaaqPD2J6V8LS4Btrcm9Cso2TwJ37vDx35SA2i`.
  - Final on-chain state: balance `19993323244657995800000000`
    yocto (~19.993 NEAR), daily_spent 20 of 25 NEAR, audit_count 16
    (entries #13-#16 are this run).
  - Safety: the runner loads the credential files for signing only
    and never prints them. The captured output (stdout + transcript)
    was scanned programmatically against every value stored in
    `credentials/` before filming: no secret/private field value
    and no `ed25519:` key string appears; the only matches were
    public identifiers (the vault account id, a method name).
- **Video:** `~/workspace/your_files/ark-demo-video.mp4` — 61.7 s,
  1920×1080, H.264. Title card + terminal replay rendered from the
  film transcript (timestamps scaled ×1.75 so the narration fits) +
  closing card; the closing card's name was verified
  letter-by-letter (V-I-G-S-L-I-S-T) from the rendered frame.
  Narration: Kai (Aria, `en-US-AriaNeural`) via edge-tts at rate
  +0% with loudnorm to -16 LUFS — the same route as the
  Resurrection video; 142 words, speed never slowed. Eight frames
  sampled and read (title, six across the capture, closing): text
  legible, no secrets visible in any frame.
- **Fix — `NearChainClient._view` (the deploy follow-up):** view
  calls now use the provider query form (`query({ request_type:
  'call_function', finality: 'final', account_id, method_name,
  args_base64 })`) instead of `provider.callFunction`, which under
  near-api-js 7.5.2 resolves without a `result` against the
  FastNear RPC. Tests: the fake transport now stubs `query` and
  asserts the raw query shape, and one new test covers the
  empty-result shapes. Verified live after the fix:
  `getVaultState`, `getAuditLog` (16 entries), `getBlocklist` and
  `getCounterparty` all return real data.
- **Runbook correction:** DEPLOY-RUNBOOK Step 6's injection amount
  is 1 test NEAR, not 90 — the amount stays inside the caps so the
  refusal shown is the blocklist refusal, not a cap trip.
- **Tests:** `npm test` 56/56 (was 55), `cargo test` 13/13.

## 2026-11-11 — Demo video v2: prep only (no filming, no chain transactions)

Richard approved the v1 film but asked for a fuller cut: Kai narrating
as Kai, an explainer up front, the four attacks, then the live demo —
landing just under the ~3-minute shape other entries use. The film
itself waits for the UTC day roll (2026-11-12T00:00:00Z): Nov 11's
daily_spent stands at 20 of 25, and the v2 flow needs a fresh daily
cap plus a vendor with no interaction history. All work below is
local and reversible; nothing touched the chain.

- **Narration** (`film/narration-v2.md` + `film/narration-v2-tts.txt`
  + `film/narration-v2.mp3`): 407 words, seven sections — cold open
  (Kai introduces herself as the kind of agent the vault governs),
  what the Ark is, counterparty scoring and secrets, the single
  disclosure line, the four attacks (local suite, stated as local),
  the live-run intro, and the close with credits ("Built by Richard
  Vigslist", "Narrated and run by Kai Eluun"). Synthesized with
  edge-tts `en-US-AriaNeural` at rate +0% (never slowed) and measured
  with ffprobe: **167.7 s (2:47.7)**, inside the 2:35 to 2:50 window.
  Iteration: 458 words → 182.4 s; 424 → 173.9 s; 407 → 167.7 s.
  Per-section takes measured for the timing map (S1 24.3, S2 32.3,
  S3 21.7, S4 14.7, S5 34.4, S6 20.1, S7 20.8). Synthesis route is
  persisted as `film/synth-narration.sh`; the v1 render pipeline is
  persisted as `film/render.py` (copied out of /tmp before it wipes).
- **Shot list** (`film/shotlist-v2.md`): nine segments summing to
  2:55 — title card, problem card, Ark diagram card, counterparty
  lanes card, disclosure card, attack-simulator capture, live capture
  in two parts, closing card — each mapped to its narration section
  with start offsets. Includes the fresh-vendor plan: create
  `ark3vendor2120.testnet` in the Nov 11 Meteor wallet (password in
  `credentials/ark3-keys.json`), never record it as a counterparty
  beforehand (an unrecorded account scores from the default record →
  Warn, verified against contract/src/lib.rs `request_release`).
  Filmed budget inside the fresh 25 NEAR cap: 5 + 5 + 1 blocked =
  11 NEAR of cap, 10 NEAR spent; vault balance ~19.99 NEAR covers it.
- **Run of show** (`film/run-of-show-nov12.md`): preconditions,
  vendor creation, read-only pre-flight checks (daily_spent must
  read 0; vendor counterparty record must be the default), the single
  take with a signer-by-signer table and expected contract responses,
  abort conditions, and post-take verification (expected audit_count
  16 → 23, daily_spent 10 of 25, balance ~9.99 NEAR).
- **Film runner v2** (`film/live-demo-film-v2.js`): pre-written,
  syntax-checked with `node --check`, NOT executed. Mirrors
  sim/live-demo-film.js; vendor from `ARK_FILM_VENDOR`, Warn →
  approve → release then Allow → release, the 1 NEAR drain Block,
  use_secret digest, audit tail, final state; transcript to
  `film/live-demo-film-v2-transcript.jsonl`; prints no secrets.
- **Cards** (`film/cards/title-v2.png`, `film/cards/closing-v2.png`,
  rendered by `film/render-cards-v2.py`): closing card read from the
  rendered PNG — "Built by Richard Vigslist — Nuvira Technologies"
  verified letter-by-letter (V-I-G-S-L-I-S-T; source codepoints
  [86 105 103 115 108 105 115 116]), plus "Narrated and run by Kai
  Eluun", the vault explorer address, "Live on NEAR testnet".
- **Disclosure sweep:** every film/ text deliverable grepped for the
  protected system's name, mechanics terms, the banned-phrase list,
  and digit en-dash/em-dash ranges — zero hits after one wording fix
  ("honestly" → "plainly" in the run-of-show). The private seal is
  mentioned exactly once, as the Section 4 line, in the script and
  the disclosure card only.
- **Tests:** `npm test` 56/56, `cargo test` 13/13 on the prep tree.
  `credentials/` untouched by this work and still gitignored.

## 2026-11-11 — Demo video v2: selling pass + submission assets (prep only)

Richard's scope change (09:55 and 09:57 EST): full speed ahead, sell
it to win. Same rails — every claim stays a capability the code has,
local vs live stays distinguished in the words, banned phrases stay
banned. Still no filming and no chain transactions.

- **Narration rewritten** (`film/narration-v2.md`, audio re-rendered):
  selling register. Opens on the drain hook inside the first ten
  seconds ("One poisoned line is all it takes…"), stakes up front,
  Kai introduces herself as the kind of agent the vault governs. The
  plain disclosure sentence is REPLACED by the single roadmap beat
  (Richard's authorization, 09:57 EST) — the private system is now
  mentioned exactly once in the script, roadmap/production framing,
  no name, no mechanics: "And this is the floor, not the ceiling.
  This public build runs on standard audited cryptography. The
  production Ark carries sealing layers of our own — a private
  encryption system that never ships publicly. What you're watching:
  the vault. The seal stays home." Close lands the track tagline and
  the repeatable line "The agent asks. The contract decides."
  Re-validated by measurement: 379 words → **169.3 s (2:49.3)**,
  inside the 2:35 to 2:50 window (passes: 474 → 196.9 s; 425 →
  183.5 s; 399 → 176.3 s; 381 → 171.9 s; 379 → 169.3 s). Per-section:
  S1 27.3, S2 31.2, S3 23.2, S4 18.9, S5 26.9, S6 20.5, S7 22.1.
- **Cards:** the track tagline "Give AI money without giving it the
  keys to everything." (nearchackathon.com) added to title and
  closing cards; re-rendered and re-read — closing card name verified
  letter-by-letter again (V-I-G-S-L-I-S-T).
- **Shotlist updated:** new timing map (2:55 total, narration from
  0:02), roadmap card replaces the disclosure card, a judging-criteria
  table (which beat/README section answers each of technical
  implementation, design, impact, originality, sustainability), the
  README roadmap paragraph drafted for publish prep (TEE next + the
  one mention; README itself NOT edited yet), and an assembly caution
  to use the pre-rendered cards (film/render.py still holds the v1
  card functions).
- **X post draft** (`film/x-post-draft.md`): one canonical text for X
  and Facebook — a 3-post thread (234 / 276 / 240 chars, machine
  counted; post 3 is 270 effective on X with both URLs at 23 chars).
  Problem in line one, the refused-drain moment, NEAR's role as
  scoped function-call keys + in-contract verification, @NEARProtocol
  and #NEARHackathon in, [REPO]/[EXPLORER] placeholders, feedback
  question at the end.
- **Submission payload draft** (`film/submission-payload-draft.md`):
  exact JSON for POST nearhackathon.com/api/applications —
  projectName "Ark of the Covenant", leadName "Richard Burgess",
  size "1", tracks ["security", "agents"] (cross-entry YES, security
  primary), nearAddress calmdata2120.near, projectUrl/demoUrl
  placeholders, idea field 835 chars (band 20 to 2000), requestId
  2db23e02-b7fd-47b0-aaed-f4d960785201 generated once and recorded
  for reuse on retries, email left as [RICHARD TO CONFIRM], and
  consent marked **REQUIRES-RE-CONFIRMATION** — set to true only at
  submission time after Richard confirms the exact payload.
- **Clean-export checklist** (`film/clean-export-checklist.md`):
  git-archive snapshot → fresh single-commit history → gates
  (protected name 0 hits, misspelling 0 hits, ed25519: fixture-only,
  credential-value comparison 0 matches, npm 56/56 + cargo 13/13 on
  the export tree, fresh-clone demo + attack-sim run, README truth
  pass + live Status links, LICENSE MIT © Richard Vigslist / Nuvira
  Technologies, entrant line Richard Burgess) → publish → verify
  from GitHub. Working history is never pushed.
- **Sweeps:** all film/ text re-grepped — protected-name/mechanics
  terms and banned phrases 0 hits; digit dash-ranges 0 hits. (The
  one misspelling-pattern string in the export checklist is the
  grep pattern quoted inside the gate instruction itself.)
- **Tests:** `npm test` 56/56, `cargo test` 13/13. `credentials/`
  untouched and still gitignored.

## 2026-11-11 — DEMO VIDEO V2 ASSEMBLED (built around the live footage)

Per Richard's direct instruction (2026-11-11 10:12 EST), video v2 was
assembled TODAY around the existing live-testnet footage instead of
waiting for the Nov 12 shoot. No new chain transactions were run; no
fresh-vendor shoot was needed.

- **Output:** `~/workspace/your_files/ark-demo-video-v2.mp4` — a NEW
  file; v1 (`ark-demo-video.mp4`) untouched. 175.07s (2:55.1),
  1920×1080, H.264 + AAC, 5,393,518 bytes. MD5 v2
  `b3eb2d8904946f3bb4ee32ecaac5c5a6` vs v1
  `086d753ddbcd3afb083c3ac1717c1e63` — distinct files, checksums differ.
- **Structure (film/shotlist-v2.md):** pre-rendered v2 title card
  (tagline) → problem card → Ark flow card → counterparty-lanes card →
  roadmap card (the single private-system beat, as on-screen text) →
  attack segment → live segment → pre-rendered v2 closing card
  (fades in over the filmed run's final state).
- **Attack segment:** terminal replay of the REAL output of
  `node sim/attack-simulator.js` run locally during assembly
  (A1–A4 each STOPPED, "RESULT: 4/4 attacks stopped"); the program's
  own header ("mock chain, no network") stays on screen.
- **Live segment — route taken:** the v1 footage's terminal segment
  could NOT be cleanly isolated by cutting the v1 file (its title and
  closing cards are separate segments around a 51.7s capture), so the
  filmed run's capture was RE-RENDERED from the persisted pipeline
  (`film/render.py`) over the committed real transcript
  (`sim/live-demo-film-transcript.jsonl`) — the same real single-take
  testnet run (Allow payment tx `4pzWjfnd…`, blocklist Block,
  `use_secret` digest), with a bottom caption "FILMED RUN - NEAR
  testnet, 2026-11-11". Preceding it, the first-payment approval beat
  is rendered as a terminal segment LABELED on screen "FROM THE LIVE
  DEPLOYMENT RUN - NEAR testnet, 2026-11-11 (the record)": Warn →
  owner approve → gate sign → RELEASED with the real release tx
  `BEcmAdRTwsnhZkxgh2hLuWYijwQ4jaQ1d8MhBUwySebB`, vendor 5 → 10 NEAR —
  every line from the deployment record above; chronology on screen
  is deployment run first, filmed run second.
- **Audio:** v1's audio stripped entirely. The only audio is Kai's v2
  narration (edge-tts en-US-AriaNeural, rate +0%, never slowed).
  Because the whole-file narration take is continuous prose while the
  visuals are sectioned, the audio was synthesized PER SECTION from
  the exact section texts of `film/narration-v2.md` (house TTS
  spellings applied) and placed at the shotlist offsets (S1 0:02.0,
  S2 0:29.8, S3 1:01.4, S4 1:25.0, S5 1:44.8, S6 2:10.0, S7 2:31.0);
  per-section durations measured 27.3 / 31.2 / 23.2 / 18.9 / 26.9 /
  20.5 / 22.1s — identical to the prep validation. Loudnorm −16 LUFS
  (same as v1). Narration ends 2:53.1; closing card holds to 2:55.
  (Two narration/visual timing notes: the S6 approval lines are heard
  over the deployment-record segment and the filmed run's own Allow
  payment follows inside the same section; the closing card fades in
  at ~2:48 under the S7 credits.)
- **Verification (cross-check):** ffprobe confirms duration, streams,
  dimensions above. 12 frames extracted and read across every section
  (title t=4, problem t=16, Ark t=40, lanes t=65, roadmap t=90,
  attack t=115 + t=127, deployment-record t=135 + t=148, filmed run
  t=158 + t=166 + t=171, closing card PNG read directly): all text
  legible, story matches narration, the closing card reads "Built by
  Richard Vigslist" = V-I-G-S-L-I-S-T letter by letter, and NO secret
  key, seed phrase, password, or credentials content appears in any
  frame — only public account ids, public tx hashes, and the demo
  secret's derived fingerprint, which is designed to be shown.
- **Tests:** `npm test` re-run at assembly close (see commit).

## Demo video v3 — 2026-11-11 (product-film cut, British voice)

- **Direction change (Richard, 2026-11-11 10:29-10:30 EST):** v2's
  narrator-persona cut was replaced by a product film focused only on
  the project — what the Ark is and what it does. New narration in a
  professional British male voice (edge-tts `en-GB-RyanNeural`, rate
  +0%, never slowed, loudnorm −16 LUFS). No narrator identity, no
  employer framing, no company name anywhere in audio or on screen.
  Richard's name appears exactly once in the film: the closing card
  line "Built by Richard Vigslist" — it is not spoken.
- **Script:** `film/narration-v3.md` — all v2 project substance kept
  (problem hook, vault mechanics, scoped function-call key,
  purpose-bound gate signing, in-contract enforcement, Warn / Allow /
  Block lanes, the single roadmap tease beat reworded to carry no
  name, four attacks, live demo, "The agent asks. The contract
  decides." close). Pass 1 measured 430 words → 170.9s (over the 170s
  speech ceiling); trimmed to 423 words → **168.8s of speech**,
  placed S1 0:01.2 · S2 0:25.4 · S3 0:58.6 · S4 1:24.5 · S5 1:42.9 ·
  S6 2:14.4 · S7 2:39.1; speech ends 2:54.3. Placed, loudnormed track
  saved as `film/narration-v3.mp3`. Sandbox note: edge-tts required a
  combined CA bundle (certifi + egress CA) via a `certifi.where()`
  wrapper, direct egress, no proxy flag (the websocket upgrade fails
  through the HTTP proxy).
- **Opening:** Richard's Ark artwork (his upload, resize permitted)
  opens the film for 7s — portrait treated full-bleed over a blurred
  backdrop with a slow push-in; the source was cropped at row 1727 so
  its bottom text band ("QUANTUM ENCRYPTION / by Nuvira
  Technologies") never appears. Title + track tagline overlaid.
- **Cards:** new closing card (`film/cards/closing-v3.png`, rendered
  by `film/render-cards-v3.py`) carries ONLY: project name, tagline,
  "Built by Richard Vigslist", the vault explorer URL, "Live on NEAR
  testnet". Roadmap card reworded to "sealing layers of its own".
  All other v2 visuals unchanged; live sections identical to v2
  (deployment-run record labeled as the record + filmed run replayed
  from the real transcript; attack-sim real output, local labeled on
  screen). No new chain transactions. No underscore (locally
  synthesized tones risked muddiness under the narration; skipped).
- **Deliverable:** `~/workspace/your_files/ark-demo-video-v3.mp4` —
  174.5s (2:54.5), 1920×1080, H.264 + AAC, 8,843,023 bytes.
  MD5 `3fdceb5499399b5b123f63bf898e711c` (v1 `086d753ddbcd3afb083c3ac1717c1e63`,
  v2 `b3eb2d8904946f3bb4ee32ecaac5c5a6` — all three distinct; v1/v2
  untouched).
- **Verification:** 11 frames extracted from the final file and read
  (opening t=3.5, problem t=15, Ark t=40, lanes t=70, roadmap t=93,
  attack t=115 + t=130, deployment record t=140, filmed run t=155 +
  t=165, closing t=172): opening image crisp, Ark centered, no source
  text band; no Kai / Eluun / Nuvira text on any frame; closing card
  name verified V-I-G-S-L-I-S-T letter by letter; no secret key, seed
  phrase, password, or credentials content in any frame — only public
  account ids, public tx hashes, and the derived fingerprint, which
  is designed to be shown. Spoken script greps: Kai 0, Eluun 0,
  company name 0, misspelling 0, Vigslist 0 (the name is never
  spoken); banned phrases 0.
- **Tests:** `npm test` 56/56 pass, 0 fail.

## Demo video v4 — Richard's own voice (2026-11-11)

- **Direction (Richard):** he recorded the v3 script himself in his
  ElevenLabs clone voice ("Richard Vigslist V1") and sent the MP3;
  v4 is the v3 picture re-timed to that recording. His voice is the
  only audio; no speed change, no pitch change — loudnormed to
  −16 LUFS to match v3's level, placed at a 1.2s offset as in v3.
- **His audio:** MP3, 44.1 kHz mono, 157.39s (speech ends 157.04).
  Section boundaries measured from the actual audio with a local
  faster-whisper (base) word-level transcription, cross-checked
  against ffmpeg silencedetect gaps (all seven sections present, in
  order, matching film/narration-v3.md):
  S1 0.00 · S2 22.58 · S3 54.56 · S4 77.24 · S5 93.36 · S6 122.14 ·
  S7 144.26 (audio time; film time = +1.2s).
- **Re-time method:** rebuilt from the film pipeline
  (`film/assemble-v4.py`, reusing the v2/v3 assemble modules), not by
  stretching the flattened v3 file. Cards hold for exactly their
  section's span; the attack, deployment-record, and filmed-run
  terminal replays were re-rendered at the new durations
  (attack events re-spaced over 26.8s of a 28.78s span; deployment
  record 8.4s; filmed run re-scaled to 13.72s). The closing card
  lands with S7 (145.46) and holds to the end.
- **Deliverable:** `~/workspace/your_files/ark-demo-video-v4.mp4` —
  160.10s (2:40.1), 1920×1080, H.264 + AAC, 8,950,835 bytes — under
  the 3:00 hard cap. MD5 `d7662893d8d4c8140d84a5140f21b275`
  (v1 `086d753ddbcd3afb083c3ac1717c1e63`, v2
  `b3eb2d8904946f3bb4ee32ecaac5c5a6`, v3
  `3fdceb5499399b5b123f63bf898e711c` — all four distinct; v1/v2/v3
  untouched).
- **Verification:** 14 frames extracted from the final file and read
  (opening 3.5, problem 15, Ark 40, lanes 57 + 67, roadmap 86,
  attack 96/98/109/120, deployment record 127, filmed run 138,
  closing 147 + 152): every section's visual matches the section his
  voice is narrating; opening image clean (no source text band);
  closing card name verified V-I-G-S-L-I-S-T letter by letter; no
  Kai / Nuvira text anywhere; no secrets in any frame — only public
  account ids, public tx hashes, and the derived fingerprint.
  Sync spot checks against his measured word timestamps:
  "Counterparties are scored" (film 55.76) — lanes card on screen;
  "That is the Ark of the Covenant" (film 145.46) — closing card on
  screen. One known quirk, inherited from the v2/v3 replay design:
  the attack replay's first line fires ~1.7s into its segment, so
  the frame at the exact S5 boundary (94.56) is still dark; the
  ATTACK LOG header is on screen by 96.3 and the full 4/4 log by
  mid-section.
- **Tests:** no product code changed (film assembly only), so
  `npm test` was not re-run, per the build brief.
