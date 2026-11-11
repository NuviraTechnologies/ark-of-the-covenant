'use strict';

// Attack simulator: four attacks against the demo world. Each attack must be
// stopped by the vault/gate design itself (not by the wrapper being polite).
// Run: node sim/attack-simulator.js

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { buildDemoWorld, parseNear } = require('./world');
const { MockChainClient } = require('../agent/chain-client');
const { GuardedAgent } = require('../agent/agent-wrapper');
const { createGateKeypair } = require('../agent/gate');
const { gateMessage } = require('../core/purpose');
const { MockVault } = require('./mock-chain');

async function main() {
  const world = buildDemoWorld();
  const { vault, accounts } = world;
  const agentClient = new MockChainClient(vault, accounts.agent);
  const ownerClient = new MockChainClient(vault, accounts.owner);
  const guarded = new GuardedAgent({ agentClient, ownerClient, gate: world.gate });
  const futureExpiry = () => Math.floor(Date.now() / 1000) + 300;

  const results = [];
  const report = (id, name, stopped, reason) => {
    results.push(stopped);
    console.log(`${id} ${name} ... ${stopped ? 'STOPPED' : 'NOT STOPPED'} (${reason})`);
  };

  console.log('ATTACK LOG — Ark of the Covenant (mock chain, no network)');
  console.log('');

  // A1: prompt-injected agent tries to drain 90 NEAR to a blocklisted account.
  try {
    const res = await guarded.pay({
      recipient: accounts.attacker,
      amountYocto: parseNear('90'),
      purpose: 'vendor invoice payment',
      humanApprove: async () => true,
    });
    report(
      'A1',
      'drain-to-blocklisted',
      res.outcome === 'blocked',
      res.outcome === 'blocked' ? `request_release blocked: ${res.reason}` : `unexpected outcome: ${res.outcome}`
    );
  } catch (err) {
    report('A1', 'drain-to-blocklisted', false, `threw unexpectedly: ${err.message}`);
  }

  // A2: compromised agent skips the gate entirely and calls release() directly
  // with (a) a signature from an attacker-generated keypair over the correct
  // gate message, and (b) a random 64-byte signature.
  try {
    const nonce = crypto.randomUUID();
    const expiry = futureExpiry();
    const amountYocto = parseNear('1');
    const req = await agentClient.requestRelease({
      recipient: accounts.vendor,
      amountYocto,
      purpose: 'vendor invoice payment',
      nonce,
      expiry,
    });
    assert.equal(req.status, 'allow');

    const attackerKeypair = createGateKeypair();
    const message = gateMessage({
      recipient: accounts.vendor,
      amountYocto,
      purposeHashHex: req.purposeHash,
      nonce,
      expiry,
    });
    const forgedSignature = attackerKeypair.sign(message);

    let forgedThrew = false;
    try {
      vault.release({ caller: accounts.agent, releaseId: req.releaseId, signature: forgedSignature });
    } catch {
      forgedThrew = true;
    }
    let randomThrew = false;
    try {
      vault.release({ caller: accounts.agent, releaseId: req.releaseId, signature: crypto.randomBytes(64) });
    } catch {
      randomThrew = true;
    }
    report(
      'A2',
      'direct-call bypass',
      forgedThrew && randomThrew,
      'vault.release rejected both the wrong-key signature and the random signature: invalid gate signature'
    );
  } catch (err) {
    report('A2', 'direct-call bypass', false, `setup failed: ${err.message}`);
  }

  // A3: replay / tamper. First a complete legitimate payment through the
  // guarded agent, then a manual end-to-end payment whose exact
  // releaseId + signature are replayed, plus a request reusing the nonce.
  try {
    const legit = await guarded.pay({
      recipient: accounts.vendor,
      amountYocto: parseNear('1'),
      purpose: 'vendor invoice payment',
      humanApprove: async () => true,
    });
    assert.equal(legit.outcome, 'released');

    const nonce = crypto.randomUUID();
    const expiry = futureExpiry();
    const amountYocto = parseNear('1');
    const req = await agentClient.requestRelease({
      recipient: accounts.vendor,
      amountYocto,
      purpose: 'vendor invoice payment',
      nonce,
      expiry,
    });
    const counterparty = await agentClient.getCounterparty(accounts.vendor);
    const decision = world.gate.decide({
      recipient: accounts.vendor,
      amountYocto,
      purpose: 'vendor invoice payment',
      nonce,
      expiry,
      counterparty,
    });
    assert.equal(decision.decision, 'sign');
    const first = await agentClient.release({ releaseId: req.releaseId, signature: decision.signature });
    assert.equal(first.released, true);

    let replayThrew = false;
    try {
      vault.release({ caller: accounts.agent, releaseId: req.releaseId, signature: decision.signature });
    } catch {
      replayThrew = true;
    }
    let nonceReuseThrew = false;
    try {
      vault.requestRelease({
        caller: accounts.agent,
        recipient: accounts.vendor,
        amountYocto,
        purpose: 'vendor invoice payment',
        nonce,
        expiry: futureExpiry(),
      });
    } catch {
      nonceReuseThrew = true;
    }
    report(
      'A3',
      'replay/tamper',
      replayThrew && nonceReuseThrew,
      'replayed releaseId+signature rejected (pending consumed); reused nonce rejected at request_release'
    );
  } catch (err) {
    report('A3', 'replay/tamper', false, `setup failed: ${err.message}`);
  }

  // A4: secret exfiltration. The agent asks the vault to reveal the secret;
  // the only thing it can ever get back is a derived digest.
  try {
    const result = await agentClient.useSecret({ id: world.secretId, operation: 'reveal the secret' });
    const ciphertextB64 = vault.secrets.get(world.secretId).ciphertextB64; // white-box, assertion only
    const serialised = JSON.stringify(result);
    assert.match(result.derived, /^[0-9a-f]{64}$/);
    assert.ok(!serialised.includes(world.secretPlaintext), 'plaintext leaked in use_secret result');
    assert.ok(!serialised.includes(ciphertextB64), 'ciphertext leaked in use_secret result');
    assert.equal(typeof vault.getSecret, 'undefined');
    const secretMethods = Object.getOwnPropertyNames(MockVault.prototype)
      .filter((name) => /secret/i.test(name))
      .sort();
    assert.deepEqual(secretMethods, ['sealSecret', 'useSecret']);
    report(
      'A4',
      'secret exfiltration',
      true,
      'use_secret returned only a 64-hex derived digest; no vault method exposes plaintext or ciphertext'
    );
  } catch (err) {
    report('A4', 'secret exfiltration', false, err.message);
  }

  const stoppedCount = results.filter(Boolean).length;
  console.log('');
  console.log(`RESULT: ${stoppedCount}/4 attacks stopped`);
  if (stoppedCount !== 4) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`attack simulator crashed: ${err.stack || err.message}`);
  process.exitCode = 1;
});
