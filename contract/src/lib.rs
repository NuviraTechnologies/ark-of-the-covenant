//! Ark of the Covenant — `ark-vault` contract.
//!
//! A vault an AI agent can spend from but cannot drain.
//!
//! - The agent never holds a full-access key; it calls this contract with a
//!   function-call access key scoped to `request_release`, `release` and
//!   `use_secret`.
//! - The policy gate is enforced INSIDE the release path: `release` only
//!   moves funds when presented with a gate decision (ed25519 signature)
//!   bound to recipient + amount + purpose-hash + nonce + expiry, verified
//!   on-chain against the stored pending release.
//! - Purpose-binding: the agent's stated purpose is hashed and committed
//!   on-chain at request time (`purpose_hash`), so a decision cannot be
//!   replayed for a different payment and a purpose lie is auditable.
//! - Sealed secrets are usable but never readable: no method returns secret
//!   plaintext or ciphertext; `use_secret` returns a derived digest only.
//!
//! Disclosure: the production Ark is a private system. This public build
//! implements the same vault architecture on standard, audited
//! cryptography. See the repository README and ARCHITECTURE.md.

use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise};
use std::collections::{HashMap, HashSet};

/// Counterparty scoring constants (mirror `core/counterparty.js`).
const NEW_ACCOUNT_MIN_BLOCKS: u64 = 100;
const WARN_AMOUNT_YOCTO: u128 = 5_000_000_000_000_000_000_000_000; // 5 NEAR
const AUDIT_LOG_MAX: usize = 200;
const SECONDS_PER_DAY: u64 = 86_400;

#[derive(Clone, PartialEq, Debug)]
#[near(serializers = [borsh, json])]
pub enum ReleaseStatus {
    Allow,
    Warn,
    Block,
}

#[near(serializers = [borsh])]
pub struct PendingRelease {
    pub release_id: String,
    pub recipient: AccountId,
    pub amount: u128,
    pub purpose: String,
    pub purpose_hash: String,
    pub nonce: String,
    pub expiry: u64,
    pub status: ReleaseStatus,
    pub human_approved: bool,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct CounterpartyRecord {
    pub first_seen_block: Option<u64>,
    pub interactions: u32,
    pub is_contract: bool,
    pub code_hash: Option<String>,
    pub code_changed: bool,
}

impl Default for CounterpartyRecord {
    fn default() -> Self {
        Self {
            first_seen_block: None,
            interactions: 0,
            is_contract: false,
            code_hash: None,
            code_changed: false,
        }
    }
}

#[near(serializers = [borsh])]
pub struct SealedSecret {
    pub ciphertext: String,
    pub label: String,
}

#[derive(Clone)]
#[near(serializers = [borsh, json])]
pub struct AuditEntry {
    pub seq: u64,
    pub block_height: u64,
    pub timestamp: u64,
    pub actor: AccountId,
    pub action: String,
    pub detail: String,
    pub decision: String,
}

#[near(serializers = [json])]
pub struct ReleaseDecision {
    pub release_id: Option<String>,
    pub status: ReleaseStatus,
    pub reason: String,
    pub purpose_hash: String,
}

#[near(serializers = [json])]
pub struct ReleaseReceipt {
    pub release_id: String,
    pub recipient: AccountId,
    pub amount: U128,
    pub purpose_hash: String,
}

#[near(serializers = [json])]
pub struct SecretUseResult {
    pub secret_id: String,
    pub operation: String,
    pub derived: String,
}

#[near(serializers = [json])]
pub struct VaultStateView {
    pub balance: U128,
    pub daily_spent: U128,
    pub daily_cap: U128,
    pub max_per_tx: U128,
    pub pending_count: u64,
    pub audit_count: u64,
}

#[near(serializers = [json])]
pub struct ReleaseView {
    pub release_id: String,
    pub recipient: AccountId,
    pub amount: U128,
    pub purpose: String,
    pub purpose_hash: String,
    pub nonce: String,
    pub expiry: u64,
    pub status: ReleaseStatus,
    pub human_approved: bool,
}

#[near(serializers = [json])]
pub struct CounterpartyView {
    pub account: AccountId,
    pub first_seen_block: Option<u64>,
    pub interactions: u32,
    pub is_contract: bool,
    pub code_changed: bool,
    pub blocklisted: bool,
    pub evidence: Option<String>,
}

#[near(serializers = [json])]
pub struct BlocklistEntry {
    pub account: AccountId,
    pub evidence: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ArkVault {
    owner: AccountId,
    gate_account: AccountId,
    gate_public_key: Vec<u8>, // 32-byte ed25519 public key of the gate service
    max_per_tx: u128,
    daily_cap: u128,
    daily_spent: u128,
    day_bucket: u64,
    allowlist_only: bool,
    allowlist: HashSet<AccountId>,
    blocklist: HashMap<AccountId, String>,
    counterparties: HashMap<AccountId, CounterpartyRecord>,
    pending: HashMap<String, PendingRelease>,
    used_nonces: HashSet<String>,
    pending_nonces: HashSet<String>,
    secrets: HashMap<String, SealedSecret>,
    audit: Vec<AuditEntry>,
    audit_seq: u64,
    release_counter: u64,
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// The canonical purpose hash: sha256 of
/// `ark-purpose-v1|<recipient>|<amount_yocto>|<purpose>|<nonce>`.
pub fn purpose_hash(recipient: &AccountId, amount: u128, purpose: &str, nonce: &str) -> String {
    let material = format!("ark-purpose-v1|{}|{}|{}|{}", recipient, amount, purpose, nonce);
    hex(&env::sha256(material.as_bytes()))
}

/// The canonical string the gate service signs:
/// `ark-release-v1 | <recipient> | <amount_yocto> | <purpose_hash> | <nonce> | <expiry>`.
pub fn gate_message(
    recipient: &AccountId,
    amount: u128,
    purpose_hash_hex: &str,
    nonce: &str,
    expiry: u64,
) -> String {
    format!(
        "ark-release-v1 | {} | {} | {} | {} | {}",
        recipient, amount, purpose_hash_hex, nonce, expiry
    )
}

#[near]
impl ArkVault {
    #[init]
    pub fn new(
        owner: AccountId,
        gate_account: AccountId,
        gate_public_key: Base64VecU8,
        max_per_tx: U128,
        daily_cap: U128,
        allowlist_only: bool,
    ) -> Self {
        assert_eq!(
            gate_public_key.0.len(),
            32,
            "gate_public_key must be a 32-byte ed25519 public key"
        );
        Self {
            owner,
            gate_account,
            gate_public_key: gate_public_key.0,
            max_per_tx: max_per_tx.0,
            daily_cap: daily_cap.0,
            daily_spent: 0,
            day_bucket: 0,
            allowlist_only,
            allowlist: HashSet::new(),
            blocklist: HashMap::new(),
            counterparties: HashMap::new(),
            pending: HashMap::new(),
            used_nonces: HashSet::new(),
            pending_nonces: HashSet::new(),
            secrets: HashMap::new(),
            audit: Vec::new(),
            audit_seq: 0,
            release_counter: 0,
        }
    }

    // ---------- funding ----------

    #[payable]
    pub fn deposit(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        let actor = env::predecessor_account_id();
        self.push_audit(
            actor,
            "deposit",
            &format!("deposited {} yoctoNEAR", amount),
            "accepted",
        );
    }

    // ---------- release flow ----------

    /// Step 1: the agent asks for a release. The contract evaluates policy
    /// caps, the allowlist and the counterparty record, commits the purpose
    /// hash on-chain and returns Allow / Warn / Block. A Block is final and
    /// is written to the audit log.
    pub fn request_release(
        &mut self,
        recipient: AccountId,
        amount: U128,
        purpose: String,
        nonce: String,
        expiry: u64,
    ) -> ReleaseDecision {
        let amount = amount.0;
        assert!(amount > 0, "amount must be positive");
        assert!(
            !self.used_nonces.contains(&nonce) && !self.pending_nonces.contains(&nonce),
            "nonce already used"
        );
        let now_sec = env::block_timestamp() / 1_000_000_000;
        assert!(expiry > now_sec, "gate decision expiry is in the past");

        let caller = env::predecessor_account_id();
        let ph = purpose_hash(&recipient, amount, &purpose, &nonce);
        self.roll_day();

        // --- Block conditions (final, audited) ---
        let block_reason: Option<String> = if amount > self.max_per_tx {
            Some("exceeds per-transaction cap".to_string())
        } else if self.daily_spent + amount > self.daily_cap {
            Some("exceeds daily cap".to_string())
        } else if self.allowlist_only && !self.allowlist.contains(&recipient) {
            Some("recipient not on allowlist".to_string())
        } else if let Some(evidence) = self.blocklist.get(&recipient) {
            Some(format!("on shared blocklist: {}", evidence))
        } else {
            None
        };
        if let Some(reason) = block_reason {
            self.push_audit(
                caller,
                "request_release",
                &format!("recipient={} amount={} purpose_hash={}", recipient, amount, ph),
                &format!("block: {}", reason),
            );
            return ReleaseDecision {
                release_id: None,
                status: ReleaseStatus::Block,
                reason,
                purpose_hash: ph,
            };
        }

        // --- Warn signals (mirror core/counterparty.js) ---
        let record = self
            .counterparties
            .get(&recipient)
            .cloned()
            .unwrap_or_default();
        let height = env::block_height();
        let mut reasons: Vec<String> = Vec::new();
        let is_new = match record.first_seen_block {
            None => true,
            Some(first) => height.saturating_sub(first) < NEW_ACCOUNT_MIN_BLOCKS,
        };
        if is_new && record.interactions == 0 {
            reasons.push("new account with no interaction history".to_string());
        }
        if record.code_changed {
            reasons.push("contract code changed since last interaction".to_string());
        }
        if record.interactions == 0 && amount > WARN_AMOUNT_YOCTO {
            reasons.push("first payment to this counterparty above warn threshold".to_string());
        }
        let (status, reason) = if reasons.is_empty() {
            (ReleaseStatus::Allow, "ok".to_string())
        } else {
            (ReleaseStatus::Warn, reasons.join("; "))
        };

        self.release_counter += 1;
        let release_id = format!("rel-{}", self.release_counter);
        self.pending.insert(
            release_id.clone(),
            PendingRelease {
                release_id: release_id.clone(),
                recipient: recipient.clone(),
                amount,
                purpose,
                purpose_hash: ph.clone(),
                nonce: nonce.clone(),
                expiry,
                status: status.clone(),
                human_approved: false,
            },
        );
        self.pending_nonces.insert(nonce);
        let decision_word = match status {
            ReleaseStatus::Allow => "allow",
            ReleaseStatus::Warn => "warn",
            ReleaseStatus::Block => "block",
        };
        self.push_audit(
            caller,
            "request_release",
            &format!(
                "release_id={} recipient={} amount={} purpose_hash={}",
                release_id, recipient, amount, ph
            ),
            &format!("{}: {}", decision_word, reason),
        );
        ReleaseDecision {
            release_id: Some(release_id),
            status,
            reason,
            purpose_hash: ph,
        }
    }

    /// Human approval step for Warn releases. Owner only.
    pub fn approve_release(&mut self, release_id: String) {
        self.assert_owner();
        let pending = self
            .pending
            .get_mut(&release_id)
            .unwrap_or_else(|| env::panic_str("unknown release"));
        assert!(
            pending.status == ReleaseStatus::Warn,
            "only Warn releases need approval"
        );
        pending.human_approved = true;
        let actor = env::predecessor_account_id();
        self.push_audit(
            actor,
            "approve_release",
            &format!("release_id={}", release_id),
            "approved by owner",
        );
    }

    /// Step 2 (the enforcement point): release funds against a gate
    /// decision. The signature must cover the exact stored tuple; the nonce
    /// is single-use; expired decisions are rejected. Any failure reverts —
    /// there is no partial release and no way to skip the gate.
    pub fn release(&mut self, release_id: String, gate_signature: Base64VecU8) -> ReleaseReceipt {
        let pending = self
            .pending
            .get(&release_id)
            .unwrap_or_else(|| env::panic_str("unknown release"));
        let (recipient, amount, ph, nonce, expiry, status, human_approved) = (
            pending.recipient.clone(),
            pending.amount,
            pending.purpose_hash.clone(),
            pending.nonce.clone(),
            pending.expiry,
            pending.status.clone(),
            pending.human_approved,
        );

        match status {
            ReleaseStatus::Allow => {}
            ReleaseStatus::Warn => {
                assert!(human_approved, "Warn release requires human approval first")
            }
            ReleaseStatus::Block => env::panic_str("release is blocked"),
        }
        assert!(
            !self.used_nonces.contains(&nonce),
            "nonce already used (replay)"
        );
        let now_sec = env::block_timestamp() / 1_000_000_000;
        assert!(now_sec <= expiry, "gate decision expired");

        // Verify the gate signature on-chain.
        let sig_bytes: &[u8] = &gate_signature.0;
        assert!(sig_bytes.len() == 64, "gate signature must be 64 bytes");
        let mut sig = [0u8; 64];
        sig.copy_from_slice(sig_bytes);
        let mut key = [0u8; 32];
        key.copy_from_slice(&self.gate_public_key);
        let message = gate_message(&recipient, amount, &ph, &nonce, expiry);
        assert!(
            env::ed25519_verify(&sig, message.as_bytes(), &key),
            "invalid gate signature"
        );

        // Daily cap re-checked at release time (state may have moved).
        self.roll_day();
        assert!(
            self.daily_spent + amount <= self.daily_cap,
            "exceeds daily cap at release"
        );

        // Commit: consume the pending release and the nonce, move funds.
        self.pending.remove(&release_id);
        self.pending_nonces.remove(&nonce);
        self.used_nonces.insert(nonce);
        self.daily_spent += amount;
        let record = self.counterparties.entry(recipient.clone()).or_default();
        if record.first_seen_block.is_none() {
            record.first_seen_block = Some(env::block_height());
        }
        record.interactions += 1;

        let actor = env::predecessor_account_id();
        self.push_audit(
            actor,
            "release",
            &format!(
                "release_id={} recipient={} amount={} purpose_hash={}",
                release_id, recipient, amount, ph
            ),
            "released",
        );
        Promise::new(recipient.clone()).transfer(NearToken::from_yoctonear(amount));
        ReleaseReceipt {
            release_id,
            recipient,
            amount: U128(amount),
            purpose_hash: ph,
        }
    }

    // ---------- sealed secrets ----------

    /// Store sealed-secret ciphertext. Owner only. The plaintext and the
    /// decryption key never touch the chain; only ciphertext is stored.
    pub fn seal_secret(&mut self, secret_id: String, ciphertext: String, label: String) {
        self.assert_owner();
        self.secrets.insert(
            secret_id.clone(),
            SealedSecret {
                ciphertext,
                label,
            },
        );
        let actor = env::predecessor_account_id();
        self.push_audit(
            actor,
            "seal_secret",
            &format!("secret_id={}", secret_id),
            "sealed",
        );
    }

    /// Use a sealed secret WITHOUT reading it: returns a derived digest of
    /// (secret, operation, caller) only. There is deliberately no method
    /// that returns the plaintext or the ciphertext.
    pub fn use_secret(&mut self, secret_id: String, operation: String) -> SecretUseResult {
        let secret = self
            .secrets
            .get(&secret_id)
            .unwrap_or_else(|| env::panic_str("unknown secret"));
        let caller = env::predecessor_account_id();
        let material = format!(
            "ark-use-v1|{}|{}|{}|{}",
            secret_id, operation, secret.ciphertext, caller
        );
        let derived = hex(&env::sha256(material.as_bytes()));
        self.push_audit(
            caller,
            "use_secret",
            &format!("secret_id={} operation={}", secret_id, operation),
            "derived result returned; secret not exposed",
        );
        SecretUseResult {
            secret_id,
            operation,
            derived,
        }
    }

    // ---------- counterparty intelligence & policy (owner / gate) ----------

    pub fn record_counterparty(
        &mut self,
        account: AccountId,
        is_contract: bool,
        code_hash: Option<String>,
    ) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.owner || caller == self.gate_account,
            "only the owner or the gate service can record counterparty data"
        );
        let record = self.counterparties.entry(account.clone()).or_default();
        if record.first_seen_block.is_none() {
            record.first_seen_block = Some(env::block_height());
        }
        if let Some(new_hash) = &code_hash {
            if let Some(old_hash) = &record.code_hash {
                if old_hash != new_hash {
                    record.code_changed = true;
                }
            }
        }
        if code_hash.is_some() {
            record.code_hash = code_hash;
        }
        record.is_contract = is_contract;
    }

    pub fn add_to_blocklist(&mut self, account: AccountId, evidence: String) {
        self.assert_owner();
        self.blocklist.insert(account.clone(), evidence.clone());
        let actor = env::predecessor_account_id();
        self.push_audit(
            actor,
            "add_to_blocklist",
            &format!("account={} evidence={}", account, evidence),
            "blocklisted",
        );
    }

    pub fn remove_from_blocklist(&mut self, account: AccountId) {
        self.assert_owner();
        self.blocklist.remove(&account);
    }

    pub fn add_to_allowlist(&mut self, account: AccountId) {
        self.assert_owner();
        self.allowlist.insert(account);
    }

    pub fn set_policy(&mut self, max_per_tx: U128, daily_cap: U128, allowlist_only: bool) {
        self.assert_owner();
        self.max_per_tx = max_per_tx.0;
        self.daily_cap = daily_cap.0;
        self.allowlist_only = allowlist_only;
    }

    pub fn set_gate_key(&mut self, gate_public_key: Base64VecU8) {
        self.assert_owner();
        assert_eq!(
            gate_public_key.0.len(),
            32,
            "gate_public_key must be a 32-byte ed25519 public key"
        );
        self.gate_public_key = gate_public_key.0;
    }

    // ---------- views ----------

    pub fn get_vault_state(&self) -> VaultStateView {
        VaultStateView {
            balance: U128(env::account_balance().as_yoctonear()),
            daily_spent: U128(self.daily_spent),
            daily_cap: U128(self.daily_cap),
            max_per_tx: U128(self.max_per_tx),
            pending_count: self.pending.len() as u64,
            audit_count: self.audit.len() as u64,
        }
    }

    pub fn get_release(&self, release_id: String) -> Option<ReleaseView> {
        self.pending.get(&release_id).map(|p| ReleaseView {
            release_id: p.release_id.clone(),
            recipient: p.recipient.clone(),
            amount: U128(p.amount),
            purpose: p.purpose.clone(),
            purpose_hash: p.purpose_hash.clone(),
            nonce: p.nonce.clone(),
            expiry: p.expiry,
            status: p.status.clone(),
            human_approved: p.human_approved,
        })
    }

    pub fn get_counterparty(&self, account: AccountId) -> CounterpartyView {
        let record = self
            .counterparties
            .get(&account)
            .cloned()
            .unwrap_or_default();
        let evidence = self.blocklist.get(&account).cloned();
        CounterpartyView {
            account,
            first_seen_block: record.first_seen_block,
            interactions: record.interactions,
            is_contract: record.is_contract,
            code_changed: record.code_changed,
            blocklisted: evidence.is_some(),
            evidence,
        }
    }

    pub fn get_blocklist(&self) -> Vec<BlocklistEntry> {
        self.blocklist
            .iter()
            .map(|(account, evidence)| BlocklistEntry {
                account: account.clone(),
                evidence: evidence.clone(),
            })
            .collect()
    }

    pub fn get_audit_log(&self, limit: u64) -> Vec<AuditEntry> {
        let n = (limit as usize).min(self.audit.len());
        self.audit[self.audit.len() - n..].to_vec()
    }

    // ---------- internals ----------

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "only the owner can call this method"
        );
    }

    fn roll_day(&mut self) {
        let today = (env::block_timestamp() / 1_000_000_000) / SECONDS_PER_DAY;
        if today != self.day_bucket {
            self.day_bucket = today;
            self.daily_spent = 0;
        }
    }

    fn push_audit(&mut self, actor: AccountId, action: &str, detail: &str, decision: &str) {
        self.audit_seq += 1;
        self.audit.push(AuditEntry {
            seq: self.audit_seq,
            block_height: env::block_height(),
            timestamp: env::block_timestamp(),
            actor,
            action: action.to_string(),
            detail: detail.to_string(),
            decision: decision.to_string(),
        });
        if self.audit.len() > AUDIT_LOG_MAX {
            let excess = self.audit.len() - AUDIT_LOG_MAX;
            self.audit.drain(0..excess);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;
    use sha2::{Digest, Sha256};
    use std::str::FromStr;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const TS_NS: u64 = 1_700_000_000_000_000_000; // 2023-11-14, in nanoseconds
    const NOW_SEC: u64 = 1_700_000_000;
    const GATE_SEED: [u8; 32] = [7u8; 32];

    fn acct(s: &str) -> AccountId {
        AccountId::from_str(s).unwrap()
    }
    fn owner() -> AccountId {
        acct("owner.testnet")
    }
    fn agent() -> AccountId {
        acct("agent.testnet")
    }
    fn vendor() -> AccountId {
        acct("vendor.testnet")
    }
    fn attacker() -> AccountId {
        acct("attacker.testnet")
    }

    fn gate_signing_key() -> SigningKey {
        SigningKey::from_bytes(&GATE_SEED)
    }

    fn set_ctx(predecessor: AccountId, height: u64, ts_ns: u64, deposit: u128) {
        let mut builder = VMContextBuilder::new();
        builder.current_account_id(acct("ark.testnet"));
        builder.predecessor_account_id(predecessor);
        builder.block_height(height);
        builder.block_timestamp(ts_ns);
        if deposit > 0 {
            builder.attached_deposit(NearToken::from_yoctonear(deposit));
        }
        testing_env!(builder.build());
    }

    fn new_vault() -> ArkVault {
        let pubkey = Base64VecU8(gate_signing_key().verifying_key().to_bytes().to_vec());
        ArkVault::new(
            owner(),
            acct("gate.testnet"),
            pubkey,
            U128(10 * ONE_NEAR),
            U128(25 * ONE_NEAR),
            false,
        )
    }

    fn sign(decision: &ReleaseDecision, recipient: &AccountId, amount: u128, nonce: &str, expiry: u64) -> Base64VecU8 {
        let message = gate_message(recipient, amount, &decision.purpose_hash, nonce, expiry);
        let signature = gate_signing_key().sign(message.as_bytes());
        Base64VecU8(signature.to_bytes().to_vec())
    }

    /// Runs one full happy-path cycle (request -> approve if warn -> sign -> release)
    /// and returns the receipt. Caller must have set the ctx to the agent first;
    /// this helper switches ctx between agent and owner as needed and ends as agent.
    fn run_full_cycle(
        vault: &mut ArkVault,
        recipient: &AccountId,
        amount: u128,
        purpose: &str,
        nonce: &str,
    ) -> ReleaseReceipt {
        let expiry = NOW_SEC + 3600;
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            recipient.clone(),
            U128(amount),
            purpose.to_string(),
            nonce.to_string(),
            expiry,
        );
        let release_id = decision.release_id.clone().expect("expected a pending release");
        if decision.status == ReleaseStatus::Warn {
            set_ctx(owner(), 5000, TS_NS, 0);
            vault.approve_release(release_id.clone());
        }
        let sig = sign(&decision, recipient, amount, nonce, expiry);
        set_ctx(agent(), 5000, TS_NS, 0);
        vault.release(release_id, sig)
    }

    #[test]
    fn purpose_hash_matches_spec_vector() {
        set_ctx(agent(), 5000, TS_NS, 0);
        let mut hasher = Sha256::new();
        hasher.update(b"ark-purpose-v1|vendor.testnet|1000000000000000000000000|API subscription renewal|nonce-1");
        let expected = hex(&hasher.finalize());
        let actual = purpose_hash(&vendor(), ONE_NEAR, "API subscription renewal", "nonce-1");
        assert_eq!(actual, expected);
        assert_eq!(actual.len(), 64);
    }

    #[test]
    fn happy_path_releases_and_builds_history() {
        let mut vault = new_vault();
        set_ctx(owner(), 5000, TS_NS, 100 * ONE_NEAR);
        vault.deposit();

        // First payment to a fresh counterparty: Warn (new account), owner approves.
        let receipt = run_full_cycle(&mut vault, &vendor(), ONE_NEAR, "API subscription renewal", "nonce-1");
        assert_eq!(receipt.recipient, vendor());
        assert_eq!(receipt.amount.0, ONE_NEAR);

        set_ctx(agent(), 5000, TS_NS, 0);
        let state = vault.get_vault_state();
        assert_eq!(state.daily_spent.0, ONE_NEAR);
        let record = vault.get_counterparty(vendor());
        assert_eq!(record.interactions, 1);

        // Second payment: history exists, so it is an Allow and needs no approval.
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-2".to_string(),
            NOW_SEC + 3600,
        );
        assert_eq!(decision.status, ReleaseStatus::Allow);
    }

    #[test]
    fn blocklisted_recipient_is_blocked() {
        let mut vault = new_vault();
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.add_to_blocklist(attacker(), "reported drain attempt".to_string());

        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            attacker(),
            U128(ONE_NEAR),
            "vendor invoice".to_string(),
            "nonce-x".to_string(),
            NOW_SEC + 3600,
        );
        assert_eq!(decision.status, ReleaseStatus::Block);
        assert!(decision.release_id.is_none());
        assert!(decision.reason.contains("blocklist"));
        let log = vault.get_audit_log(1);
        assert!(log[0].decision.contains("block"));
    }

    #[test]
    fn per_tx_cap_blocks() {
        let mut vault = new_vault();
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(11 * ONE_NEAR),
            "vendor invoice".to_string(),
            "nonce-cap".to_string(),
            NOW_SEC + 3600,
        );
        assert_eq!(decision.status, ReleaseStatus::Block);
        assert!(decision.reason.contains("per-transaction cap"));
    }

    #[test]
    #[should_panic(expected = "Warn release requires human approval first")]
    fn warn_release_without_approval_panics() {
        let mut vault = new_vault();
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-w".to_string(),
            NOW_SEC + 3600,
        );
        assert_eq!(decision.status, ReleaseStatus::Warn);
        let release_id = decision.release_id.clone().unwrap();
        let sig = sign(&decision, &vendor(), ONE_NEAR, "nonce-w", NOW_SEC + 3600);
        vault.release(release_id, sig);
    }

    #[test]
    #[should_panic(expected = "invalid gate signature")]
    fn wrong_key_signature_panics() {
        let mut vault = new_vault();
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-bad".to_string(),
            NOW_SEC + 3600,
        );
        let release_id = decision.release_id.clone().unwrap();
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.approve_release(release_id.clone());
        // Attacker signs with their own key.
        let attacker_key = SigningKey::from_bytes(&[9u8; 32]);
        let message = gate_message(&vendor(), ONE_NEAR, &decision.purpose_hash, "nonce-bad", NOW_SEC + 3600);
        let bad_sig = Base64VecU8(attacker_key.sign(message.as_bytes()).to_bytes().to_vec());
        set_ctx(agent(), 5000, TS_NS, 0);
        vault.release(release_id, bad_sig);
    }

    #[test]
    #[should_panic(expected = "invalid gate signature")]
    fn tampered_amount_signature_panics() {
        let mut vault = new_vault();
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-t".to_string(),
            NOW_SEC + 3600,
        );
        let release_id = decision.release_id.clone().unwrap();
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.approve_release(release_id.clone());
        // Gate signature over a DIFFERENT amount (2 NEAR) must not release 1 NEAR.
        let message = gate_message(&vendor(), 2 * ONE_NEAR, &decision.purpose_hash, "nonce-t", NOW_SEC + 3600);
        let sig = Base64VecU8(gate_signing_key().sign(message.as_bytes()).to_bytes().to_vec());
        set_ctx(agent(), 5000, TS_NS, 0);
        vault.release(release_id, sig);
    }

    #[test]
    #[should_panic(expected = "unknown release")]
    fn replay_of_consumed_release_panics() {
        let mut vault = new_vault();
        set_ctx(owner(), 5000, TS_NS, 100 * ONE_NEAR);
        vault.deposit();
        let receipt = run_full_cycle(&mut vault, &vendor(), ONE_NEAR, "API subscription renewal", "nonce-1");
        let fake_sig = Base64VecU8(vec![0u8; 64]);
        set_ctx(agent(), 5000, TS_NS, 0);
        vault.release(receipt.release_id, fake_sig);
    }

    #[test]
    #[should_panic(expected = "nonce already used")]
    fn nonce_reuse_in_new_request_panics() {
        let mut vault = new_vault();
        set_ctx(owner(), 5000, TS_NS, 100 * ONE_NEAR);
        vault.deposit();
        run_full_cycle(&mut vault, &vendor(), ONE_NEAR, "API subscription renewal", "nonce-1");
        set_ctx(agent(), 5000, TS_NS, 0);
        vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-1".to_string(),
            NOW_SEC + 3600,
        );
    }

    #[test]
    #[should_panic(expected = "gate decision expired")]
    fn expired_decision_panics() {
        let mut vault = new_vault();
        let expiry = NOW_SEC + 10;
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-e".to_string(),
            expiry,
        );
        let release_id = decision.release_id.clone().unwrap();
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.approve_release(release_id.clone());
        let sig = sign(&decision, &vendor(), ONE_NEAR, "nonce-e", expiry);
        // Time passes beyond the expiry.
        set_ctx(agent(), 5000, TS_NS + 20 * 1_000_000_000, 0);
        vault.release(release_id, sig);
    }

    #[test]
    fn use_secret_returns_derived_only() {
        let mut vault = new_vault();
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.seal_secret(
            "api-key-1".to_string(),
            "Q0lQSEVSVEVYVC1EVU1NWQ==".to_string(),
            "demo api key".to_string(),
        );
        set_ctx(agent(), 5000, TS_NS, 0);
        let result = vault.use_secret("api-key-1".to_string(), "call billing api".to_string());
        assert_eq!(result.derived.len(), 64);
        assert_ne!(result.derived, "Q0lQSEVSVEVYVC1EVU1NWQ==");
        assert!(!result.derived.contains("CIPHERTEXT"));
    }

    #[test]
    #[should_panic(expected = "only the owner can call this method")]
    fn non_owner_cannot_seal_secret() {
        let mut vault = new_vault();
        set_ctx(agent(), 5000, TS_NS, 0);
        vault.seal_secret("x".to_string(), "y".to_string(), "z".to_string());
    }

    #[test]
    fn code_change_triggers_warn() {
        let mut vault = new_vault();
        set_ctx(owner(), 5000, TS_NS, 100 * ONE_NEAR);
        vault.deposit();
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.record_counterparty(vendor(), true, Some("hashA".to_string()));
        // Build one interaction so the "new account" warn no longer applies.
        run_full_cycle(&mut vault, &vendor(), ONE_NEAR, "API subscription renewal", "nonce-1");
        // Code changes.
        set_ctx(owner(), 5000, TS_NS, 0);
        vault.record_counterparty(vendor(), true, Some("hashB".to_string()));
        let view = vault.get_counterparty(vendor());
        assert!(view.code_changed);
        // Next request warns on the code change alone.
        set_ctx(agent(), 5000, TS_NS, 0);
        let decision = vault.request_release(
            vendor(),
            U128(ONE_NEAR),
            "API subscription renewal".to_string(),
            "nonce-2".to_string(),
            NOW_SEC + 3600,
        );
        assert_eq!(decision.status, ReleaseStatus::Warn);
        assert!(decision.reason.contains("code changed"));
    }
}
