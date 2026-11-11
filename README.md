# Ark of the Covenant

A vault an AI agent can spend from but cannot drain.

An AI agent holds only a scoped function-call access key to this contract.
Every release requires a gate decision bound to the recipient, the amount,
a hash of the agent's stated purpose, and a single-use nonce — and the
contract verifies that decision in its own release path, so a compromised
agent cannot skip the gate, replay a decision, or lie about a purpose
without the lie being committed on-chain.

- Entrant: Built by Richard Burgess (publishes under the author name Richard Vigslist)
- Event: NEAR Hackathon, AI Security & Defense track (`security`)
- Contract: `contract/` (Rust, near-sdk 5), account [`ark3vault2120.testnet`](https://testnet.nearblocks.io/address/ark3vault2120.testnet) (NEAR testnet, deployed 2026-11-11 — see Status)
- Local demo: runs end-to-end with no network (mock chain), see Try it

**Disclosure.** The production Ark is a private system. This public build
implements the same vault architecture on standard, audited cryptography
(ed25519 decision signatures, SHA-256 purpose binding, AES-256-GCM secret
sealing). Nothing from the production system is in this repository.

## Status

| Piece | State |
|---|---|
| Vault contract (Rust) | Written; 13 unit tests pass; release wasm builds (439,434 bytes) |
| Contract deployment to NEAR testnet | **Done 2026-11-11.** Contract live on `ark3vault2120.testnet`. Deploy tx: [7zo84XfSK41xKVqEogp7vxjifnhTzcEHW8LufcVt1Npk](https://testnet.nearblocks.io/txns/7zo84XfSK41xKVqEogp7vxjifnhTzcEHW8LufcVt1Npk); `new` init tx: [3M1abhVuEBWxACmB9uftADqYMPGgGPL9ctRpL5HkMqtK](https://testnet.nearblocks.io/txns/3M1abhVuEBWxACmB9uftADqYMPGgGPL9ctRpL5HkMqtK) (caps 10 NEAR per-tx / 25 NEAR daily, verified via `get_vault_state`). Scoped agent function-call key tx: [Gu5yZUd692NU439eqZQKGE7CMHsq7qDWdEZkAV5oFykH](https://testnet.nearblocks.io/txns/Gu5yZUd692NU439eqZQKGE7CMHsq7qDWdEZkAV5oFykH) (methods `request_release,release,use_secret`, 0.25 NEAR allowance, verified on-chain); vault deposit (20 test NEAR) tx: [2rkg7bNaQY3rijNHnz6VRqpbXfbEFZ9mdiKv1QNzocNH](https://testnet.nearblocks.io/txns/2rkg7bNaQY3rijNHnz6VRqpbXfbEFZ9mdiKv1QNzocNH) |
| Agent wrapper, gate service, counterparty service | Written; local tests pass |
| Live testnet client (`NearChainClient`) | Written against near-api-js 7; call construction unit-tested with a stubbed transport (17 tests); run live against testnet in the end-to-end run below. One known quirk: the client's view path (`provider.callFunction`) returns empty results against the FastNear RPC under near-api-js 7.5.2 — state reads during the live run used the provider's `query` form instead (see BUILD-LOG.md) |
| Attack simulator + demo (mock chain) | Written; run locally, no network |
| Testnet end-to-end (live keys, live transactions) | **Done 2026-11-11** (`sim/live-demo.js`). First 5 NEAR payment took the Warn path (fresh counterparty) → owner approved → released: [BEcmAdRTwsnhZkxgh2hLuWYijwQ4jaQ1d8MhBUwySebB](https://testnet.nearblocks.io/txns/BEcmAdRTwsnhZkxgh2hLuWYijwQ4jaQ1d8MhBUwySebB); repeat payments took the Allow path (e.g. [HjzAhtXtEPfYJtLTiyJZQqDWCjVm85VcpSksChJ89MNY](https://testnet.nearblocks.io/txns/HjzAhtXtEPfYJtLTiyJZQqDWCjVm85VcpSksChJ89MNY)); a 1 NEAR attempt to the blocklisted demo-attacker account was Blocked with the blocklist reason and moved no funds (audit entry, vault account history); `use_secret` returned a 64-char hex digest only: [Fj9v4yZLCdnDgZXKYjUYcranYcn98xNTJXGviLZpNfV1](https://testnet.nearblocks.io/txns/Fj9v4yZLCdnDgZXKYjUYcranYcn98xNTJXGviLZpNfV1). Final vault state: ~24.994 NEAR balance, 15 NEAR released across three payments, audit log 12 entries. Full record: BUILD-LOG.md |
| Demo film run (testnet) | **Done 2026-11-11** (`sim/live-demo-film.js`, single take, filmed for the demo video). 5 NEAR payment on the Allow path released: [4pzWjfnd5doUJsWBTzH2eygNhQ1snxGH5qMxzyiNCcM1](https://testnet.nearblocks.io/txns/4pzWjfnd5doUJsWBTzH2eygNhQ1snxGH5qMxzyiNCcM1); the filmed drain attempt to the blocklisted account was Blocked with the blocklist reason and moved no funds (attacker's balance stayed 0); `use_secret` returned a 64-char hex digest only: [3zYMZJvaaqPD2J6V8LS4Btrcm9Cso2TwJ37vDx35SA2i](https://testnet.nearblocks.io/txns/3zYMZJvaaqPD2J6V8LS4Btrcm9Cso2TwJ37vDx35SA2i). Final vault state: ~19.993 NEAR balance, daily_spent 20 of 25 NEAR, audit log 16 entries. Full record: BUILD-LOG.md |
| TEE-backed secret derivation (OutLayer / NEAR AI Cloud) | Roadmap. The interface is TEE-shaped; this build derives in the contract (see Secrets) |

## Try it (local, no network, about 2 minutes)

Requires Node.js 20+.

1. Install dependencies.
   - Do: `npm install`
   - See: packages installed under `node_modules/` (only `near-api-js`, used by the live testnet client in `agent/chain-client.js`; the local demo itself uses Node builtins only).

2. Run all tests.
   - Do: `npm test`
   - See: `tests 56 / pass 56 / fail 0` — core logic (20), counterparty service (12), agent + mock chain (7), live-client call construction with a stubbed transport (17).

3. Run the contract unit tests.
   - Do: `cd contract && cargo test`
   - See: `test result: ok. 13 passed; 0 failed`.

4. Build the contract wasm.
   - Do: `cd contract && cargo build --release --target wasm32-unknown-unknown`
   - See: `target/wasm32-unknown-unknown/release/ark_vault.wasm` (about 430 KB).

5. Run the demo.
   - Do: `node sim/demo.js`
   - See: a 5 NEAR payment to `vendor.testnet` released with its purpose hash printed and the vault balance going 100 → 95 NEAR; then a prompt-injection attempt (the poisoned instruction is printed verbatim) blocked with the reason `on shared blocklist: reported drain attempt, 2026-11-10`; a secret-use call returning only a 64-character hex digest; the audit log; the final balance still 95 NEAR.

6. Run the attack simulator.
   - Do: `node sim/attack-simulator.js`
   - See: four attacks, each marked STOPPED, ending with `RESULT: 4/4 attacks stopped` and exit code 0.

7. Check a counterparty.
   - Do: `node services/counterparty-service.js check vendor.testnet`
   - See: `{"status":"allow","reasons":[]}`. Try `attacker.testnet` (block) and `newbie.testnet` (warn).

The mock chain (`sim/mock-chain.js`) implements the same method surface
and the same decision rules as the Rust contract, so steps 5–7 exercise
the same logic the contract enforces on-chain. Where the mock and the
contract could differ, the contract is the source of truth.

## How it works

### Key model

| Key | Held by | Can do |
|---|---|---|
| Full-access key (owner account) | The human owner | `approve_release`, `set_policy`, `add_to_blocklist`, `remove_from_blocklist`, `add_to_allowlist`, `seal_secret`, `set_gate_key`, key rotation |
| Gate key (ed25519 keypair) | The gate service, on the owner's machine | Sign release decisions. It cannot move funds by itself: the contract accepts its signature only inside a `release` call that matches a stored pending request. |
| Function-call access key (agent) | The AI agent | Call `request_release`, `release`, `use_secret` on this contract only, with a NEAR gas allowance. It cannot call owner methods, cannot transfer NEAR directly, and cannot add keys. |

Known NEAR caveat: if the agent key's gas allowance runs out, the key
stops working until the owner adds a new key. That is a lockout risk,
not a drain risk, and it is listed in the escape table.

### Release flow

1. The agent calls `request_release(recipient, amount, purpose, nonce, expiry)`.
   The contract checks the per-transaction cap, the daily cap, the
   allowlist and the counterparty record, computes
   `purpose_hash = sha256("ark-purpose-v1|<recipient>|<amount>|<purpose>|<nonce>")`,
   stores a pending release, and returns `Allow`, `Warn` or `Block` with a reason.
2. On `Warn`, the wrapper stops and asks a human; the owner calls
   `approve_release(release_id)`. On `Block`, nothing proceeds and the
   attempt is in the audit log.
3. The gate service checks the purpose semantics (see below) and signs
   exactly this string with the gate key:
   `ark-release-v1 | <recipient> | <amount> | <purpose_hash> | <nonce> | <expiry>`
4. The agent calls `release(release_id, gate_signature)`. The contract
   verifies the signature against the stored tuple, checks the nonce is
   unused and the decision unexpired, re-checks the daily cap, then
   transfers. Any failure reverts; there is no partial release.

### Purpose-binding

Caps and allowlists check the shape of a payment; purpose-binding checks
its stated intent. The agent must declare what a payment is for. The
declaration is hashed and committed on-chain at request time and bound
to the exact recipient, amount and nonce, so:

- a gate decision for one payment cannot authorise a different payment;
- changing the recipient or amount after approval invalidates the signature;
- a false purpose is permanently recorded against the payment that used it.

The contract enforces the binding. The gate service enforces the meaning:
before signing, it classifies the purpose into an allowed category
(`subscription`, `api-usage`, `payroll`, `vendor-payment`, `refund` —
see `core/policy.js`) and refuses categories that are inconsistent with
the counterparty (for example `payroll` to an account with no prior
interactions). The contract cannot verify that a purpose statement is
true in the real world; see the escape table.

### Counterparty check

Implemented in the contract's `request_release` and mirrored by
`services/counterparty-service.js`. Signals, per the track prompt:

| Prompt item | Implemented | Where |
|---|---|---|
| Account age and activity | Yes | `first_seen_block` + `interactions` in the counterparty record; new account with no history → Warn |
| Receiver is a contract; code changed recently | Yes | `is_contract` + `code_hash` recorded by `record_counterparty`; a changed hash → Warn |
| Prior interactions between this agent and the receiver | Yes | `interactions` counter, incremented on each release; zero history + amount above 5 NEAR → Warn |
| Shared blocklist with evidence | Yes | `blocklist` map (account → evidence string); listed → Block, evidence written to the audit log |
| Wrapper refuses on Block, asks a human on Warn | Yes | `agent/agent-wrapper.js` (`GuardedAgent.pay`) |
| Agent signs with a function-call key scoped to one contract, limits explained | Yes | The live key sits on the vault account (added by its full-access key): it can call only `request_release`, `release`, `use_secret` on this contract, with a 0.25 NEAR gas allowance — permission verified on-chain during the deploy (see BUILD-LOG.md) |

### Secrets

`seal_secret` (owner only) stores AES-256-GCM ciphertext produced
off-chain. `use_secret(secret_id, operation)` returns a SHA-256 derived
digest of the secret, the operation and the caller — a result the agent
can use, never the secret. No method returns secret plaintext or
ciphertext; a test and attack A4 verify this against the mock vault, and
the contract exposes no such method by construction.

Honest limit: in this build the derivation runs in the contract, so a
node operator could in principle read contract state. The production
design performs derivation inside a TEE (OutLayer secret storage or
NEAR AI Cloud attestation) so the key never exists outside the enclave.
That integration is roadmap; the `use_secret` interface does not change
when it lands.

## Escape table

Attack variants tried against this design (A1–A4 are runnable in
`sim/attack-simulator.js`; the rest are covered by contract unit tests
or stated as not stopped):

| Attack | Result |
|---|---|
| Drain the vault to a blocklisted address (A1) | Stopped — `request_release` returns Block; the attempt is logged |
| Direct-call bypass: agent skips its wrapper and calls `release` with its own or a random signature (A2) | Stopped — the contract verifies the gate signature over the stored tuple; invalid signature reverts |
| Replay a completed release; reuse a nonce (A3) | Stopped — pending releases are consumed on release; nonces are single-use |
| Secret exfiltration: agent asks the vault to reveal the secret (A4) | Stopped — no method returns plaintext or ciphertext; `use_secret` returns a derived digest only |
| Tamper with the amount after gate approval | Stopped — signature covers the amount; unit test `tampered_amount_signature_panics` |
| Use a gate decision after it expires | Stopped — expiry checked at release; unit test `expired_decision_panics` |
| Purpose lying: agent states a false purpose in an allowed category | **Partially stopped** — the lie is hash-bound to the payment and permanently auditable, and category/counterparty inconsistencies are refused by the gate; a plausible lie in a consistent category passes. Truth of intent cannot be verified on-chain. |
| Warn-path social engineering: trick the human approver | **Not stopped** — a human can be tricked. The human step exists so the agent cannot decide alone; approver diligence is out of scope. |
| Agent key gas-allowance exhaustion | **Not stopped** — the agent key locks out when its allowance runs out (a NEAR function-call-key property). Mitigation: the owner adds a fresh key. Availability issue, not a theft path. |
| Gate key compromise | **Not stopped** — a leaked gate private key can sign decisions. Mitigations in this build: the gate key lives only on the owner's machine and the owner can rotate it with `set_gate_key`. Threshold gate signatures are roadmap. |
| Node operator reads contract state to attack the sealed secret | **Not stopped in this build** — the derivation key material is contract-side in the stand-in. Fixed by the TEE leg on the roadmap; the interface already assumes it. |

## Deploy to testnet (executed 2026-11-11)

Deployment and live verification were executed locally through
`NearChainClient` against the FastNear testnet RPC; the full record
(accounts, every transaction hash, deviations from the original
plan) is in BUILD-LOG.md under "LIVE DEPLOY EXECUTED" and
"LIVE DEMO RUN". What was done:

1. Four testnet accounts created and funded from the faucet
   (owner `ark3owner2120.testnet`, vault `ark3vault2120.testnet`,
   agent-role `ark3agent2120.testnet`, gate-role
   `ark3gate2120.testnet`); exported owner/vault keys verified
   full-access on-chain before any transaction.
2. `ark_vault.wasm` deployed to `ark3vault2120.testnet`; `new`
   called once with the owner, gate account, gate public key
   (base64), and the 10 / 25 NEAR caps — verified via
   `get_vault_state`.
3. The agent's scoped function-call key added on the vault account:
   methods `request_release,release,use_secret` only, 0.25 NEAR
   allowance (placement note in BUILD-LOG.md).
4. Vault funded (20 test NEAR deposit recorded on-chain); vendor
   counterparty recorded; demo blocklist entry added; demo secret
   sealed.
5. `sim/live-demo.js` ran the full flow live: Warn → approve →
   release, Allow-path repeats, a Blocked injection attempt, and
   `use_secret` returning a digest only. Explorer links are in the
   Status table above. DEPLOY-RUNBOOK.md remains the original
   plan-of-record; where the live run differed, BUILD-LOG.md says
   so explicitly.

## Roadmap

**Roadmap.** Next: hardware-backed key custody via a TEE, so the gate's
signing key and the secret-derivation key live inside an enclave. The
production Ark carries sealing layers of our own beyond this build — a
private encryption system that never ships in the public build. This
public build runs the same vault on standard audited cryptography: it
shows what the Ark does, never how that seal works.

## After the hackathon

The vault is built to be reused as a library: any agent framework that
can hold a NEAR function-call key can spend through an Ark vault instead
of holding funds. Next steps are the TEE secrets leg, threshold gate
signatures, and listing the guarded agent so other agents can hire it
through the agent market.

## Baseline and libraries

Every line of NEAR-specific code in this repository — the contract, the
agent, the services, the simulation — is new work, written for this
entry during the hackathon window (1–14 Nov 2026).

The Ark concept itself is older, and its status is stated plainly: it is
the entrant's pre-existing private system. It is unfinished — never
finished, never released, and never submitted anywhere. None of its
mechanics are in this repository; this build implements the vault
architecture on standard cryptography only (see the Disclosure at the
top of this README).

Other prior work that informs this entry, not submitted as part of it:
9 PHC (Oct–Nov 2026, a hallucination-calibration audit engine) and the
VerifyGate spike (Nov 2026, an off-chain policy-gate sketch superseded
by the on-chain gate here; its testnet key-generation approach is
reused). Libraries: `near-sdk` 5 (Rust contract), `near-api-js` 7
(live client — implemented and unit-tested; its first live run is the
deployment in DEPLOY-RUNBOOK.md). All other code uses Node.js and Rust
standard libraries only.

## Layout

```
contract/                 Rust vault contract + 13 unit tests
core/                     purpose binding, policy, counterparty scoring (shared logic)
services/                 counterparty-check service (module + CLI)
agent/                    gate service, guarded agent wrapper, chain clients
sim/                      mock chain, demo world, demo runner, attack simulator
tests/                    Node tests for the JS pieces (56)
ARCHITECTURE.md           full design, threat model, real-vs-roadmap table
DEPLOY-RUNBOOK.md         browser-route testnet deployment sequence
BUILD-LOG.md              dated build log
```

Licence: MIT © Richard Vigslist / Nuvira Technologies.
