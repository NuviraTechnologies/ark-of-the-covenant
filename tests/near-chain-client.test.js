'use strict';

// NearChainClient construction tests: the near-api-js transport is stubbed,
// so these run offline and prove the client builds the right calls —
// method names, argument serialization (yocto strings, purpose-hash hex,
// base64 signatures/keys), and gas/deposit values — and maps contract
// results back to the mock client's shapes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  NearChainClient,
  NearCallError,
  MockChainClient,
  createChainClient,
  AGENT_SCOPED_METHODS,
  DEFAULT_GAS,
} = require('../agent/chain-client');
const { purposeHash } = require('../core/purpose');
const { MockVault } = require('../sim/mock-chain');

const OWNER = 'owner.testnet';
const VAULT = 'ark-vault.testnet';
const AGENT = 'agent.testnet';
const VENDOR = 'vendor.testnet';
const ONE_NEAR = (10n ** 24n).toString();
const FAKE_TX = 'FAKEtxHash111111111111111111111111111111111';

function successOutcome(value) {
  return {
    transaction: { hash: FAKE_TX },
    status: {
      SuccessValue: Buffer.from(JSON.stringify(value === undefined ? '' : value), 'utf8').toString('base64'),
    },
  };
}

function createFakeTransport({ callResults = {}, viewResults = {} } = {}) {
  const calls = { functions: [], views: [], queries: [], deploys: [], addedKeys: [], balanceRequests: [] };
  const provider = {
    // The client's _view uses the provider query form since the _view fix
    // (provider.callFunction resolves without a result under near-api-js
    // 7.5.2 against FastNear). Record both the decoded view shape the
    // other assertions use and the raw query for shape checks.
    async query(q) {
      calls.queries.push(q);
      assert.equal(q.request_type, 'call_function');
      const method = q.method_name;
      const args = JSON.parse(Buffer.from(q.args_base64, 'base64').toString('utf8'));
      calls.views.push({ contractId: q.account_id, method, args });
      const value = typeof viewResults[method] === 'function' ? viewResults[method](args) : viewResults[method];
      return { result: Array.from(Buffer.from(JSON.stringify(value === undefined ? null : value), 'utf8')), logs: [] };
    },
    async viewAccount({ accountId }) {
      calls.balanceRequests.push(accountId);
      return { amount: (42n * 10n ** 24n).toString() };
    },
  };
  const account = {
    accountId: AGENT,
    provider,
    async callFunctionRaw(params) {
      calls.functions.push(params);
      const scripted = callResults[params.methodName];
      if (scripted instanceof Error) throw scripted;
      const value = typeof scripted === 'function' ? scripted(params) : scripted;
      return successOutcome(value);
    },
    async deployContract(bytes) {
      calls.deploys.push(bytes);
      return successOutcome('');
    },
    async addFunctionCallAccessKey(args) {
      calls.addedKeys.push(args);
      return successOutcome('');
    },
    async getBalance() {
      return 7n * 10n ** 24n;
    },
  };
  return { account, provider, calls };
}

function makeClient(transport, overrides = {}) {
  return new NearChainClient({
    accountId: AGENT,
    contractId: VAULT,
    account: transport.account,
    provider: transport.provider,
    ...overrides,
  });
}

test('deposit attaches the yocto amount as the call deposit, no args', async () => {
  const t = createFakeTransport({
    viewResults: { get_vault_state: { balance: '123', daily_spent: '0', daily_cap: '1', max_per_tx: '1', pending_count: 0, audit_count: 1 } },
  });
  const client = makeClient(t);
  const res = await client.deposit({ amountYocto: ONE_NEAR });
  const call = t.calls.functions[0];
  assert.equal(call.methodName, 'deposit');
  assert.equal(call.contractId, VAULT);
  assert.deepEqual(call.args, {});
  assert.equal(call.deposit, ONE_NEAR);
  assert.equal(call.gas, DEFAULT_GAS);
  assert.equal(res.vaultBalanceYocto, '123');
  assert.equal(res.txHash, FAKE_TX);
  await assert.rejects(() => client.deposit({ amountYocto: '0' }), /must be positive/);
  await assert.rejects(() => client.deposit({ amountYocto: '1.5' }), /yoctoNEAR decimal string/);
});

test('requestRelease serializes amount as a yocto string and maps the decision', async () => {
  const nonce = 'nonce-abc';
  const purpose = 'API subscription renewal';
  const expectedHash = purposeHash({ recipient: VENDOR, amountYocto: ONE_NEAR, purpose, nonce });
  const t = createFakeTransport({
    callResults: {
      request_release: { release_id: 'rel-1', status: 'Warn', reason: 'new account', purpose_hash: expectedHash },
    },
  });
  const client = makeClient(t);
  const res = await client.requestRelease({
    recipient: VENDOR,
    amountYocto: ONE_NEAR,
    purpose,
    nonce,
    expiry: 1900000000,
  });
  const call = t.calls.functions[0];
  assert.equal(call.methodName, 'request_release');
  assert.deepEqual(call.args, {
    recipient: VENDOR,
    amount: ONE_NEAR,
    purpose,
    nonce,
    expiry: 1900000000,
  });
  assert.equal(call.args.amount, '1000000000000000000000000'); // U128 as string, never a JS number
  assert.equal(res.releaseId, 'rel-1');
  assert.equal(res.status, 'warn'); // contract enum case normalised to the mock shape
  assert.equal(res.purposeHash, expectedHash);
  assert.match(res.purposeHash, /^[0-9a-f]{64}$/);
  assert.equal(res.txHash, FAKE_TX);
});

test('approveRelease accepts a bare release id string', async () => {
  const t = createFakeTransport();
  const client = makeClient(t);
  const res = await client.approveRelease('rel-9');
  assert.equal(t.calls.functions[0].methodName, 'approve_release');
  assert.deepEqual(t.calls.functions[0].args, { release_id: 'rel-9' });
  assert.equal(res.humanApproved, true);
});

test('release sends the gate signature as base64 of the raw 64 bytes', async () => {
  const sigBytes = crypto.randomBytes(64);
  const t = createFakeTransport({
    callResults: {
      release: { release_id: 'rel-1', recipient: VENDOR, amount: ONE_NEAR, purpose_hash: 'ab'.repeat(32) },
    },
  });
  const client = makeClient(t);

  const res = await client.release({ releaseId: 'rel-1', signature: sigBytes });
  let call = t.calls.functions[0];
  assert.equal(call.methodName, 'release');
  assert.deepEqual(call.args, { release_id: 'rel-1', gate_signature: sigBytes.toString('base64') });
  assert.equal(Buffer.from(call.args.gate_signature, 'base64').length, 64);
  assert.equal(res.released, true);
  assert.equal(res.amountYocto, ONE_NEAR);
  assert.equal(res.purposeHash, 'ab'.repeat(32));

  // The hex form of the same signature serializes identically.
  await client.release({ releaseId: 'rel-1', signature: sigBytes.toString('hex') });
  call = t.calls.functions[1];
  assert.equal(call.args.gate_signature, sigBytes.toString('base64'));
});

test('sealSecret maps id/ciphertextB64 to secret_id/ciphertext', async () => {
  const t = createFakeTransport();
  const client = makeClient(t);
  const res = await client.sealSecret({ id: 'api-key-1', ciphertextB64: 'Q0lQSEVSVEVYVC1EVU1NWQ==', label: 'demo' });
  assert.equal(t.calls.functions[0].methodName, 'seal_secret');
  assert.deepEqual(t.calls.functions[0].args, {
    secret_id: 'api-key-1',
    ciphertext: 'Q0lQSEVSVEVYVC1EVU1NWQ==',
    label: 'demo',
  });
  assert.deepEqual({ secretId: res.secretId, sealed: res.sealed }, { secretId: 'api-key-1', sealed: true });
});

test('useSecret returns the derived digest only', async () => {
  const derived = 'cd'.repeat(32);
  const t = createFakeTransport({
    callResults: { use_secret: { secret_id: 'api-key-1', operation: 'call billing api', derived } },
  });
  const client = makeClient(t);
  const res = await client.useSecret({ id: 'api-key-1', operation: 'call billing api' });
  assert.deepEqual(t.calls.functions[0].args, { secret_id: 'api-key-1', operation: 'call billing api' });
  assert.equal(res.derived, derived);
  assert.equal(res.secretId, 'api-key-1');
});

test('blocklist and counterparty calls use the contract arg names', async () => {
  const t = createFakeTransport({
    viewResults: {
      get_counterparty: {
        account: 'mallory.testnet',
        first_seen_block: 5000,
        interactions: 0,
        is_contract: true,
        code_changed: true,
        blocklisted: false,
        evidence: null,
      },
    },
  });
  const client = makeClient(t, { accountId: OWNER });

  const blocked = await client.addToBlocklist({ account: 'mallory.testnet', evidence: 'reported drain attempt, 2026-11-10' });
  assert.deepEqual(t.calls.functions[0].args, {
    account: 'mallory.testnet',
    evidence: 'reported drain attempt, 2026-11-10',
  });
  assert.equal(blocked.blocklisted, true);

  await client.removeFromBlocklist('mallory.testnet');
  assert.deepEqual(t.calls.functions[1].args, { account: 'mallory.testnet' });

  const record = await client.recordCounterparty({ account: 'mallory.testnet', isContract: true, codeHash: 'hashB' });
  assert.equal(t.calls.functions[2].methodName, 'record_counterparty');
  assert.deepEqual(t.calls.functions[2].args, {
    account: 'mallory.testnet',
    is_contract: true,
    code_hash: 'hashB',
  });
  // The return value is the refreshed view, normalised to the mock shape.
  assert.deepEqual(
    {
      firstSeenBlock: record.firstSeenBlock,
      interactions: record.interactions,
      isContract: record.isContract,
      codeChanged: record.codeChanged,
      blocklisted: record.blocklisted,
      evidence: record.evidence,
    },
    {
      firstSeenBlock: 5000,
      interactions: 0,
      isContract: true,
      codeChanged: true,
      blocklisted: false,
      evidence: null,
    }
  );
});

test('view calls hit the provider with snake_case methods and map results', async () => {
  const t = createFakeTransport({
    viewResults: {
      get_vault_state: {
        balance: '95000000000000000000000000',
        daily_spent: '5000000000000000000000000',
        daily_cap: '25000000000000000000000000',
        max_per_tx: '10000000000000000000000000',
        pending_count: 2,
        audit_count: 7,
      },
      get_counterparty: {
        account: VENDOR,
        first_seen_block: 1000,
        interactions: 12,
        is_contract: false,
        code_changed: false,
        blocklisted: false,
        evidence: null,
      },
      get_audit_log: [
        { seq: 1, block_height: 5001, timestamp: 1700000000000000000, actor: AGENT, action: 'release', detail: 'd', decision: 'released' },
      ],
      get_blocklist: [{ account: 'mallory.testnet', evidence: 'ev' }],
      get_release: {
        release_id: 'rel-3',
        recipient: VENDOR,
        amount: ONE_NEAR,
        purpose: 'p',
        purpose_hash: 'ef'.repeat(32),
        nonce: 'n',
        expiry: 1900000000,
        status: 'Allow',
        human_approved: false,
      },
    },
  });
  const client = makeClient(t);

  const state = await client.getVaultState();
  assert.equal(t.calls.views[0].method, 'get_vault_state');
  assert.equal(t.calls.views[0].contractId, VAULT);
  assert.equal(state.vaultBalanceYocto, '95000000000000000000000000');
  assert.equal(state.dailyCapYocto, '25000000000000000000000000');
  assert.equal(state.pendingCount, 2);

  const cp = await client.getCounterparty(VENDOR);
  assert.deepEqual(t.calls.views[1].args, { account: VENDOR });
  assert.equal(cp.interactions, 12);
  assert.equal(cp.firstSeenBlock, 1000);

  const log = await client.getAuditLog(5);
  assert.deepEqual(t.calls.views[2].args, { limit: 5 });
  assert.equal(log[0].block, 5001); // block_height mapped to the mock's `block`
  assert.equal(log[0].decision, 'released');

  const list = await client.getBlocklist();
  assert.deepEqual(list, [{ account: 'mallory.testnet', evidence: 'ev' }]);

  const rel = await client.getRelease('rel-3');
  assert.equal(rel.status, 'allow');
  assert.equal(rel.amountYocto, ONE_NEAR);
  assert.equal(rel.humanApproved, false);

  // The raw queries went out in the provider query form: finality final,
  // contract account id, snake_case method name, JSON args base64-encoded.
  assert.equal(t.calls.queries[0].request_type, 'call_function');
  assert.equal(t.calls.queries[0].finality, 'final');
  assert.equal(t.calls.queries[0].account_id, VAULT);
  assert.equal(t.calls.queries[0].method_name, 'get_vault_state');
  assert.equal(
    Buffer.from(t.calls.queries[1].args_base64, 'base64').toString('utf8'),
    JSON.stringify({ account: VENDOR })
  );
});

test('view calls return empty shapes when the query result is empty', async () => {
  const t = createFakeTransport();
  t.provider.query = async () => ({ result: [], logs: [] });
  const client = makeClient(t);
  const state = await client.getVaultState();
  assert.equal(state.vaultBalanceYocto, undefined);
  assert.equal(state.pendingCount, undefined);
  assert.deepEqual(await client.getBlocklist(), []);
  assert.deepEqual(await client.getAuditLog(5), []);
  assert.equal((await client.getCounterparty(VENDOR)).interactions, 0);
  assert.equal(await client.getRelease('rel-9'), null);
});

test('getBalance: own account via the account object, others via viewAccount', async () => {
  const t = createFakeTransport();
  const client = makeClient(t);
  assert.equal(await client.getBalance(AGENT), (7n * 10n ** 24n).toString());
  assert.equal(await client.getBalance(VENDOR), (42n * 10n ** 24n).toString());
  assert.deepEqual(t.calls.balanceRequests, [VENDOR]);
});

test('initialize sends caps as yocto strings and the gate key as base64', async () => {
  const t = createFakeTransport();
  const client = makeClient(t, { accountId: VAULT });
  const gateKeyBytes = crypto.randomBytes(32);
  const res = await client.initialize({
    owner: OWNER,
    gateAccount: 'gate.testnet',
    gatePublicKeyBytes: gateKeyBytes,
    maxPerTxYocto: (10n * 10n ** 24n).toString(),
    dailyCapYocto: (25n * 10n ** 24n).toString(),
    allowlistOnly: false,
  });
  const call = t.calls.functions[0];
  assert.equal(call.methodName, 'new');
  assert.deepEqual(call.args, {
    owner: OWNER,
    gate_account: 'gate.testnet',
    gate_public_key: gateKeyBytes.toString('base64'),
    max_per_tx: '10000000000000000000000000',
    daily_cap: '25000000000000000000000000',
    allowlist_only: false,
  });
  assert.equal(Buffer.from(call.args.gate_public_key, 'base64').length, 32);
  assert.equal(res.initialized, true);
});

test('deployContract forwards the wasm bytes to the account', async () => {
  const t = createFakeTransport();
  const client = makeClient(t, { accountId: VAULT });
  const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
  const res = await client.deployContract(wasm);
  assert.deepEqual(Array.from(t.calls.deploys[0]), Array.from(wasm));
  assert.equal(res.contractId, VAULT);
});

test('addAgentFunctionCallKey scopes the key to the vault and the three agent methods', async () => {
  const t = createFakeTransport();
  const client = makeClient(t); // signed in as the agent account
  const res = await client.addAgentFunctionCallKey({ agentPublicKey: 'ed25519:FAKEagentKey111111111111111111111111111' });
  const added = t.calls.addedKeys[0];
  assert.equal(added.contractId, VAULT);
  assert.deepEqual(added.methodNames, ['request_release', 'release', 'use_secret']);
  assert.deepEqual(AGENT_SCOPED_METHODS, ['request_release', 'release', 'use_secret']);
  assert.equal(added.allowance, '250000000000000000000000'); // 0.25 NEAR default
  assert.equal(added.publicKey, 'ed25519:FAKEagentKey111111111111111111111111111');
  assert.equal(res.agentAccountId, AGENT);
});

test('a contract panic surfaces as a classified NearCallError', async () => {
  const t = createFakeTransport({
    callResults: { release: new Error('wasm execution failed: Smart contract panicked: invalid gate signature') },
  });
  const client = makeClient(t);
  await assert.rejects(
    () => client.release({ releaseId: 'rel-1', signature: crypto.randomBytes(64) }),
    (err) => {
      assert.ok(err instanceof NearCallError);
      assert.equal(err.kind, 'contract_panic');
      assert.equal(err.method, 'release');
      assert.match(err.message, /invalid gate signature/);
      return true;
    }
  );
});

test('a failed transaction status surfaces as a NearCallError too', async () => {
  const t = createFakeTransport();
  t.account.callFunctionRaw = async () => ({
    transaction: { hash: FAKE_TX },
    status: { Failure: { error_message: 'Account does not exist', error_type: 'AccountDoesNotExist' } },
  });
  const client = makeClient(t);
  await assert.rejects(
    () => client.requestRelease({ recipient: VENDOR, amountYocto: ONE_NEAR, purpose: 'p', nonce: 'n', expiry: 1900000000 }),
    (err) => err instanceof NearCallError && err.kind === 'account_not_found'
  );
});

test('constructor refuses to build a live client without account and contract ids', () => {
  assert.throws(() => new NearChainClient({}), /accountId/);
  assert.throws(() => new NearChainClient({ accountId: AGENT }), /contractId/);
});

test('createChainClient defaults to sim and honours explicit modes', async () => {
  const saved = process.env.ARK_NEAR_SECRET_KEY;
  delete process.env.ARK_NEAR_SECRET_KEY;
  try {
    // No credentials anywhere: the sim path, backed by the demo world.
    const simClient = createChainClient();
    assert.ok(simClient instanceof MockChainClient);
    const state = await simClient.getVaultState();
    assert.equal(state.vaultBalanceYocto, (100n * 10n ** 24n).toString());

    // An explicit mock vault is used as given.
    const vault = new MockVault({
      owner: OWNER,
      gatePublicKeyBytes: crypto.randomBytes(32),
      maxPerTxYocto: ONE_NEAR,
      dailyCapYocto: ONE_NEAR,
    });
    const withVault = createChainClient({ mockVault: vault, caller: OWNER });
    assert.ok(withVault instanceof MockChainClient);
    assert.equal(withVault.vault, vault);
    assert.equal(withVault.caller, OWNER);

    // Explicit live mode builds the real client (transport injected here).
    const t = createFakeTransport();
    const live = createChainClient({
      mode: 'near',
      accountId: AGENT,
      contractId: VAULT,
      account: t.account,
      provider: t.provider,
    });
    assert.ok(live instanceof NearChainClient);

    // Credentials present with no mode: live wins over sim.
    const liveAuto = createChainClient({
      accountId: AGENT,
      contractId: VAULT,
      account: t.account,
      provider: t.provider,
    });
    assert.ok(liveAuto instanceof NearChainClient);
  } finally {
    if (saved !== undefined) process.env.ARK_NEAR_SECRET_KEY = saved;
  }
});
