'use strict';

// In-memory mock of the ark-vault contract (ARCHITECTURE.md section 3.2).
// Methods are synchronous and throw Error with a clear reason string to
// mirror on-chain reverts: any failed check means no state change for the
// release itself (audit entries for the attempt are still recorded).

const crypto = require('node:crypto');
const { purposeHash, gateMessage, isExpired } = require('../core/purpose');
const { checkCaps } = require('../core/policy');
const { scoreCounterparty } = require('../core/counterparty');
const { verifyGateSignature } = require('../agent/gate');

function defaultCounterpartyRecord() {
  return {
    firstSeenBlock: null,
    interactions: 0,
    isContract: false,
    codeChanged: false,
    blocklisted: false,
    evidence: null,
  };
}

class MockVault {
  constructor({ owner, gatePublicKeyBytes, maxPerTxYocto, dailyCapYocto, allowlistOnly = false }) {
    this.owner = owner;
    this.gatePublicKeyBytes = Buffer.from(gatePublicKeyBytes);
    this.policy = {
      maxPerTxYocto: String(maxPerTxYocto),
      dailyCapYocto: String(dailyCapYocto),
      dailySpentYocto: '0',
    };
    this.allowlistOnly = Boolean(allowlistOnly);
    this.allowlist = new Set();
    this.blocklist = new Map(); // account -> evidence
    this.counterparties = new Map(); // account -> CounterpartyRecord
    this.codeHashes = new Map(); // account -> last seen code hash (internal)
    this.pending = new Map(); // releaseId -> PendingRelease
    this.usedNonces = new Set();
    this.secrets = new Map(); // id -> { ciphertextB64, label }
    this.audit = [];
    this.balances = new Map(); // account -> BigInt yocto paid out
    this.vaultBalanceYocto = 0n;
    this.releaseCounter = 0;
    this.currentBlock = 5000;
    this._auditSeq = 0;
  }

  // ---- internal helpers -------------------------------------------------

  _audit(actor, action, detail, decision) {
    this.audit.push({
      seq: ++this._auditSeq,
      block: this.currentBlock,
      actor,
      action,
      detail,
      decision,
    });
  }

  _requireOwner(caller) {
    if (caller !== this.owner) {
      throw new Error(`only the vault owner may call this method (caller: ${caller})`);
    }
  }

  _caps(amountYocto) {
    return checkCaps({
      amountYocto: String(amountYocto),
      maxPerTxYocto: this.policy.maxPerTxYocto,
      dailyCapYocto: this.policy.dailyCapYocto,
      dailySpentYocto: this.policy.dailySpentYocto,
    });
  }

  // ---- change methods ---------------------------------------------------

  deposit({ from, caller, amountYocto }) {
    const actor = from || caller || 'unknown';
    const amount = BigInt(String(amountYocto));
    if (amount <= 0n) throw new Error('deposit amount must be positive');
    this.vaultBalanceYocto += amount;
    this._audit(actor, 'deposit', `amount=${amount.toString()}`, 'accepted');
    return { vaultBalanceYocto: this.vaultBalanceYocto.toString() };
  }

  requestRelease({ caller, recipient, amountYocto, purpose, nonce, expiry, nowSec }) {
    const amount = String(amountYocto);
    if (!recipient) throw new Error('recipient is required');
    if (!purpose) throw new Error('purpose is required');
    if (!nonce) throw new Error('nonce is required');
    if (BigInt(amount) <= 0n) throw new Error('amount must be positive');

    const hash = purposeHash({ recipient, amountYocto: amount, purpose, nonce });
    const detail = `recipient=${recipient} amount=${amount} purposeHash=${hash} nonce=${nonce}`;
    const now = nowSec !== undefined ? nowSec : Math.floor(Date.now() / 1000);

    if (isExpired(expiry, now)) {
      this._audit(caller, 'request_release', detail, 'block');
      throw new Error('release request is expired');
    }

    const noncePending = [...this.pending.values()].some((p) => p.nonce === nonce);
    if (this.usedNonces.has(nonce) || noncePending) {
      this._audit(caller, 'request_release', detail, 'block');
      throw new Error('nonce already used or pending');
    }

    const record = this.getCounterparty(recipient);
    const score = scoreCounterparty(record, {
      amountYocto: amount,
      currentBlock: this.currentBlock,
    });
    const reasons = [...(score.reasons || [])];

    let status = score.status;
    if (status !== 'block') {
      const caps = this._caps(amount);
      if (!caps.ok) {
        status = 'block';
        reasons.push(caps.reason);
      } else if (this.allowlistOnly && !this.allowlist.has(recipient)) {
        status = 'block';
        reasons.push('recipient is not on the allowlist and this vault is allowlist-only');
      }
    }

    let releaseId = null;
    if (status !== 'block') {
      releaseId = `rel-${++this.releaseCounter}`;
      this.pending.set(releaseId, {
        releaseId,
        recipient,
        amountYocto: amount,
        purpose,
        purposeHash: hash,
        nonce,
        expiry,
        status,
        humanApproved: false,
      });
    }

    this._audit(
      caller,
      'request_release',
      releaseId ? `${detail} releaseId=${releaseId}` : detail,
      status
    );
    return { releaseId, status, reason: reasons.join('; '), purposeHash: hash };
  }

  approveRelease({ caller, releaseId }) {
    this._requireOwner(caller);
    const pending = this.pending.get(releaseId);
    if (!pending) throw new Error(`pending release not found: ${releaseId}`);
    pending.humanApproved = true;
    this._audit(caller, 'approve_release', `releaseId=${releaseId}`, 'approved');
    return { releaseId, humanApproved: true };
  }

  release({ caller, releaseId, signature, nowSec }) {
    const pending = this.pending.get(releaseId);
    if (!pending) throw new Error(`pending release not found: ${releaseId}`);

    const detail =
      `releaseId=${releaseId} recipient=${pending.recipient} ` +
      `amount=${pending.amountYocto} purposeHash=${pending.purposeHash} nonce=${pending.nonce}`;

    if (pending.status === 'block') {
      throw new Error('blocked releases cannot be released');
    }
    if (pending.status === 'warn' && !pending.humanApproved) {
      throw new Error('release is in warn status and has not been human-approved');
    }
    if (pending.status !== 'allow' && pending.status !== 'warn') {
      throw new Error(`release has unexpected status: ${pending.status}`);
    }
    if (this.usedNonces.has(pending.nonce)) {
      throw new Error('nonce already used');
    }
    const now = nowSec !== undefined ? nowSec : Math.floor(Date.now() / 1000);
    if (isExpired(pending.expiry, now)) {
      throw new Error('gate decision is expired');
    }
    const caps = this._caps(pending.amountYocto);
    if (!caps.ok) {
      throw new Error(caps.reason);
    }

    // The enforcement point: the gate signature must verify over the exact
    // message built from the STORED pending tuple — nothing the caller
    // supplies (besides the signature itself) is trusted.
    const message = gateMessage({
      recipient: pending.recipient,
      amountYocto: pending.amountYocto,
      purposeHashHex: pending.purposeHash,
      nonce: pending.nonce,
      expiry: pending.expiry,
    });
    const signatureOk = verifyGateSignature({
      publicKeyBytes: this.gatePublicKeyBytes,
      message,
      signatureBytes: signature,
    });
    if (!signatureOk) {
      this._audit(caller, 'release', detail, 'rejected');
      throw new Error('invalid gate signature');
    }

    const amount = BigInt(pending.amountYocto);
    if (amount > this.vaultBalanceYocto) {
      throw new Error('insufficient vault balance');
    }

    this.vaultBalanceYocto -= amount;
    this.balances.set(pending.recipient, (this.balances.get(pending.recipient) || 0n) + amount);
    this.policy.dailySpentYocto = (
      BigInt(this.policy.dailySpentYocto) + amount
    ).toString();
    this.usedNonces.add(pending.nonce);
    this.pending.delete(releaseId);

    const record = this.counterparties.get(pending.recipient) || {
      ...defaultCounterpartyRecord(),
      firstSeenBlock: this.currentBlock,
    };
    record.interactions += 1;
    this.counterparties.set(pending.recipient, record);

    this._audit(caller, 'release', detail, 'released');
    return { released: true, amountYocto: pending.amountYocto, recipient: pending.recipient };
  }

  sealSecret({ caller, id, ciphertextB64, label }) {
    this._requireOwner(caller);
    if (!id) throw new Error('secret id is required');
    this.secrets.set(id, { ciphertextB64, label: label || null });
    // Note: the ciphertext itself is never written to the audit log.
    this._audit(caller, 'seal_secret', `id=${id} label=${label || ''}`, 'accepted');
    return { secretId: id, sealed: true };
  }

  useSecret({ caller, id, operation }) {
    const sealed = this.secrets.get(id);
    if (!sealed) throw new Error(`sealed secret not found: ${id}`);
    // Derived result only: a digest bound to the ciphertext, the operation
    // and the caller. The ciphertext and plaintext never leave this method.
    const derived = crypto
      .createHash('sha256')
      .update(`ark-use-v1|${id}|${operation}|${sealed.ciphertextB64}|${caller}`, 'utf8')
      .digest('hex');
    this._audit(caller, 'use_secret', `id=${id} operation=${operation}`, 'derived');
    return { secretId: id, operation, derived };
  }

  addToBlocklist({ caller, account, evidence }) {
    this._requireOwner(caller);
    this.blocklist.set(account, evidence || '');
    const record = this.counterparties.get(account) || defaultCounterpartyRecord();
    record.blocklisted = true;
    record.evidence = evidence || null;
    this.counterparties.set(account, record);
    this._audit(caller, 'add_to_blocklist', `account=${account} evidence=${evidence || ''}`, 'block');
    return { account, blocklisted: true };
  }

  removeFromBlocklist({ caller, account }) {
    this._requireOwner(caller);
    this.blocklist.delete(account);
    const record = this.counterparties.get(account);
    if (record) {
      record.blocklisted = false;
      record.evidence = null;
    }
    this._audit(caller, 'remove_from_blocklist', `account=${account}`, 'allow');
    return { account, blocklisted: false };
  }

  recordCounterparty({ caller, account, isContract, codeHash }) {
    this._requireOwner(caller);
    let record = this.counterparties.get(account);
    if (!record) {
      record = { ...defaultCounterpartyRecord(), firstSeenBlock: this.currentBlock };
      this.counterparties.set(account, record);
    }
    if (typeof isContract === 'boolean') record.isContract = isContract;
    if (codeHash !== undefined && codeHash !== null) {
      const previous = this.codeHashes.get(account);
      if (previous !== undefined && previous !== codeHash) record.codeChanged = true;
      if (previous !== undefined && previous === codeHash) record.codeChanged = false;
      this.codeHashes.set(account, codeHash);
    }
    if (this.blocklist.has(account)) {
      record.blocklisted = true;
      record.evidence = this.blocklist.get(account) || record.evidence;
    }
    this._audit(
      caller,
      'record_counterparty',
      `account=${account} isContract=${record.isContract} codeChanged=${record.codeChanged}`,
      'recorded'
    );
    return { ...record };
  }

  // ---- views --------------------------------------------------------------
  // Deliberately NO getter for secrets: no method on this class returns
  // secret plaintext or ciphertext.

  getVaultState() {
    return {
      vaultBalanceYocto: this.vaultBalanceYocto.toString(),
      dailySpentYocto: this.policy.dailySpentYocto,
      pendingCount: this.pending.size,
      auditCount: this.audit.length,
    };
  }

  getRelease(releaseId) {
    const pending = this.pending.get(releaseId);
    return pending ? { ...pending } : null;
  }

  getCounterparty(account) {
    const record = this.counterparties.get(account);
    if (record) return { ...record };
    const fallback = defaultCounterpartyRecord();
    if (this.blocklist.has(account)) {
      fallback.blocklisted = true;
      fallback.evidence = this.blocklist.get(account) || null;
    }
    return fallback;
  }

  getAuditLog(limit) {
    const entries = limit === undefined ? this.audit : this.audit.slice(-limit);
    return entries.map((entry) => ({ ...entry }));
  }

  getBalance(account) {
    return (this.balances.get(account) || 0n).toString();
  }
}

module.exports = { MockVault };
