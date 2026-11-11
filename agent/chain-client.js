'use strict';

// ChainClient interface: the agent talks to the vault through a client.
//
// - MockChainClient delegates to the in-memory MockVault (local demo/tests).
//   This path is the default whenever no NEAR credentials are configured.
// - NearChainClient is the live NEAR testnet client, built on near-api-js 7.
//   It maps every interface method to the ark-vault contract's on-chain ABI
//   (contract/src/lib.rs). Amounts cross the wire as yoctoNEAR decimal
//   strings (the contract's U128 JSON form), the gate signature and the gate
//   public key as base64 (the contract's Base64VecU8 JSON form).
//
// Mode selection: createChainClient() picks NearChainClient when NEAR
// credentials are present (config or ARK_NEAR_* env vars) and the sim
// (MockChainClient) otherwise. Nothing in this module makes a network call
// at construction time; calls happen only when a NearChainClient method is
// invoked.

const DEFAULT_RPC_URL = 'https://rpc.testnet.near.org';
const DEFAULT_NETWORK_ID = 'testnet';
// 30 TGas: comfortably above what the vault's change methods use.
const DEFAULT_GAS = '30000000000000';
// Wait for final execution so a call's return value / failure is settled
// before the client reports it.
const DEFAULT_WAIT_UNTIL = 'FINAL';

// The only methods the agent's scoped function-call key may call.
const AGENT_SCOPED_METHODS = ['request_release', 'release', 'use_secret'];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// A chain call that failed, classified for callers:
//   kind: 'contract_panic'  — the contract reverted (reason in the message)
//         'account_not_found' / 'method_not_found' — wiring mistakes
//         'transport' — RPC/network layer, or an unclassified failure
class NearCallError extends Error {
  constructor(method, kind, cause) {
    const detail = cause && cause.message ? cause.message : String(cause);
    super(`near call ${method} failed (${kind}): ${detail}`);
    this.name = 'NearCallError';
    this.method = method;
    this.kind = kind;
    this.cause = cause;
  }
}

function classifyNearError(err) {
  const text = String((err && err.message) || err || '');
  if (/panicked|wasm execution failed|smart contract panicked|guestpanic/i.test(text)) {
    return 'contract_panic';
  }
  if (/method.*not found|methodresolve|method_not_found|cannot find.*method/i.test(text)) {
    return 'method_not_found';
  }
  if (/account.*not found|does not exist|accountnotfound/i.test(text)) {
    return 'account_not_found';
  }
  return 'transport';
}

// ---------------------------------------------------------------------------
// Value normalisation helpers (mock shape <-> contract JSON shape)
// ---------------------------------------------------------------------------

function toYoctoString(value, field) {
  if (value === undefined || value === null) {
    throw new Error(`${field} is required`);
  }
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${field} must be a yoctoNEAR decimal string, got: ${value}`);
  }
  return text;
}

// The contract serialises the ReleaseStatus enum as "Allow" | "Warn" |
// "Block"; the mock (and the wrapper) use lowercase. Normalise both ways in.
function normalizeStatus(status) {
  const text = String(status || '').toLowerCase();
  if (text === 'allow' || text === 'warn' || text === 'block') return text;
  throw new Error(`unexpected release status from contract: ${status}`);
}

// Gate signatures travel to the contract as base64 (Base64VecU8). Accept the
// shapes the gate service and tests produce: Buffer/Uint8Array of raw bytes,
// a base64 string, or a hex string of the 64 signature bytes.
function signatureToBase64(signature) {
  if (Buffer.isBuffer(signature) || signature instanceof Uint8Array) {
    return Buffer.from(signature).toString('base64');
  }
  if (typeof signature === 'string') {
    if (/^[0-9a-fA-F]{128}$/.test(signature)) {
      return Buffer.from(signature, 'hex').toString('base64');
    }
    return signature; // assumed base64 already
  }
  throw new Error('gate signature must be bytes, a hex string, or a base64 string');
}

function bytesToBase64(bytes, field) {
  if (Buffer.isBuffer(bytes) || bytes instanceof Uint8Array || Array.isArray(bytes)) {
    return Buffer.from(bytes).toString('base64');
  }
  if (typeof bytes === 'string') return bytes; // assumed base64 already
  throw new Error(`${field} must be raw bytes or a base64 string`);
}

// Contract CounterpartyView (snake_case) -> mock CounterpartyRecord shape.
function normalizeCounterparty(view) {
  if (!view) {
    return {
      firstSeenBlock: null,
      interactions: 0,
      isContract: false,
      codeChanged: false,
      blocklisted: false,
      evidence: null,
    };
  }
  return {
    firstSeenBlock: view.first_seen_block ?? null,
    interactions: view.interactions ?? 0,
    isContract: Boolean(view.is_contract),
    codeChanged: Boolean(view.code_changed),
    blocklisted: Boolean(view.blocklisted),
    evidence: view.evidence ?? null,
  };
}

// Extract the JSON return value from a transaction outcome, throwing a
// classified error when the transaction itself failed on-chain.
function extractTxResult(outcome, method) {
  const status = outcome && outcome.status;
  if (status && typeof status === 'object') {
    if ('Failure' in status) {
      const failure = status.Failure;
      const text =
        (failure && (failure.error_message || failure.error_type)) ||
        JSON.stringify(failure);
      throw new NearCallError(method, classifyNearError(new Error(text)), new Error(text));
    }
    if ('SuccessValue' in status) {
      const b64 = status.SuccessValue;
      if (!b64) return undefined;
      const text = Buffer.from(b64, 'base64').toString('utf8');
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return undefined;
}

function txHashOf(outcome) {
  return (outcome && outcome.transaction && outcome.transaction.hash) || null;
}

// ---------------------------------------------------------------------------
// MockChainClient — unchanged local/sim behaviour
// ---------------------------------------------------------------------------

class MockChainClient {
  constructor(mockVault, callerAccountId) {
    if (!mockVault) throw new Error('MockChainClient requires a MockVault instance');
    this.vault = mockVault;
    this.caller = callerAccountId;
  }

  async deposit(args) {
    const a = args && typeof args === 'object' ? args : { amountYocto: args };
    return this.vault.deposit({ amountYocto: a.amountYocto, from: this.caller });
  }

  async requestRelease(args) {
    return this.vault.requestRelease({ ...args, caller: this.caller });
  }

  async approveRelease(args) {
    const releaseId = typeof args === 'string' ? args : args.releaseId;
    return this.vault.approveRelease({ releaseId, caller: this.caller });
  }

  async release(args) {
    return this.vault.release({ ...args, caller: this.caller });
  }

  async sealSecret(args) {
    return this.vault.sealSecret({ ...args, caller: this.caller });
  }

  async useSecret(args) {
    return this.vault.useSecret({ ...args, caller: this.caller });
  }

  async addToBlocklist(args) {
    return this.vault.addToBlocklist({ ...args, caller: this.caller });
  }

  async removeFromBlocklist(args) {
    const account = typeof args === 'string' ? args : args.account;
    return this.vault.removeFromBlocklist({ account, caller: this.caller });
  }

  async recordCounterparty(args) {
    return this.vault.recordCounterparty({ ...args, caller: this.caller });
  }

  async getVaultState() {
    return this.vault.getVaultState();
  }

  async getCounterparty(account) {
    return this.vault.getCounterparty(account);
  }

  async getAuditLog(limit) {
    return this.vault.getAuditLog(limit);
  }

  async getBalance(account) {
    return this.vault.getBalance(account);
  }
}

// ---------------------------------------------------------------------------
// NearChainClient — live testnet client (near-api-js 7)
// ---------------------------------------------------------------------------

class NearChainClient {
  /**
   * @param {object} config
   * @param {string} config.accountId  account this client signs as
   * @param {string} config.contractId the ark-vault contract account
   * @param {object} [config.account]  a near-api-js Account (or a stub with
   *   the same methods) — injectable so tests can stub the transport
   * @param {object} [config.provider] a near-api-js JsonRpcProvider (or stub)
   * @param {string} [config.secretKey] 'ed25519:...' secret key for accountId
   * @param {string} [config.rpcUrl]   default https://rpc.testnet.near.org
   * @param {string} [config.networkId] default 'testnet'
   * @param {string} [config.gas]      gas per change call, default 30 TGas
   */
  constructor(config = {}) {
    const env = process.env;
    this.accountId = config.accountId || env.ARK_NEAR_ACCOUNT_ID;
    this.contractId = config.contractId || env.ARK_NEAR_CONTRACT_ID;
    if (!this.accountId) {
      throw new Error('NearChainClient requires accountId (or ARK_NEAR_ACCOUNT_ID)');
    }
    if (!this.contractId) {
      throw new Error('NearChainClient requires contractId (or ARK_NEAR_CONTRACT_ID)');
    }
    this.networkId = config.networkId || env.ARK_NEAR_NETWORK_ID || DEFAULT_NETWORK_ID;
    this.gas = String(config.gas || DEFAULT_GAS);
    this.waitUntil = config.waitUntil || DEFAULT_WAIT_UNTIL;

    if (config.account) {
      this.account = config.account;
      this.provider = config.provider || config.account.provider;
    } else {
      // Lazy require: the sim path never loads the SDK.
      const nearAPI = require('near-api-js');
      const rpcUrl = config.rpcUrl || env.ARK_NEAR_RPC_URL || DEFAULT_RPC_URL;
      this.provider = config.provider || new nearAPI.JsonRpcProvider({ url: rpcUrl });
      const secretKey = config.secretKey || env.ARK_NEAR_SECRET_KEY;
      const signer = secretKey
        ? nearAPI.KeyPairSigner.fromSecretKey(secretKey)
        : undefined;
      this.account = new nearAPI.Account(this.accountId, this.provider, signer);
    }
    if (!this.provider) {
      throw new Error('NearChainClient requires a provider (or an account carrying one)');
    }
  }

  // -- internal transport ---------------------------------------------------

  async _call(methodName, args, { deposit } = {}) {
    const params = {
      contractId: this.contractId,
      methodName,
      args: args || {},
      gas: this.gas,
      waitUntil: this.waitUntil,
    };
    if (deposit !== undefined) params.deposit = deposit;
    let outcome;
    try {
      outcome = await this.account.callFunctionRaw(params);
    } catch (err) {
      throw new NearCallError(methodName, classifyNearError(err), err);
    }
    const result = extractTxResult(outcome, methodName);
    return { result, txHash: txHashOf(outcome) };
  }

  async _view(methodName, args) {
    let res;
    try {
      // The provider query form, not provider.callFunction: under
      // near-api-js 7.5.2 callFunction resolves without a `result`
      // against the FastNear RPC, while query(call_function) returns
      // the result bytes. (Found during the live deploy; see BUILD-LOG.)
      res = await this.provider.query({
        request_type: 'call_function',
        finality: 'final',
        account_id: this.contractId,
        method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args || {}), 'utf8').toString('base64'),
      });
    } catch (err) {
      throw new NearCallError(methodName, classifyNearError(err), err);
    }
    if (!res || !Array.isArray(res.result)) return undefined;
    const text = Buffer.from(res.result).toString('utf8');
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // -- change methods (same interface as MockChainClient) -------------------

  // Funds the vault: the NEAR is attached to the call itself.
  async deposit(args) {
    const a = args && typeof args === 'object' ? args : { amountYocto: args };
    const amountYocto = toYoctoString(a.amountYocto, 'amountYocto');
    if (BigInt(amountYocto) <= 0n) throw new Error('deposit amount must be positive');
    const { txHash } = await this._call('deposit', {}, { deposit: amountYocto });
    const state = await this.getVaultState();
    return { vaultBalanceYocto: state.vaultBalanceYocto, txHash };
  }

  async requestRelease(args) {
    const amountYocto = toYoctoString(args.amountYocto, 'amountYocto');
    const { result, txHash } = await this._call('request_release', {
      recipient: args.recipient,
      amount: amountYocto,
      purpose: args.purpose,
      nonce: args.nonce,
      expiry: Number(args.expiry),
    });
    const r = result || {};
    return {
      releaseId: r.release_id ?? null,
      status: normalizeStatus(r.status),
      reason: r.reason ?? '',
      purposeHash: r.purpose_hash,
      txHash,
    };
  }

  async approveRelease(args) {
    const releaseId = typeof args === 'string' ? args : args.releaseId;
    const { txHash } = await this._call('approve_release', { release_id: releaseId });
    return { releaseId, humanApproved: true, txHash };
  }

  async release(args) {
    const { result, txHash } = await this._call('release', {
      release_id: args.releaseId,
      gate_signature: signatureToBase64(args.signature),
    });
    const r = result || {};
    return {
      released: true,
      releaseId: r.release_id ?? args.releaseId,
      recipient: r.recipient,
      amountYocto: r.amount !== undefined ? String(r.amount) : undefined,
      purposeHash: r.purpose_hash,
      txHash,
    };
  }

  async sealSecret(args) {
    const secretId = args.id ?? args.secretId;
    const ciphertext = args.ciphertextB64 ?? args.ciphertext;
    const { txHash } = await this._call('seal_secret', {
      secret_id: secretId,
      ciphertext,
      label: args.label ?? '',
    });
    return { secretId, sealed: true, txHash };
  }

  async useSecret(args) {
    const secretId = args.id ?? args.secretId;
    const { result, txHash } = await this._call('use_secret', {
      secret_id: secretId,
      operation: args.operation,
    });
    const r = result || {};
    return { secretId: r.secret_id ?? secretId, operation: r.operation, derived: r.derived, txHash };
  }

  async addToBlocklist(args) {
    const { txHash } = await this._call('add_to_blocklist', {
      account: args.account,
      evidence: args.evidence ?? '',
    });
    return { account: args.account, blocklisted: true, txHash };
  }

  async removeFromBlocklist(args) {
    const account = typeof args === 'string' ? args : args.account;
    const { txHash } = await this._call('remove_from_blocklist', { account });
    return { account, blocklisted: false, txHash };
  }

  async recordCounterparty(args) {
    const { txHash } = await this._call('record_counterparty', {
      account: args.account,
      is_contract: Boolean(args.isContract),
      code_hash: args.codeHash ?? null,
    });
    const record = await this.getCounterparty(args.account);
    return { ...record, txHash };
  }

  async setPolicy(args) {
    const { txHash } = await this._call('set_policy', {
      max_per_tx: toYoctoString(args.maxPerTxYocto, 'maxPerTxYocto'),
      daily_cap: toYoctoString(args.dailyCapYocto, 'dailyCapYocto'),
      allowlist_only: Boolean(args.allowlistOnly),
    });
    return { updated: true, txHash };
  }

  async addToAllowlist(args) {
    const account = typeof args === 'string' ? args : args.account;
    const { txHash } = await this._call('add_to_allowlist', { account });
    return { account, allowlisted: true, txHash };
  }

  // -- view methods -----------------------------------------------------------

  async getVaultState() {
    const r = (await this._view('get_vault_state', {})) || {};
    return {
      vaultBalanceYocto: r.balance !== undefined ? String(r.balance) : undefined,
      dailySpentYocto: r.daily_spent !== undefined ? String(r.daily_spent) : undefined,
      dailyCapYocto: r.daily_cap !== undefined ? String(r.daily_cap) : undefined,
      maxPerTxYocto: r.max_per_tx !== undefined ? String(r.max_per_tx) : undefined,
      pendingCount: r.pending_count,
      auditCount: r.audit_count,
    };
  }

  async getRelease(releaseId) {
    const r = await this._view('get_release', { release_id: releaseId });
    if (!r) return null;
    return {
      releaseId: r.release_id,
      recipient: r.recipient,
      amountYocto: String(r.amount),
      purpose: r.purpose,
      purposeHash: r.purpose_hash,
      nonce: r.nonce,
      expiry: r.expiry,
      status: normalizeStatus(r.status),
      humanApproved: Boolean(r.human_approved),
    };
  }

  async getCounterparty(account) {
    return normalizeCounterparty(await this._view('get_counterparty', { account }));
  }

  async getBlocklist() {
    const r = (await this._view('get_blocklist', {})) || [];
    return r.map((e) => ({ account: e.account, evidence: e.evidence }));
  }

  async getAuditLog(limit) {
    const n = Math.min(limit === undefined ? 200 : Number(limit), 200);
    const r = (await this._view('get_audit_log', { limit: n })) || [];
    return r.map((e) => ({
      seq: e.seq,
      block: e.block_height,
      timestamp: e.timestamp,
      actor: e.actor,
      action: e.action,
      detail: e.detail,
      decision: e.decision,
    }));
  }

  // Balance of an account in yoctoNEAR (string). Defaults to the contract
  // account — the on-chain counterpart of the mock's payout ledger lookup is
  // the recipient's own account balance.
  async getBalance(accountId) {
    const target = accountId || this.contractId;
    try {
      if (target === this.accountId && this.account.getBalance) {
        return (await this.account.getBalance()).toString();
      }
      const view = await this.provider.viewAccount({ accountId: target });
      return String(view.amount);
    } catch (err) {
      throw new NearCallError('getBalance', classifyNearError(err), err);
    }
  }

  // -- deployment helpers (used by the deploy runbook, not the agent flow) ---

  // Deploys contract code to THIS client's account (the vault account).
  async deployContract(code) {
    let bytes;
    if (Buffer.isBuffer(code) || code instanceof Uint8Array) bytes = code;
    else if (typeof code === 'string') bytes = Buffer.from(code, 'base64');
    else throw new Error('deployContract requires wasm bytes (Buffer/Uint8Array) or base64');
    let outcome;
    try {
      outcome = await this.account.deployContract(bytes);
    } catch (err) {
      throw new NearCallError('deployContract', classifyNearError(err), err);
    }
    extractTxResult(outcome, 'deployContract');
    return { contractId: this.accountId, txHash: txHashOf(outcome) };
  }

  // Calls the contract's `new` initializer. gatePublicKey accepts the raw
  // 32 bytes or their base64 form (the contract's Base64VecU8 argument).
  async initialize(args) {
    const gatePublicKeyB64 = bytesToBase64(
      args.gatePublicKeyBase64 ?? args.gatePublicKeyBytes ?? args.gatePublicKey,
      'gatePublicKey'
    );
    const { txHash } = await this._call('new', {
      owner: args.owner,
      gate_account: args.gateAccount,
      gate_public_key: gatePublicKeyB64,
      max_per_tx: toYoctoString(args.maxPerTxYocto, 'maxPerTxYocto'),
      daily_cap: toYoctoString(args.dailyCapYocto, 'dailyCapYocto'),
      allowlist_only: Boolean(args.allowlistOnly),
    });
    return { initialized: true, txHash };
  }

  // Adds the agent's scoped function-call access key. Must be called on a
  // client signed in as the AGENT account (adding a key is an operation on
  // the account that will hold the key), with that account's full-access key.
  // The new key can call only `methods` on the vault contract and carries a
  // NEAR allowance for gas; when the allowance runs out the key stops
  // working (lockout, not a drain path).
  async addAgentFunctionCallKey(args = {}) {
    const contractId = args.contractId || this.contractId;
    const methodNames = args.methods || AGENT_SCOPED_METHODS;
    const allowanceYocto = toYoctoString(
      args.allowanceYocto ?? '250000000000000000000000', // default 0.25 NEAR
      'allowanceYocto'
    );
    const publicKey = args.agentPublicKey || args.publicKey;
    if (!publicKey) throw new Error('addAgentFunctionCallKey requires agentPublicKey');
    let outcome;
    try {
      outcome = await this.account.addFunctionCallAccessKey({
        publicKey,
        contractId,
        methodNames,
        allowance: allowanceYocto,
      });
    } catch (err) {
      throw new NearCallError('addFunctionCallAccessKey', classifyNearError(err), err);
    }
    extractTxResult(outcome, 'addFunctionCallAccessKey');
    return {
      agentAccountId: this.accountId,
      contractId,
      methodNames,
      allowanceYocto,
      txHash: txHashOf(outcome),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory: sim by default, live when credentials are present
// ---------------------------------------------------------------------------

function hasNearCredentials(config) {
  return Boolean(
    config.account ||
      config.secretKey ||
      config.keyPair ||
      process.env.ARK_NEAR_SECRET_KEY
  );
}

/**
 * Pick a client by config:
 *   mode: 'sim' | 'mock'  -> MockChainClient (needs mockVault, or builds the
 *                            demo world; caller defaults to the demo agent)
 *   mode: 'near' | 'testnet' -> NearChainClient
 *   no mode -> NearChainClient when credentials are present, else sim.
 */
function createChainClient(config = {}) {
  const mode = String(config.mode || process.env.ARK_CHAIN || '').toLowerCase();
  if (mode === 'near' || mode === 'testnet') {
    return new NearChainClient(config);
  }
  if (mode === 'sim' || mode === 'mock' || !hasNearCredentials(config)) {
    if (config.mockVault || config.vault) {
      return new MockChainClient(config.mockVault || config.vault, config.caller || config.accountId);
    }
    // Default sim world: the seeded demo world from sim/world.js.
    const { buildDemoWorld } = require('../sim/world');
    const world = buildDemoWorld();
    return new MockChainClient(world.vault, config.caller || world.accounts.agent);
  }
  return new NearChainClient(config);
}

module.exports = {
  MockChainClient,
  NearChainClient,
  NearCallError,
  createChainClient,
  AGENT_SCOPED_METHODS,
  DEFAULT_GAS,
};
