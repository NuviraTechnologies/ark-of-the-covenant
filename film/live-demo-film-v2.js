'use strict';

// Film runner v2 — the live demo flow against NEAR TESTNET, formatted for
// the v2 demo video (see film/shotlist-v2.md and film/run-of-show-nov12.md).
// NOT FOR NOV 11: the filmed flow spends 10 NEAR of daily cap and needs the
// UTC day roll (2026-11-12T00:00:00Z) plus a FRESH vendor with no
// interaction history, so the first payment takes the Warn path.
//
// Flow:
//   state -> payment 1: 5 NEAR to the fresh vendor (Warn -> owner approves
//   -> gate signs -> released) -> payment 2: the identical 5 NEAR again
//   (Allow -> gate signs -> released) -> 1 NEAR drain attempt to the
//   blocklisted account (Block, no spend) -> use_secret digest -> audit
//   tail -> state.
//
// The vendor account id comes from ARK_FILM_VENDOR (default
// ark3vendor2120.testnet). The vendor must NOT be recorded in the vault
// beforehand: the contract scores an unrecorded account from the default
// record (first_seen_block null, interactions 0) -> Warn.
//
// Clean labeled lines, brief pauses between steps, and an incremental
// timestamped transcript at film/live-demo-film-v2-transcript.jsonl (one
// JSON object per printed line: { t: ms since start, line }) so the
// terminal replay renders from exactly what printed, even if the run is
// interrupted. Line phrasing matches sim/live-demo-film.js so the v1
// renderer's line styling carries over ("contract decision: X - reason",
// "RELEASED. tx ...").
//
// Prints NO secrets: credential files are loaded for signing only and
// their contents are never written to stdout or the transcript.
//
// Run ONCE for the capture: node film/live-demo-film-v2.js

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nearAPI = require('near-api-js');
const { NearChainClient } = require('../agent/chain-client');
const { createGate } = require('../agent/gate');
const { parseNear } = require('../sim/world');

const ROOT = path.join(__dirname, '..');
const RPC_URL = 'https://rpc.testnet.fastnear.com';
const VAULT = 'ark3vault2120.testnet';
const OWNER = 'ark3owner2120.testnet';
const VENDOR = process.env.ARK_FILM_VENDOR || 'ark3vendor2120.testnet';
const ATTACKER = 'ark3gate2120.testnet';
const SECRET_ID = 'api-key-1';
const PAYMENT_PURPOSE = 'API subscription renewal';
const TRANSCRIPT = path.join(__dirname, 'live-demo-film-v2-transcript.jsonl');

const t0 = Date.now();
function say(line = '') {
  console.log(line);
  fs.appendFileSync(TRANSCRIPT, JSON.stringify({ t: Date.now() - t0, line }) + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NEAR amount with 3 decimals, e.g. 19.993 (display only).
function fmtNear(yoctoStr) {
  const y = BigInt(String(yoctoStr));
  const whole = y / 10n ** 24n;
  const milli = (y % 10n ** 24n) / 10n ** 21n;
  return `${whole}.${String(milli).padStart(3, '0')}`;
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

// Views via the provider's query API (the form that returns result bytes
// against the FastNear RPC — see the client quirk note in BUILD-LOG).
async function viewCall(provider, method, args) {
  const q = await provider.query({
    request_type: 'call_function',
    finality: 'final',
    account_id: VAULT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(q.result).toString('utf8'));
}

async function viewState(provider) {
  const r = await viewCall(provider, 'get_vault_state', {});
  return {
    balance: String(r.balance),
    dailySpent: String(r.daily_spent),
    dailyCap: String(r.daily_cap),
    auditCount: r.audit_count,
  };
}

async function accountBalance(provider, accountId) {
  const v = await provider.viewAccount({ accountId });
  return String(v.amount);
}

async function fetchCounterparty(provider, account) {
  const cpRaw = await viewCall(provider, 'get_counterparty', { account });
  return {
    firstSeenBlock: cpRaw.first_seen_block ?? null,
    interactions: cpRaw.interactions ?? 0,
    isContract: Boolean(cpRaw.is_contract),
    codeChanged: Boolean(cpRaw.code_changed),
    blocklisted: Boolean(cpRaw.blocklisted),
    evidence: cpRaw.evidence ?? null,
  };
}

// Gate service from the stored keypair file (raw ed25519 via node:crypto,
// same construction as sim/live-demo-film.js). The file's contents are
// never printed.
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
  fs.writeFileSync(TRANSCRIPT, '');
  const ark3 = loadJson('credentials/ark3-keys.json');
  const agentFnKey = loadJson('credentials/agent-function-key.json');
  const ownerClient = new NearChainClient({
    accountId: OWNER,
    contractId: VAULT,
    secretKey: ark3.accounts.owner.secretKey,
    rpcUrl: RPC_URL,
  });
  // The agent client signs AS the vault account with the scoped
  // function-call key (request_release / release / use_secret only).
  const agentClient = new NearChainClient({
    accountId: VAULT,
    contractId: VAULT,
    secretKey: agentFnKey.secretKey,
    rpcUrl: RPC_URL,
  });
  const gate = loadGate();
  const provider = new nearAPI.JsonRpcProvider({ url: RPC_URL });

  // One full payment cycle: request -> (Warn: owner approves) -> gate
  // signs the exact tuple -> release. Returns false if the run must stop.
  async function payOnce(label, headerLine) {
    say('');
    say(label);
    say(headerLine);
    const vendorBefore = await accountBalance(provider, VENDOR);
    say(`    agent asks: pay 5 NEAR to ${VENDOR}`);
    say(`    purpose: "${PAYMENT_PURPOSE}"`);
    const nonce = crypto.randomUUID();
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const req = await agentClient.requestRelease({
      recipient: VENDOR,
      amountYocto: parseNear('5'),
      purpose: PAYMENT_PURPOSE,
      nonce,
      expiry,
    });
    say(`    contract decision: ${req.status.toUpperCase()} - ${req.reason}`);
    if (req.status === 'block') {
      say('    UNEXPECTED BLOCK on the payment - stopping the film run here');
      process.exitCode = 2;
      return false;
    }
    if (req.status === 'warn') {
      say('    this one needs a human: the owner approves on-chain...');
      await ownerClient.approveRelease(req.releaseId);
      say('    owner approved');
    }
    await sleep(1200);
    const counterparty = await fetchCounterparty(provider, VENDOR);
    const decision = gate.decide({
      recipient: VENDOR,
      amountYocto: parseNear('5'),
      purpose: PAYMENT_PURPOSE,
      nonce,
      expiry,
      counterparty,
    });
    if (decision.decision === 'refuse') {
      say(`    gate refused to sign: ${decision.reason} - stopping the film run here`);
      process.exitCode = 2;
      return false;
    }
    say('    gate signs this exact payment: recipient + amount + purpose + nonce');
    const rel = await agentClient.release({ releaseId: req.releaseId, signature: decision.signature });
    say(`    RELEASED. tx ${rel.txHash}`);
    const vendorAfter = await accountBalance(provider, VENDOR);
    say(`    vendor balance: ${fmtNear(vendorBefore)} -> ${fmtNear(vendorAfter)} NEAR`);
    await sleep(2000);
    return true;
  }

  say('ARK OF THE COVENANT - live on NEAR testnet');
  say(`vault: ${VAULT}`);
  say('the agent holds only a scoped key: it can ask, it cannot just take');
  await sleep(1800);

  const before = await viewState(provider);
  say('');
  say('[1] VAULT STATE BEFORE');
  say(
    `    balance ${fmtNear(before.balance)} NEAR | spent today ${fmtNear(before.dailySpent)} of ${fmtNear(before.dailyCap)} NEAR daily cap | audit entries: ${before.auditCount}`
  );
  await sleep(1800);

  // --- payment 1: fresh vendor, Warn path with owner approval ---
  const firstOk = await payOnce(
    '[2] FIRST PAYMENT - a vendor this vault has never paid',
    '    first contact: the contract has no history for this account'
  );
  if (!firstOk) return;

  // --- payment 2: identical payment, vendor now has history, Allow ---
  const secondOk = await payOnce(
    '[3] SAME PAYMENT AGAIN - the vendor has a clean record now',
    '    same recipient, same amount, same purpose'
  );
  if (!secondOk) return;

  // --- the drain: 1 NEAR to the blocklisted account (Block, no spend) ---
  say('');
  say('[4] THE DRAIN - a poisoned instruction tries to pay a blocked account');
  say(`    the agent is told: pay 1 NEAR to ${ATTACKER}`);
  const atk = await agentClient.requestRelease({
    recipient: ATTACKER,
    amountYocto: parseNear('1'),
    purpose: 'vendor invoice payment',
    nonce: crypto.randomUUID(),
    expiry: Math.floor(Date.now() / 1000) + 300,
  });
  say(`    contract decision: ${atk.status.toUpperCase()} - ${atk.reason}`);
  const atkBalance = await accountBalance(provider, ATTACKER);
  say(`    no release was created. attacker balance: ${fmtNear(atkBalance)} NEAR`);
  say('    the refusal itself is written into the vault audit log');
  await sleep(2000);

  // --- sealed secret: digest only ---
  say('');
  say('[5] SEALED SECRET - used, never read');
  const su = await agentClient.useSecret({ id: SECRET_ID, operation: 'call billing api' });
  say(`    use_secret("${SECRET_ID}", "call billing api") via the scoped key`);
  say(`    returned: ${su.derived}`);
  say('    a 64-character fingerprint only - no plaintext, no ciphertext');
  say(`    tx ${su.txHash}`);
  await sleep(1800);

  // --- audit tail + final state ---
  const audit = await viewCall(provider, 'get_audit_log', { limit: 200 });
  say('');
  say('[6] AUDIT LOG - last entries, written by the contract itself');
  for (const e of audit.slice(-5)) {
    say(`    #${e.seq} ${e.action}: ${e.decision}`);
  }
  await sleep(1800);
  const after = await viewState(provider);
  say('');
  say('[7] VAULT STATE AFTER');
  say(
    `    balance ${fmtNear(after.balance)} NEAR | spent today ${fmtNear(after.dailySpent)} of ${fmtNear(after.dailyCap)} NEAR daily cap | audit entries: ${after.auditCount}`
  );
  say('');
  say('the vault held. the agent asked; the contract decided.');
}

main().catch((err) => {
  try {
    say(`FILM RUN ERROR: ${err.message}`);
  } catch {
    // transcript write failed too; stdout below still records it
  }
  console.error(`film run crashed: ${err.stack || err.message}`);
  process.exitCode = 1;
});
