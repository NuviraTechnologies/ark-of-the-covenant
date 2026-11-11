'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { buildDemoWorld, parseNear } = require('../sim/world');
const { MockChainClient } = require('../agent/chain-client');
const { GuardedAgent } = require('../agent/agent-wrapper');
const { createGateKeypair } = require('../agent/gate');
const { gateMessage } = require('../core/purpose');

function setup() {
  const world = buildDemoWorld();
  const agentClient = new MockChainClient(world.vault, world.accounts.agent);
  const ownerClient = new MockChainClient(world.vault, world.accounts.owner);
  const guarded = new GuardedAgent({ agentClient, ownerClient, gate: world.gate });
  return { world, agentClient, ownerClient, guarded };
}

const approve = async () => true;
const decline = async () => false;

test('parseNear converts NEAR strings to yocto strings', () => {
  assert.equal(parseNear('1'), (10n ** 24n).toString());
  assert.equal(parseNear('1.5'), (15n * 10n ** 23n).toString());
  assert.equal(parseNear('0'), '0');
  assert.throws(() => parseNear('not-a-number'));
});

test('happy-path payment releases and balances move', async () => {
  const { world, guarded } = setup();
  const stateBefore = world.vault.getVaultState();
  assert.equal(stateBefore.vaultBalanceYocto, parseNear('100'));

  const res = await guarded.pay({
    recipient: world.accounts.vendor,
    amountYocto: parseNear('5'),
    purpose: 'API subscription renewal',
    humanApprove: approve,
  });

  assert.equal(res.outcome, 'released');
  assert.equal(res.release.released, true);
  assert.equal(res.release.recipient, world.accounts.vendor);
  assert.match(res.purposeHash, /^[0-9a-f]{64}$/);

  const stateAfter = world.vault.getVaultState();
  assert.equal(stateAfter.vaultBalanceYocto, parseNear('95'));
  assert.equal(stateAfter.dailySpentYocto, parseNear('5'));
  assert.equal(world.vault.getBalance(world.accounts.vendor), parseNear('5'));
});

test('warn path: human declines -> warn-declined and no balance change', async () => {
  const { world, guarded } = setup();

  // 'API subscription renewal' classifies as subscription, which the gate
  // accepts for a zero-interaction counterparty (payroll/vendor-payment
  // would be refused by the consistency check instead of reaching release).
  const res = await guarded.pay({
    recipient: 'newbie.testnet',
    amountYocto: parseNear('1'),
    purpose: 'API subscription renewal',
    humanApprove: decline,
  });

  assert.equal(res.outcome, 'warn-declined');
  assert.equal(world.vault.getBalance('newbie.testnet'), '0');
  assert.equal(world.vault.getVaultState().vaultBalanceYocto, parseNear('100'));
});

test('warn path: human approves -> released', async () => {
  const { world, guarded } = setup();

  const res = await guarded.pay({
    recipient: 'newbie.testnet',
    amountYocto: parseNear('1'),
    purpose: 'API subscription renewal',
    humanApprove: approve,
  });

  assert.equal(res.outcome, 'released');
  assert.equal(world.vault.getBalance('newbie.testnet'), parseNear('1'));
  assert.equal(world.vault.getVaultState().vaultBalanceYocto, parseNear('99'));
});

test('gate refusal for unclassifiable purpose', async () => {
  const { world, guarded } = setup();

  const res = await guarded.pay({
    recipient: world.accounts.vendor,
    amountYocto: parseNear('1'),
    purpose: 'buy me a sandwich please',
    humanApprove: approve,
  });

  assert.equal(res.outcome, 'gate-refused');
  assert.match(res.reason, /allowed category/);
  assert.equal(world.vault.getBalance(world.accounts.vendor), '0');
  assert.equal(world.vault.getVaultState().vaultBalanceYocto, parseNear('100'));
});

test('mock release rejects a wrong-key signature', async () => {
  const { world, agentClient } = setup();
  const { vault, accounts } = world;

  const nonce = crypto.randomUUID();
  const expiry = Math.floor(Date.now() / 1000) + 300;
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
  const forged = attackerKeypair.sign(message);

  assert.throws(
    () => vault.release({ caller: accounts.agent, releaseId: req.releaseId, signature: forged }),
    /invalid gate signature/
  );
  assert.equal(vault.getBalance(accounts.vendor), '0');
});

test('nonce replay is rejected', async () => {
  const { world, agentClient } = setup();
  const { vault, accounts } = world;

  const nonce = crypto.randomUUID();
  const expiry = Math.floor(Date.now() / 1000) + 300;
  const amountYocto = parseNear('1');
  const purpose = 'vendor invoice payment';
  const req = await agentClient.requestRelease({
    recipient: accounts.vendor,
    amountYocto,
    purpose,
    nonce,
    expiry,
  });
  const counterparty = await agentClient.getCounterparty(accounts.vendor);
  const decision = world.gate.decide({
    recipient: accounts.vendor,
    amountYocto,
    purpose,
    nonce,
    expiry,
    counterparty,
  });
  assert.equal(decision.decision, 'sign');

  const rel = await agentClient.release({ releaseId: req.releaseId, signature: decision.signature });
  assert.equal(rel.released, true);

  // Same releaseId + same signature again: the pending release is consumed.
  assert.throws(
    () => vault.release({ caller: accounts.agent, releaseId: req.releaseId, signature: decision.signature }),
    /pending release not found/
  );

  // Same nonce in a fresh request: rejected at request_release.
  assert.throws(
    () =>
      vault.requestRelease({
        caller: accounts.agent,
        recipient: accounts.vendor,
        amountYocto,
        purpose,
        nonce,
        expiry: Math.floor(Date.now() / 1000) + 300,
      }),
    /nonce already used/
  );
});
