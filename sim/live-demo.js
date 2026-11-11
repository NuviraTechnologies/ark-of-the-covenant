'use strict';

// Live demo runner — the sim/demo.js flow against NEAR TESTNET using the
// real NearChainClient (agent/chain-client.js). Roles:
//   owner  ark3owner2120.testnet  (full-access key from credentials/ark3-keys.json)
//   agent  ark3vault2120.testnet  (SCOPED function-call key from
//          credentials/agent-function-key.json — the key lives on the vault
//          account and can only call request_release/release/use_secret)
//   gate   keypair from credentials/gate-keypair.json (raw ed25519 signing)
// Recipients: vendor = ark3agent2120.testnet (record seeded, is_contract
// false, 0 interactions -> first payment Warns), attacker =
// ark3gate2120.testnet (on the shared blocklist).
//
// Run: node sim/live-demo.js
// Prints every step with its transaction hash; writes a JSON transcript to
// sim/live-demo-transcript.json (tx hashes + outcomes only, no secrets).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nearAPI = require('near-api-js');
const { NearChainClient } = require('../agent/chain-client');
const { GuardedAgent } = require('../agent/agent-wrapper');
const { createGate } = require('../agent/gate');
const { parseNear, formatNear } = require('./world');

const ROOT = path.join(__dirname, '..');
const RPC_URL = 'https://rpc.testnet.fastnear.com';
const VAULT = 'ark3vault2120.testnet';
const OWNER = 'ark3owner2120.testnet';
const VENDOR = 'ark3agent2120.testnet';
const ATTACKER = 'ark3gate2120.testnet';
const SECRET_ID = 'api-key-1';

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

// Direct state view via the provider's query API. (The client's _view uses
// provider.callFunction, which in near-api-js 7.5.2 resolves without a
// result against the FastNear RPC; the query form returns the bytes.)
async function viewState(provider) {
  const q = await provider.query({
    request_type: 'call_function',
    finality: 'final',
    account_id: VAULT,
    method_name: 'get_vault_state',
    args_base64: Buffer.from('{}').toString('base64'),
  });
  const r = JSON.parse(Buffer.from(q.result).toString('utf8'));
  return {
    vaultBalanceYocto: String(r.balance),
    dailySpentYocto: String(r.daily_spent),
    dailyCapYocto: String(r.daily_cap),
    maxPerTxYocto: String(r.max_per_tx),
    pendingCount: r.pending_count,
    auditCount: r.audit_count,
  };
}

// Build a gate service from the stored keypair file. The file holds the
// PKCS8 DER private key (base64); signing is RAW ed25519 via node:crypto,
// the same construction agent/gate.js createGateKeypair produces, so the
// signatures verify with the contract's env::ed25519_verify.
function loadGate() {
  const file = loadJson('credentials/gate-keypair.json');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(file.privateKeyPkcs8B64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKeyBytes = Buffer.from(file.publicKeyB64, 'base64');
  const keypair = {
    publicKeyBytes,
    sign: (messageString) =>
      crypto.sign(null, Buffer.from(String(messageString), 'utf8'), privateKey),
  };
  return createGate({ keypair });
}

async function main() {
  const ark3 = loadJson('credentials/ark3-keys.json');
  const agentFnKey = loadJson('credentials/agent-function-key.json');

  const ownerClient = new NearChainClient({
    accountId: OWNER,
    contractId: VAULT,
    secretKey: ark3.accounts.owner.secretKey,
    rpcUrl: RPC_URL,
  });
  // The agent client signs AS the vault account, but with the scoped
  // function-call key — that key can only call the three agent methods.
  const agentClient = new NearChainClient({
    accountId: VAULT,
    contractId: VAULT,
    secretKey: agentFnKey.secretKey,
    rpcUrl: RPC_URL,
  });
  const gate = loadGate();
  const guarded = new GuardedAgent({ agentClient, ownerClient, gate });
  const provider = new nearAPI.JsonRpcProvider({ url: RPC_URL });

  const transcript = { network: 'testnet', rpcUrl: RPC_URL, vault: VAULT, steps: [] };
  const record = (step, data) => {
    transcript.steps.push({ step, ...data });
    console.log(`\n=== ${step} ===`);
    console.log(JSON.stringify(data, null, 2));
  };

  const stateBefore = await viewState(provider);
  record('state-before', stateBefore);
  const vendorBefore = await ownerClient.getBalance(VENDOR);
  console.log(`vendor balance before: ${formatNear(vendorBefore)} NEAR`);

  // (a) First payment: 5 NEAR to the seeded vendor. Fresh on-chain
  // counterparty (0 interactions) -> Warn -> owner approves -> gate signs
  // -> agent releases with the scoped key.
  const pay1 = await guarded.pay({
    recipient: VENDOR,
    amountYocto: parseNear('5'),
    purpose: 'API subscription renewal',
    humanApprove: async ({ reason }) => {
      console.log(`  [human] Warn raised (${reason}); owner approves.`);
      return true;
    },
  });
  record('payment-1 (expect warn -> approve -> released)', pay1);

  const stateAfter1 = await viewState(provider);
  record('state-after-payment-1', stateAfter1);
  const vendorAfter1 = await ownerClient.getBalance(VENDOR);
  console.log(`vendor balance after payment 1: ${formatNear(vendorAfter1)} NEAR`);
  console.log(
    `vault balance delta: ${formatNear(
      (BigInt(stateBefore.vaultBalanceYocto) - BigInt(stateAfter1.vaultBalanceYocto)).toString()
    )} NEAR (expect ~5 + gas)`
  );

  // (b) Second identical payment: interaction history now exists -> Allow.
  const pay2 = await guarded.pay({
    recipient: VENDOR,
    amountYocto: parseNear('5'),
    purpose: 'API subscription renewal',
    humanApprove: async () => {
      console.log('  [human] unexpected Warn on second payment');
      return true;
    },
  });
  // The wrapper does not surface the request decision, so fetch the
  // request_release audit entry for this payment to show its status:
  // the second payment must read "allow: ok" (history now exists).
  const auditAfterPay2 = await ownerClient.getAuditLog(200);
  const lastRequest = [...auditAfterPay2]
    .reverse()
    .find((e) => e.action === 'request_release');
  console.log(
    `payment-2 request_release decision on-chain: ${lastRequest ? lastRequest.decision : '(not found)'}`
  );
  record('payment-2 (expect allow -> released)', pay2);

  const stateAfter2 = await viewState(provider);
  record('state-after-payment-2', stateAfter2);

  // (c) Injection: payment to the blocklisted attacker, amount inside the
  // caps so the refusal shown is the blocklist refusal.
  const drain = await guarded.pay({
    recipient: ATTACKER,
    amountYocto: parseNear('1'),
    purpose: 'vendor invoice payment',
    humanApprove: async () => true,
  });
  record('injection-attempt (expect blocked, blocklist reason)', drain);

  const stateAfter3 = await viewState(provider);
  record('state-after-injection', stateAfter3);
  console.log(
    `balance unchanged by injection: ${
      stateAfter2.vaultBalanceYocto === stateAfter3.vaultBalanceYocto ? 'YES' : 'NO'
    }`
  );

  // (d) use_secret via the scoped key: derived digest only.
  const secretUse = await agentClient.useSecret({
    id: SECRET_ID,
    operation: 'call billing api',
  });
  record('use-secret (expect 64-char hex digest only)', secretUse);
  console.log(
    `derived is 64-char hex: ${/^[0-9a-f]{64}$/.test(secretUse.derived || '')}`
  );

  // (e) Audit log from the contract.
  const audit = await ownerClient.getAuditLog(200);
  record('audit-log', { count: audit.length, entries: audit });

  const finalState = await viewState(provider);
  record('state-final', finalState);

  fs.writeFileSync(
    path.join(__dirname, 'live-demo-transcript.json'),
    JSON.stringify(transcript, null, 2)
  );
  console.log('\nTranscript written to sim/live-demo-transcript.json');
}

main().catch((err) => {
  console.error(`live demo crashed: ${err.stack || err.message}`);
  process.exitCode = 1;
});
