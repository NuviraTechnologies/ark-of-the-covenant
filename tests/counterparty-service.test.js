'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CounterpartyService = require('../services/counterparty-service');
const { CounterpartyService: NamedCounterpartyService } = require('../services/counterparty-service');

const ONE_NEAR = '1000000000000000000000000';
const SIX_NEAR = '6000000000000000000000000';
const SERVICE_PATH = path.join(__dirname, '..', 'services', 'counterparty-service.js');

test('the class is exported both as the module and as a named property', () => {
  assert.equal(typeof CounterpartyService, 'function');
  assert.equal(NamedCounterpartyService, CounterpartyService);
});

test('report creates a record that scores as new until it ages', () => {
  const service = new CounterpartyService();
  const record = service.report('newbie.testnet', {
    isContract: false,
    codeHash: null,
    currentBlock: 995,
  });
  assert.equal(record.firstSeenBlock, 995);
  assert.equal(record.interactions, 0);

  assert.deepEqual(service.check('newbie.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: ['new account with no interaction history'],
  });
  // 100 blocks later the same record no longer counts as new.
  assert.deepEqual(service.check('newbie.testnet', { amountYocto: ONE_NEAR, currentBlock: 1095 }), {
    status: 'allow',
    reasons: [],
  });
});

test('check treats an unknown account as brand-new', () => {
  const service = new CounterpartyService();
  assert.deepEqual(service.check('ghost.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: ['new account with no interaction history'],
  });
});

test('report detects a code change and stores the latest hash', () => {
  const service = new CounterpartyService();
  service.report('contract.testnet', {
    isContract: true,
    codeHash: 'hash-v1',
    currentBlock: 0,
  });
  service.noteInteraction('contract.testnet');
  service.noteInteraction('contract.testnet');

  // Same hash reported again: no change flagged, still allowed.
  const same = service.report('contract.testnet', {
    isContract: true,
    codeHash: 'hash-v1',
    currentBlock: 500,
  });
  assert.equal(same.codeChanged, false);
  assert.deepEqual(service.check('contract.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'allow',
    reasons: [],
  });

  // A different hash flags codeChanged and the check warns.
  const changed = service.report('contract.testnet', {
    isContract: true,
    codeHash: 'hash-v2',
    currentBlock: 600,
  });
  assert.equal(changed.codeChanged, true);
  assert.equal(changed.codeHash, 'hash-v2');
  assert.equal(changed.firstSeenBlock, 0);
  assert.deepEqual(service.check('contract.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: ['contract code changed since last interaction'],
  });
});

test('block makes check return block, and unblock restores the score', () => {
  const service = new CounterpartyService();
  service.report('vendor.testnet', {
    isContract: false,
    codeHash: 'vendor-code-v1',
    currentBlock: 0,
  });
  service.noteInteraction('vendor.testnet');

  service.block('vendor.testnet', 'reported drain attempt, 2026-11-10');
  assert.deepEqual(service.check('vendor.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'block',
    reasons: ['on shared blocklist: reported drain attempt, 2026-11-10'],
  });

  service.unblock('vendor.testnet');
  assert.deepEqual(service.check('vendor.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'allow',
    reasons: [],
  });
});

test('block works for an account that was never reported', () => {
  const service = new CounterpartyService();
  service.block('attacker.testnet', 'reported drain attempt, 2026-11-10');
  assert.deepEqual(service.check('attacker.testnet', { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'block',
    reasons: ['on shared blocklist: reported drain attempt, 2026-11-10'],
  });
});

test('noteInteraction removes the new-account and large-first-payment warns', () => {
  const service = new CounterpartyService();
  service.report('newbie.testnet', {
    isContract: false,
    codeHash: null,
    currentBlock: 995,
  });

  const before = service.check('newbie.testnet', {
    amountYocto: SIX_NEAR,
    currentBlock: 1000,
  });
  assert.equal(before.status, 'warn');
  assert.deepEqual(before.reasons, [
    'new account with no interaction history',
    'first payment to this counterparty above warn threshold',
  ]);

  const record = service.noteInteraction('newbie.testnet');
  assert.equal(record.interactions, 1);

  assert.deepEqual(
    service.check('newbie.testnet', { amountYocto: SIX_NEAR, currentBlock: 1000 }),
    { status: 'allow', reasons: [] },
  );
});

test('noteInteraction increments the stored interaction count', () => {
  const service = new CounterpartyService();
  service.report('vendor.testnet', {
    isContract: false,
    codeHash: null,
    currentBlock: 0,
  });
  service.noteInteraction('vendor.testnet');
  service.noteInteraction('vendor.testnet');
  const record = service.noteInteraction('vendor.testnet');
  assert.equal(record.interactions, 3);
  assert.equal(service.getRecord('vendor.testnet').interactions, 3);
});

// --- CLI -------------------------------------------------------------------

function runCli(account) {
  const out = execFileSync(process.execPath, [SERVICE_PATH, 'check', account], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

test('CLI check: seeded vendor is allowed', () => {
  assert.deepEqual(runCli('vendor.testnet'), { status: 'allow', reasons: [] });
});

test('CLI check: seeded attacker is blocked with evidence', () => {
  assert.deepEqual(runCli('attacker.testnet'), {
    status: 'block',
    reasons: ['on shared blocklist: reported drain attempt, 2026-11-10'],
  });
});

test('CLI check: seeded newbie warns as a new account', () => {
  assert.deepEqual(runCli('newbie.testnet'), {
    status: 'warn',
    reasons: ['new account with no interaction history'],
  });
});

test('CLI check: an unknown account is treated as brand-new', () => {
  assert.deepEqual(runCli('someone-else.testnet'), {
    status: 'warn',
    reasons: ['new account with no interaction history'],
  });
});
