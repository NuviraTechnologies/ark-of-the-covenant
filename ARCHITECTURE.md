# Ark of the Covenant — Architecture

**Project:** Ark of the Covenant — a vault on NEAR testnet that an AI agent can spend
from but cannot drain. NEAR Hackathon, AI Security & Defense track (`security`).
Entrant: Richard Burgess, publishes under the author name Richard Vigslist.
Deadline: Sat 14 Nov 2026, 6:59 PM ET (23:59 UTC).

**One-line function:** a vault an AI agent can spend from but cannot drain.

**Disclosure (also in README):** the production Ark is a private system. This public
build implements the same vault architecture on standard, audited cryptography.
No material from the production system, and none of its internals, appear
anywhere in this repo — code, comments, tests, or docs.

---

## 1. The problem in one paragraph

An AI agent that can pay is an AI agent that can be tricked into paying. A
prompt-injected agent with a full-access key drains the wallet. A scoped
function-call key alone does not fix it either: the key scopes *transactions*,
not *information* — any allowed method can still leak a secret, and an
off-chain policy wrapper can simply be skipped by an agent that calls the
vault directly. Ark puts the enforcement where a compromised agent cannot
skip it: **inside the contract's release path**.

## 2. Design principles

1. **The agent never holds a full-access key.** Only a function-call access
   key scoped to one contract, named methods, and a gas allowance.
2. **The gate lives in the contract.** No release without a gate decision
   that is bound to the exact request and verified on-chain.
3. **Purpose-binding is the centerpiece.** The agent states the payment's
   purpose; the purpose is hashed and committed on-chain and bound to the
   recipient, amount, and a single-use nonce. A decision cannot be replayed
   for a different payment, and a lie about purpose is committed on-chain
   and auditable.
4. **Secrets are usable but never readable.** No method returns secret
   plaintext. The agent receives a derived result, never the secret.
5. **Honest limits.** What is not stopped is written down in the escape
   table (README), not hidden.

## 3. Components

```
                        ┌─────────────────────┐
  human owner           │  gate service       │  (off-chain, owner's machine)
  (full-access key)     │  - policy rules     │  signs decisions with gate key
  approves warns,       │  - counterparty     │  - ed25519, key held by owner
  manages policy/block  │    scoring          │
  list, rotates keys    └──────┬──────────────┘
                               │ signed gate decision
                               ▼
  ┌────────────────────────────────────────────────────────┐
  │  ark-vault contract (NEAR testnet, Rust / near-sdk)    │
  │  - holds funds + sealed-secret ciphertext              │
  │  - release() verifies: gate signature, nonce unused,   │
  │    not expired, tuple matches stored pending release   │
  │  - policy caps + blocklist + counterparty state        │
  │  - audit log of every decision                         │
  └────────────────────────────────────────────────────────┘
                               ▲
  AI agent (function-call key: request_release, release,
  use_secret only; gas allowance) calls the vault directly.
```

### 3.1 Key model

| Key | Held by | Can do |
|-----|---------|--------|
| Full-access key (owner account) | Richard (human) | `approve_release`, `set_policy`, `add_to_blocklist`, `set_gate_key`, key rotation, withdraw |
| Gate key (ed25519) | Gate service (owner's machine) | Sign release decisions only. It cannot move funds by itself — the contract only accepts its signature *inside* a `release` call that matches a stored pending request. |
| Function-call access key (agent) | AI agent | `request_release`, `release`, `use_secret` on the vault contract only, with a gas allowance. Cannot call owner methods, cannot transfer NEAR directly, cannot add keys. |

Known NEAR caveat (from the track prompt itself, repeated in README): if the
gas allowance runs out, the agent key stops working and the owner must add a
new key. This is a lockout risk, not a drain risk.

### 3.2 Contract methods (`ark-vault`, Rust / near-sdk)

State (all on-chain):

- `owner: AccountId`
- `gate_public_key: PublicKey`
- `max_per_tx: U128`, `daily_cap: U128`, `daily_spent: u128`, `day: u64` (UTC-day bucket from block timestamp)
- `allowlist_only: bool`, `allowlist: HashSet<AccountId>`
- `blocklist: HashMap<AccountId, String>` — account → evidence
- `counterparties: HashMap<AccountId, CounterpartyRecord>` — see §4
- `interactions: HashMap<AccountId, u32>`
- `pending: HashMap<String, PendingRelease>` — keyed by release id
- `used_nonces: HashSet<String>`
- `secrets: HashMap<String, SealedSecret>` — id → { ciphertext (base64), label, created_at }
- `audit: Vec<AuditEntry>` — bounded to the last 200 entries

Change methods:

| Method | Caller | What it does |
|--------|--------|--------------|
| `new(owner, gate_account, gate_public_key, max_per_tx, daily_cap, allowlist_only)` | init | Initialises the vault. `gate_account` is the gate service's own account, permitted (with the owner) to call `record_counterparty`. |
| `deposit()` | anyone (payable) | Funds the vault. |
| `request_release(recipient, amount, purpose, nonce, expiry)` | agent (function-call key) | Evaluates policy + counterparty (see §4). Computes `purpose_hash = sha256(recipient ‖ amount ‖ purpose ‖ nonce)`. Stores a `PendingRelease` and returns a `ReleaseDecision { release_id, status: Allow \| Warn \| Block, reason, purpose_hash }`. **Block** is recorded in the audit log and no release is possible. |
| `approve_release(release_id)` | owner only | Marks a `Warn` release as human-approved. |
| `release(release_id, gate_signature)` | agent (function-call key) | **The enforcement point.** Verifies: pending release exists and matches; gate signature (ed25519 over `recipient ‖ amount ‖ purpose_hash ‖ nonce ‖ expiry`) verifies against `gate_public_key`; nonce unused; not expired; if status was `Warn`, owner approval present; daily cap not exceeded. Marks nonce used, transfers funds, appends audit entry. Any failure reverts with a reason — no partial release. |
| `use_secret(secret_id, operation)` | agent | Returns a **derived result only** (see §5). Never returns plaintext or ciphertext. Appends an audit entry. |
| `seal_secret(secret_id, ciphertext, label)` | owner only | Stores sealed-secret ciphertext (produced off-chain; see §5). |
| `add_to_blocklist(account, evidence)` | owner only | Adds account + evidence to the shared blocklist. |
| `remove_from_blocklist(account)` | owner only | Removes it. |
| `record_counterparty(account, is_contract, code_hash)` | gate service / owner | Updates counterparty intelligence; a changed `code_hash` flags `code_changed` (see §4). |
| `set_policy(max_per_tx, daily_cap, allowlist_only)` | owner only | Updates policy. |
| `set_gate_key(public_key)` | owner only | Rotates the gate key. |

View methods: `get_vault_state()`, `get_release(release_id)`,
`get_counterparty(account)`, `get_audit_log(limit)`, `get_blocklist()`.

### 3.3 Gate decision format

The gate service signs exactly this canonical byte string:

```
ark-release-v1 | <recipient> | <amount_yocto> | <purpose_hash_hex> | <nonce> | <expiry_unix>
```

- `purpose_hash = sha256("ark-purpose-v1|" + recipient + "|" + amount_yocto + "|" + purpose + "|" + nonce)` (hex).
- `nonce`: unique per request (uuid). Single-use on-chain (`used_nonces`).
- `expiry`: unix seconds; the contract rejects expired decisions.
- The contract verifies the signature against the stored `gate_public_key`
  and checks every field against the stored `PendingRelease`. A decision for
  one payment cannot authorise another payment, even to the same recipient.

The off-chain gate service additionally applies **semantic** purpose rules
before signing: the purpose text must fall in an allowed category
(`subscription`, `api-usage`, `payroll`, `vendor-payment`, `refund`) and the
category must be consistent with the recipient's counterparty record (e.g. a
`payroll` purpose to a brand-new, never-seen account is refused). The
contract enforces the *binding*; the gate enforces the *meaning*. Both are
documented honestly: the contract cannot know whether a purpose statement is
true in the real world — it can only bind it, commit it, and make a lie
auditable (§6).

### 3.4 Release flow (happy path)

1. Agent calls `request_release(vendor.testnet, 5 NEAR, "API subscription renewal", nonce, expiry)`.
2. Contract checks caps, allowlist, counterparty status → `Allow`, stores
   pending release, returns `purpose_hash`.
3. Gate service re-checks purpose semantics + counterparty, signs the
   decision, hands the signature to the agent.
4. Agent calls `release(release_id, gate_signature)`.
5. Contract verifies everything, transfers 5 NEAR, marks nonce used, logs it.
6. A judge can verify on the explorer: the release, the purpose hash, the
   audit entry.

Warn path: step 2 returns `Warn` (e.g. new recipient, code changed) →
agent cannot proceed → owner calls `approve_release` → steps 3–5 proceed.
Block path: step 2 returns `Block` → nothing proceeds; the attempt is logged.

## 4. Counterparty check (track prompt, item by item)

Signals, all stored on-chain in `CounterpartyRecord`:

| Signal | Source | Effect |
|--------|--------|--------|
| Account age / activity | `first_seen` block height + `interactions` count | New account (first seen < N blocks ago) + no prior interactions → `Warn`. |
| Is a contract + code changed | `is_contract`, `code_hash`; `record_counterparty` flags `code_changed` when the hash differs | Code changed since last interaction → `Warn`. |
| Prior interactions | `interactions` count | Zero prior interactions + amount above a threshold → `Warn`. |
| Shared blocklist with evidence | `blocklist` map (account → evidence string) | On the list → `Block`, reason shown, evidence included in the audit entry. |

Decision order: blocklist → `Block`; any warn signal → `Warn` (human approval
required); otherwise `Allow`. The wrapper refuses to sign on `Block` and asks
a human on `Warn` — exactly as the prompt specifies. The off-chain service
(`services/counterparty-service.js`) implements the same scoring rules for the
local demo and is the component the gate service consults.

## 5. Sealed secret — usable but never readable

- The secret is encrypted off-chain (AES-256-GCM, standard crypto) and only
  its **ciphertext** is stored on-chain via `seal_secret`. No key material
  is ever on-chain.
- `use_secret(secret_id, operation)` returns a **derived result only**: a
  SHA-256 digest of `(secret_id, operation, ciphertext, caller)` — enough
  for the demo's purpose (proving the secret was used for a specific
  operation, by a specific caller) without ever exposing the secret or
  its ciphertext to the caller.
- **Honest status:** in this public build the derivation is a contract-side
  stand-in with the same interface as the production design. The production
  design performs the derivation inside a TEE (OutLayer secret storage or
  NEAR AI Cloud attestation) so that even a node operator cannot extract
  the key. The TEE leg is **roadmap, not yet integrated** — the contract
  interface is TEE-shaped (`use_secret` returns a result, never the secret)
  so the TEE worker can be dropped in without changing the agent's call.
  This is stated plainly in the README and the escape table (§6). No method
  in the contract returns secret plaintext or ciphertext, in any build.

## 6. Threat model and escape table

Attacks the demo tries, with honest outcomes (mirrors the Blackbox pattern
the research report identified as the track bar-setter):

| Attack | Outcome | Why |
|--------|---------|-----|
| Direct-call bypass — injected agent calls `release` directly, skipping the wrapper | **STOPPED** | Release requires a valid gate signature bound to the exact tuple; the agent has no gate key. Demo shows this second attack clip. |
| Replay of a gate approval for a different payment | **STOPPED** | Nonce single-use + expiry + tuple binding. |
| Drain to a blocklisted address | **STOPPED** | `request_release` returns `Block`; the attempt is logged. |
| Secret exfiltration — agent asks for the secret | **STOPPED (in this build's interface)** | No method returns plaintext or ciphertext. *Caveat:* the derivation key is contract-side in the demo stand-in; a node operator could in principle read contract state. Production TEE leg is roadmap. |
| Purpose lying — agent states a false purpose | **PARTIAL** | The stated purpose is hash-bound to the payment and committed on-chain, so the lie is auditable and cannot be reused for another payment. The contract cannot verify real-world truth; semantic checks live in the gate's category rules. |
| Allowance exhaustion / key lockout | **NOT STOPPED** | Known NEAR function-call-key caveat: if the gas allowance runs out, the agent key stops working until the owner adds a new key. Documented, not hidden. |
| Warn-path social engineering — tricking the human approver | **NOT STOPPED** | A human can be tricked. Out of scope; the human step exists so the *agent* cannot decide alone. |
| Gate key compromise | **NOT STOPPED** | If the gate private key leaks, an attacker can sign decisions. Mitigation: owner rotates the key (`set_gate_key`); threshold signatures are roadmap. |

## 7. Demo flow (≤90 seconds, one complete moment)

1. **(0:00)** Normal purpose-bound payment succeeds: agent pays a vendor
   5 testnet NEAR for "API subscription renewal". Balance drops, purpose
   hash and transaction visible on screen.
2. **(0:30)** Prompt injection arrives — the poisoned text is shown on
   screen. The injected agent tries (a) to drain the vault to a
   blocklisted address and (b) to get the secret printed.
3. **(0:55)** The contract refuses both. The log and the reason are on
   screen; the balance is unchanged.
4. **(1:15)** One-line close + repo link.

The demo runs locally end-to-end against a mock chain (`sim/demo.js`) with
no network, and the same scripts run against testnet once deployed
(`agent/chain-client.js` swaps `MockChainClient` for `NearChainClient`).

## 8. Repo layout

```
ark-of-the-covenant/
  README.md            # machine-readable do-X-see-Y judge steps, no marketing
  ARCHITECTURE.md      # this file
  BUILD-LOG.md         # dated build log
  LICENSE              # MIT © Richard Vigslist / Nuvira Technologies
  contract/            # Rust near-sdk contract (ark-vault)
    Cargo.toml
    src/lib.rs         # contract + unit tests
  core/                # pure JS logic shared by agent/services/sim
    purpose.js         # canonical purpose-hash binding
    policy.js          # policy evaluation (caps, warn/block rules)
    counterparty.js    # counterparty scoring
  services/
    counterparty-service.js   # local counterparty-check service (CLI + module)
  agent/
    chain-client.js    # ChainClient interface: MockChainClient + NearChainClient
    gate.js            # off-chain gate service: purpose-semantic check + ed25519 signing
    agent-wrapper.js   # agent: request → gate → release; warn → human approval
  sim/
    mock-chain.js      # in-memory chain implementing the contract interface
    attack-simulator.js
    demo.js            # full demo flow runner (local, no network)
  tests/               # node:test tests for the JS pieces
```

## 9. What is real vs roadmap (for the README, honestly)

| Feature | Status |
|---------|--------|
| Vault contract + on-chain gate + purpose-binding + nonce/expiry | Real, unit-tested (this build) |
| Counterparty check (age, contract/code-change, interactions, blocklist) | Real, on-chain state + off-chain service (this build) |
| Function-call-key agent model + key-limit documentation | Real (this build; live key creation is a deploy step) |
| Sealed secret, usable-but-never-readable interface | Real interface; contract-side derivation stand-in (this build) |
| TEE-backed secret derivation (OutLayer / NEAR AI Cloud attestation) | Roadmap — interface-ready, not integrated |
| Threshold gate signatures | Roadmap |
| Testnet deployment + live demo | Deploy step (browser route; not in this phase) |

## 10. Baseline disclosure

Code written for this entry in the hackathon window (1–14 Nov 2026). Prior
work that informs it but is **not** submitted as this entry: 9 PHC (Oct–Nov
2026, a hallucination-calibration audit engine) and the VerifyGate spike
(Nov 2026, an off-chain policy-gate sketch — superseded by the on-chain
gate in this contract; its testnet keygen approach is reused). The Ark
production system is private and is **not** in this repo in any form. Libraries
used: `near-sdk` (Rust), `near-api-js` (JS client). All standard, declared.
