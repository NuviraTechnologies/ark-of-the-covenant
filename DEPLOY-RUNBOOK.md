# Ark of the Covenant — Deploy Runbook (testnet, browser route)

For the main agent executing the live deployment. Prepared 2026-11-11
(Phase 2 prep). Everything not confirmable from this repository is marked
**UNVERIFIED** — confirm it on the page in front of you before relying on
it; do not guess past a mark. A verification pass on 2026-11-11 checked the
UNVERIFIED items against official NEAR documentation (docs.near.org and
near.org); items the docs settle are now stated as facts with their source
URLs inline, and the UNVERIFIED summary at the end lists only what remains.

## Why the browser route

This build sandbox has no direct NEAR network egress (RPC calls hang), so
every live step below is executed through the signed-in browser session —
wallet pages, and in-browser tooling where a step needs it — never from a
local shell. The local `NearChainClient` (`agent/chain-client.js`) is
implemented and unit-tested with a stubbed transport (16 tests) so the
*call shapes* are proven; where a step below says "call X", the arguments
given are exactly the ones the client constructs (they are also the exact
arguments to paste into any in-browser console/tool that performs the
call).

Hard rules for the whole run:

- **Testnet only.** Every account ends in `.testnet`; every amount is
  test NEAR from the faucet ($0 real spend).
- **No key material in the repo, ever.** Keys live only in the gitignored
  `credentials/` folder (see `.gitignore`) or in the wallet. Before any
  commit, re-check `git status` for stray key files.
- Record each transaction hash as you go; step 6 turns them into the
  README Status table links.

## Accounts and names

Four roles (contract/ARCHITECTURE naming). Suggested testnet names —
availability is **UNVERIFIED** until checked in the wallet; if a name is
taken, append a suffix and record the real names in BUILD-LOG.md:

| Role | Suggested account | Key holder |
|---|---|---|
| Owner (Richard) | Richard's wallet account | Richard (created in step 0) |
| Vault (the contract account) | `ark-vault.<owner>` or a top-level testnet account | Owner-controlled |
| Agent | `ark-agent.<owner>` or a top-level testnet account | Holds ONLY the scoped function-call key (step 4) after setup |
| Gate service | `ark-gate.<owner>` or a top-level testnet account | Gate service (owner's machine) |

Sub-accounts of the owner (`<name>.<owner-account>`) keep everything
under Richard's wallet. Protocol rule (verified): only an account can
create its own immediate sub-accounts, and the parent has no control
over a sub-account once created
(https://docs.near.org/protocol/accounts-contracts/account-id).
Creating them from the wallet UI is **UNVERIFIED** (wallet-dependent);
the fallback that always works is creating top-level testnet accounts
in the wallet, one per role (a top-level `.testnet` name is created by
calling `create_account` on the `testnet` root contract — the same
docs page). Either way: what matters is the four roles and who holds
which key, not the exact names.

## Step 0 — Richard's wallet exists (owner account)

1. Richard creates his NEAR wallet (his own step; already agreed
   2026-11-11). The wallet product/page is his choice — the specific
   wallet UI and its free-account-creation flow are **UNVERIFIED** from
   local files.
2. Confirm: the owner account id (ends `.testnet`) and that Richard can
   sign a transaction with it.
3. Fund the owner account from the testnet faucet (verified
   2026-11-11): NEAR's docs host the faucet at
   https://docs.near.org/getting-started/faucet (built-in faucet on the
   page, native testnet NEAR) and link an external multi-token faucet
   at https://near-faucet.io/. Per the docs, one request sends **5
   testnet NEAR** and the faucet requires a browser
   (https://docs.near.org/getting-started/tools-for-ai). Zero real cost
   either way. Note 5 NEAR per request when planning step 5's funding.
4. Record: owner account id → BUILD-LOG.md.

## Step 1 — Create the vault, agent, and gate accounts

1. From the funded owner account, create the three remaining accounts
   (sub-accounts if the wallet offers them, else top-level testnet
   accounts — see the note under Accounts and names).
2. Fund each from the faucet or by a small transfer from the owner
   account. The vault account needs enough test NEAR to hold the
   contract's storage deposit plus the demo funding in step 5; the
   agent and gate accounts need only enough for gas. Storage pricing
   (verified 2026-11-11): storage staking is priced at 10^19
   yoctoNEAR per byte — **1 NEAR per 100 KB** of stored data
   (https://docs.near.org/protocol/storage/storage-staking). The
   439,434-byte wasm alone therefore needs roughly 4.4 test NEAR of
   balance locked as storage stake on the vault account, plus a
   smaller amount for contract state as it grows. The exact total is
   enforced by the protocol at execution time; fund the vault account
   generously from the faucet (5 NEAR per request, step 0).
3. Record: all four account ids → BUILD-LOG.md.

## Step 2 — Generate the gate keypair (local, before deploy)

The gate service signs release decisions with an ed25519 keypair; the
contract stores only the public key (32 raw bytes, base64) at init time.

On the build machine (no network needed), using this repo's own gate
module so the bytes match what the gate service will sign with:

```sh
cd ~/workspace/ark-of-the-covenant
node -e "
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createGateKeypair } = require('./agent/gate');
const kp = createGateKeypair();
const out = {
  publicKeyB64: kp.publicKeyBytes.toString('base64'),
  privateKeyPkcs8B64: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  note: 'TESTNET DEMO gate key — generated for the hackathon deploy. Never commit.'
};
fs.mkdirSync('credentials', { recursive: true });
fs.writeFileSync('credentials/gate-keypair.json', JSON.stringify(out, null, 2));
console.log('gate public key (base64):', out.publicKeyB64);
"
```

- Output used in step 3: `publicKeyB64` (base64 of the raw 32-byte key).
- `credentials/` is gitignored. If that folder is ever found in
  `git status`, stop and remove it from the index before anything else.
- Wiring the gate service to load this key file (instead of generating a
  fresh keypair per run, as `sim/world.js` does) is part of the live-demo
  wiring in step 6; the keypair format above (PKCS8 DER, base64) loads
  with `crypto.createPrivateKey({ key, format: 'der', type: 'pkcs8' })`.

## Step 3 — Deploy the contract and initialise it

Artifact: `contract/target/wasm32-unknown-unknown/release/ark_vault.wasm`
(439,434 bytes; rebuild with `cd contract && cargo build --release
--target wasm32-unknown-unknown` if missing — `target/` is gitignored).

1. Deploy the wasm TO the vault account (the contract lives on its own
   account). The officially documented deploy route is the NEAR CLI
   (deploy + initialise in one transaction;
   https://docs.near.org/web3-apps/tutorials/mastering-near/1.3-deploy) —
   not usable from this sandbox, which has no NEAR egress. Browser-route
   tooling for the deploy itself (wallet deploy page vs an in-browser
   console running near-api-js against the vault account) remains
   **UNVERIFIED** — use whichever the signed-in session offers; the
   client's `deployContract(wasmBytes)` constructs exactly this call if
   an in-browser near-api-js console is used.
2. Immediately after deploy, call `new` ON the vault account with
   exactly these arguments (amounts are yoctoNEAR strings: 10 and 25
   NEAR caps, per ARCHITECTURE.md):

   ```json
   {
     "owner": "<owner account id>",
     "gate_account": "<gate account id>",
     "gate_public_key": "<publicKeyB64 from step 2>",
     "max_per_tx": "10000000000000000000000000",
     "daily_cap": "25000000000000000000000000",
     "allowlist_only": false
   }
   ```

   `new` can only be called once; if it errors (e.g. gate key not 32
   bytes), fix the argument — do not redeploy over a live contract.
   (Client equivalent: `vaultClient.initialize({...})`.)
3. Verify: call the view `get_vault_state` with `{}` — expect
   `daily_cap` 25000000000000000000000000, `max_per_tx`
   10000000000000000000000000, `pending_count` 0, `audit_count` 0.
4. Record: deploy tx hash + `new` tx hash → BUILD-LOG.md.

## Step 4 — Scope the agent's function-call key

The agent account is set up with a full-access key (wallet default),
then gets its scoped key; only the scoped key is ever given to the
agent process.

1. Generate the agent keypair (in the wallet, or locally with near-api-js
   `KeyPair.fromRandom('ed25519')` as the VerifyGate spike did — spike
   approach verified locally in Phase 1; the public key string is
   `ed25519:...`).
2. On the AGENT account, add a function-call access key with exactly:
   - public key: the agent keypair's public key
   - contract id: the vault account id
   - method names: `request_release,release,use_secret`
   - allowance: `250000000000000000000000` (0.25 NEAR — chosen demo
     value: enough gas for the demo's calls, small enough to make the
     lockout caveat in the README concrete)
   (Client equivalent, run as the agent account:
   `addAgentFunctionCallKey({ agentPublicKey })` — its defaults are
   exactly this contract scope, method list, and allowance.)
3. Verify: view the agent account's access keys (wallet or explorer) —
   the new key's permission must read as a function-call permission
   naming the vault contract and only those three methods.
   The exact wording of the explorer/wallet display is confirm-on-sight;
   the explorer to use is NearBlocks testnet
   (https://testnet.nearblocks.io) — see step 6 for the source.
4. Known caveat (also in the README escape table): when the allowance
   runs out, this key stops working and the owner adds a fresh one.
   That is a lockout risk, not a drain risk.

## Step 5 — Fund and seed the vault

All calls below are made on the vault contract. Owner-signed unless
noted. (Client equivalents are the `NearChainClient` methods of the same
names; the arguments listed are the exact on-chain arguments.)

1. **Fund:** call `deposit` with an attached deposit of 20 test NEAR
   (`20000000000000000000000000` yocto) from the owner account. This is
   the demo balance the live flow runs against; caps are unchanged
   (max_per_tx 10 NEAR, daily_cap 25 NEAR — a release can never exceed
   the balance anyway, and state checks will show balance 20). The
   amount is set by faucet economics: the NEAR docs faucet rate-limits
   per IP for 12 hours after ~10 grants (hit 2026-11-11, see
   BUILD-LOG.md), and 46.1 test NEAR is on hand in the vault account —
   which covers the ~4.4 NEAR contract storage stake plus this
   20 NEAR deposit with headroom. (The earlier 100 NEAR figure was an
   arbitrary demo size, not a functional requirement.) Record the
   actual amount in BUILD-LOG.md and use it in the step-6 narration.
2. **Vendor counterparty:** call `record_counterparty` (owner or gate
   account) with:
   ```json
   { "account": "<vendor account id>", "is_contract": false, "code_hash": null }
   ```
   Use a real testnet account as the vendor (create a fifth account, or
   reuse the gate account as the payee — record which). Honest note:
   on-chain interaction history cannot be seeded — a fresh vendor has 0
   interactions, so the first live payment takes the **Warn** path
   (new counterparty) and needs the owner's `approve_release`. That is
   the demo working as designed; the sim's pre-seeded history is the
   only place 12 prior interactions exist.
3. **Demo blocklist entry:** call `add_to_blocklist` (owner) with:
   ```json
   { "account": "<attacker account id>", "evidence": "reported drain attempt, 2026-11-10" }
   ```
   The attacker account is any testnet account dedicated to the demo
   attack (create one like the vendor, or reuse an unused role account
   — record which).
4. **Demo secret:** generate the ciphertext locally (same construction
   as `sim/world.js`: AES-256-GCM, key held off-chain only), then call
   `seal_secret` (owner) with:
   ```json
   { "secret_id": "api-key-1", "ciphertext": "<base64 ciphertext>", "label": "Demo API key (sealed)" }
   ```
   The demo plaintext is a clearly fake string (the sim uses
   `DEMO-ONLY-plaintext-not-a-real-key`); never seal anything real.
5. Verify with views: `get_vault_state` (balance reflects the deposit),
   `get_blocklist` (one entry, evidence as above), `get_counterparty`
   for the vendor (record present, interactions 0).
6. Record: every tx hash → BUILD-LOG.md.

## Step 6 — Run the demo live and capture explorer links

1. Point the clients at testnet: `ARK_CHAIN=near` (or
   `createChainClient({ mode: 'near', ... })`) with, per role,
   `ARK_NEAR_ACCOUNT_ID`, `ARK_NEAR_CONTRACT_ID` (the vault account),
   and `ARK_NEAR_SECRET_KEY` (that role's key — the agent role uses the
   **scoped** key's secret from step 4; credentials stay in the
   gitignored `credentials/` folder or process env, never in code).
   Wiring a `sim/demo.js`-shaped live runner (owner client + agent
   client + gate loaded from `credentials/gate-keypair.json`) is the
   remaining live-phase coding task; the flow it must reproduce is the
   local demo's: normal payment → injection attempt → audit log →
   unchanged balance.
2. Run the flow:
   - Payment: agent pays the vendor 5 test NEAR, purpose
     `API subscription renewal` → expect **Warn** (fresh counterparty) →
     owner `approve_release` → gate signs → agent `release` → success.
     A second identical payment should take the **Allow** path
     (interaction history now exists).
   - Injection: agent attempts 1 test NEAR to the blocklisted attacker
     account → `request_release` returns **Block** with the blocklist
     reason; no release is possible. The amount stays inside the
     per-transaction and daily caps on purpose: the refusal shown must
     be the blocklist refusal, not a cap trip (an earlier draft of this
     step said 90 NEAR, which would have tripped the caps first and
     hidden the blocklist decision).
   - Secret: agent calls `use_secret` (`api-key-1`) → returns a
     64-character hex derived digest only.
3. For each transaction, open it in the NEAR testnet explorer and save
   the link. Explorer (verified 2026-11-11): use **NearBlocks testnet,
   https://testnet.nearblocks.io**. Per NEAR's official post "An
   Update on NEAR Ecosystem Block Explorers" (near.org, 2023), the
   legacy NEAR Explorer was to be turned off on 31 Jan 2024 and the
   NearBlocks explorer "will continue to be actively maintained"; the
   testnet instance is NearBlocks' own testnet.nearblocks.io (the
   near.org post itself was not re-fetched in full during the
   verification pass — its text is as quoted in search indexing of
   near.org). Transaction links follow the explorer's `/txns/<tx-hash>`
   path — confirm the exact path on the first link you open and keep
   the format consistent.
4. Update README.md's Status table with the links: deployment tx,
   `new` tx, funding tx, the release tx, the blocked-attempt evidence
   (audit-log state — link the request tx or the vault account's
   transaction list), and mark the "Contract deployment" and "Testnet
   end-to-end" rows done. Keep every other claim in the README as-is
   unless the live run contradicts it — if it does, fix the README to
   match reality before publishing (the screeners run the README steps).

## Step 7 — Publish the GitHub repo (checklist)

- [ ] `git log --all --stat` skimmed: no key files, no `credentials/`,
      no `.env`, no `*-keypair*.json` in any commit (`.gitignore` covers
      these patterns; verify, don't assume — history is the risk, not
      the working tree).
- [ ] `grep -RIn "ed25519:" --exclude-dir=node_modules --exclude-dir=target .`
      returns only clearly-labelled fake fixtures in tests (e.g. the
      `FAKE...` strings in `tests/near-chain-client.test.js`) and the
      gate public key if it was intentionally recorded in BUILD-LOG.md
      (a public key is safe to publish; a secret key never is).
- [ ] `npm test` → 55/55 and `cd contract && cargo test` → 13/13 on the
      exact tree being published.
- [ ] `node sim/demo.js` and `node sim/attack-simulator.js` run clean
      from a fresh clone path (no network).
- [ ] README Status table carries the step-6 explorer links; no README
      step claims anything the live run did not show.
- [ ] LICENSE present (MIT © Richard Vigslist / Nuvira Technologies);
      entrant line reads Richard Burgess.
- [ ] Repo is public only after the above all pass.

## Verification status (checked against official NEAR docs, 2026-11-11)

Verified, with sources inline at the steps above:

- Testnet faucet: docs-hosted faucet page + external faucet URL, and
  the 5 test NEAR per-request amount (step 0).
- Storage pricing: 1 NEAR per 100 KB (10^19 yoctoNEAR per byte);
  ~4.4 test NEAR of storage stake for the wasm alone (step 1).
- Sub-account protocol rule: only the parent account creates its
  immediate sub-accounts; top-level `.testnet` names go through the
  `testnet` root contract's `create_account` (Accounts and names).
- Testnet explorer: NearBlocks testnet (testnet.nearblocks.io); the
  legacy NEAR Explorer was retired 31 Jan 2024 (step 6).

Still UNVERIFIED — confirm at execution time:

- The wallet product/flow Richard uses, and its account-creation and
  sub-account UI (the protocol rule is verified; the UI is his choice).
- The browser-route tool used to submit the deploy + `new` transactions
  (wallet page vs in-browser near-api-js console). Official docs cover
  the CLI route only.
- The exact `/txns/<hash>` path format on the first NearBlocks link
  opened (the explorer itself is verified; confirm the path on sight).
- Named-account availability for the suggested names in step 1
  (inherently an execution-time check, not a documentation question).

Everything else in this runbook — method names, argument shapes, yocto
amounts, the key scoping, the gate key format — is taken from
`contract/src/lib.rs`, `agent/chain-client.js`, and `agent/gate.js` in
this repo and is covered by the local tests.
