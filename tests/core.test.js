'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const { purposeHash, gateMessage, isExpired } = require('../core/purpose');
const { checkCaps, classifyPurpose, checkPurposeConsistency } = require('../core/policy');
const { scoreCounterparty } = require('../core/counterparty');

const ONE_NEAR = '1000000000000000000000000';
const SIX_NEAR = '6000000000000000000000000';

function strangerRecord() {
  return {
    firstSeenBlock: null,
    interactions: 0,
    isContract: false,
    codeChanged: false,
    blocklisted: false,
    evidence: null,
  };
}

function knownRecord(overrides = {}) {
  return {
    firstSeenBlock: 0,
    interactions: 5,
    isContract: false,
    codeChanged: false,
    blocklisted: false,
    evidence: null,
    ...overrides,
  };
}

// --- purposeHash -----------------------------------------------------------

test('purposeHash is deterministic and matches the canonical string', () => {
  const input = {
    recipient: 'vendor.testnet',
    amountYocto: '5000000000000000000000000',
    purpose: 'API subscription renewal',
    nonce: 'nonce-1',
  };
  const first = purposeHash(input);
  const second = purposeHash({ ...input });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);

  const expected = createHash('sha256')
    .update(
      'ark-purpose-v1|vendor.testnet|5000000000000000000000000|API subscription renewal|nonce-1',
      'utf8',
    )
    .digest('hex');
  assert.equal(first, expected);
});

test('purposeHash is sensitive to each field', () => {
  const base = {
    recipient: 'vendor.testnet',
    amountYocto: '5000000000000000000000000',
    purpose: 'API subscription renewal',
    nonce: 'nonce-1',
  };
  const baseHash = purposeHash(base);

  assert.notEqual(purposeHash({ ...base, recipient: 'other.testnet' }), baseHash);
  assert.notEqual(purposeHash({ ...base, amountYocto: '5000000000000000000000001' }), baseHash);
  assert.notEqual(purposeHash({ ...base, purpose: 'API subscription renewal!' }), baseHash);
  assert.notEqual(purposeHash({ ...base, nonce: 'nonce-2' }), baseHash);
});

// --- gateMessage -----------------------------------------------------------

test('gateMessage uses the exact canonical format', () => {
  const message = gateMessage({
    recipient: 'vendor.testnet',
    amountYocto: '5000000000000000000000000',
    purposeHashHex: 'abc123',
    nonce: 'nonce-1',
    expiry: 1893456000,
  });
  assert.equal(
    message,
    'ark-release-v1 | vendor.testnet | 5000000000000000000000000 | abc123 | nonce-1 | 1893456000',
  );
});

// --- isExpired -------------------------------------------------------------

test('isExpired is false before expiry and true at and after it', () => {
  assert.equal(isExpired(2000, 1999), false);
  assert.equal(isExpired(2000, 2000), true);
  assert.equal(isExpired(2000, 2001), true);
});

// --- checkCaps -------------------------------------------------------------

test('checkCaps passes within both caps, including at the boundaries', () => {
  assert.deepEqual(
    checkCaps({
      amountYocto: '2000000000000000000000000',
      maxPerTxYocto: '5000000000000000000000000',
      dailyCapYocto: '10000000000000000000000000',
      dailySpentYocto: '3000000000000000000000000',
    }),
    { ok: true, reason: null },
  );
  // Amount exactly at the per-tx cap, and daily total exactly at the cap.
  assert.deepEqual(
    checkCaps({
      amountYocto: '5000000000000000000000000',
      maxPerTxYocto: '5000000000000000000000000',
      dailyCapYocto: '10000000000000000000000000',
      dailySpentYocto: '5000000000000000000000000',
    }),
    { ok: true, reason: null },
  );
});

test('checkCaps fails above the per-transaction cap', () => {
  assert.deepEqual(
    checkCaps({
      amountYocto: SIX_NEAR,
      maxPerTxYocto: '5000000000000000000000000',
      dailyCapYocto: '100000000000000000000000000',
      dailySpentYocto: '0',
    }),
    { ok: false, reason: 'exceeds per-transaction cap' },
  );
});

test('checkCaps fails when the payment would pass the daily cap', () => {
  assert.deepEqual(
    checkCaps({
      amountYocto: '2000000000000000000000000',
      maxPerTxYocto: '5000000000000000000000000',
      dailyCapYocto: '10000000000000000000000000',
      dailySpentYocto: '9000000000000000000000000',
    }),
    { ok: false, reason: 'exceeds daily cap' },
  );
});

// --- classifyPurpose -------------------------------------------------------

test('classifyPurpose classifies one phrase per category', () => {
  assert.equal(classifyPurpose('Monthly software subscription fee'), 'subscription');
  assert.equal(classifyPurpose('API usage credits top-up'), 'api-usage');
  assert.equal(classifyPurpose('November payroll run'), 'payroll');
  assert.equal(classifyPurpose('Vendor invoice 1042 due'), 'vendor-payment');
  assert.equal(classifyPurpose('Refund for a duplicate charge'), 'refund');
});

test('classifyPurpose covers the remaining keywords and case-insensitivity', () => {
  assert.equal(classifyPurpose('API subscription renewal'), 'subscription');
  assert.equal(classifyPurpose('RENEWAL of the hosting plan'), 'subscription');
  assert.equal(classifyPurpose('Pay as you go API calls'), 'api-usage');
  assert.equal(classifyPurpose('Staff salary payment'), 'payroll');
  assert.equal(classifyPurpose('Contractor wages for October'), 'payroll');
  assert.equal(classifyPurpose('Payment to a new vendor'), 'vendor-payment');
});

test('classifyPurpose returns null for an unclassifiable phrase', () => {
  assert.equal(classifyPurpose('Quarterly team lunch'), null);
  assert.equal(classifyPurpose('Miscellaneous transfer'), null);
  assert.equal(classifyPurpose(''), null);
});

// --- checkPurposeConsistency ----------------------------------------------

test('checkPurposeConsistency refuses payroll to a stranger', () => {
  assert.deepEqual(
    checkPurposeConsistency({ category: 'payroll', counterparty: strangerRecord() }),
    { ok: false, reason: 'payroll to a counterparty with no prior interactions' },
  );
});

test('checkPurposeConsistency refuses vendor-payment to a stranger', () => {
  assert.deepEqual(
    checkPurposeConsistency({ category: 'vendor-payment', counterparty: strangerRecord() }),
    { ok: false, reason: 'vendor-payment to a counterparty with no prior interactions' },
  );
});

test('checkPurposeConsistency passes a known vendor and a known payee', () => {
  const vendor = knownRecord({ interactions: 12 });
  assert.deepEqual(
    checkPurposeConsistency({ category: 'vendor-payment', counterparty: vendor }),
    { ok: true, reason: null },
  );
  assert.deepEqual(
    checkPurposeConsistency({ category: 'payroll', counterparty: knownRecord({ interactions: 3 }) }),
    { ok: true, reason: null },
  );
});

test('checkPurposeConsistency allows a subscription to a stranger but never a blocklisted account', () => {
  assert.deepEqual(
    checkPurposeConsistency({ category: 'subscription', counterparty: strangerRecord() }),
    { ok: true, reason: null },
  );

  const blocked = knownRecord({
    blocklisted: true,
    evidence: 'reported drain attempt, 2026-11-10',
  });
  const result = checkPurposeConsistency({ category: 'subscription', counterparty: blocked });
  assert.equal(result.ok, false);
  assert.match(result.reason, /blocklisted/);
});

// --- scoreCounterparty -----------------------------------------------------

test('scoreCounterparty blocks a blocklisted account with its evidence', () => {
  const record = knownRecord({
    blocklisted: true,
    evidence: 'reported drain attempt, 2026-11-10',
  });
  assert.deepEqual(scoreCounterparty(record, { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'block',
    reasons: ['on shared blocklist: reported drain attempt, 2026-11-10'],
  });
});

test('scoreCounterparty warns on a new account with no interaction history', () => {
  const recent = knownRecord({ firstSeenBlock: 995, interactions: 0 });
  assert.deepEqual(scoreCounterparty(recent, { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: ['new account with no interaction history'],
  });

  // Never seen at all warns the same way.
  assert.deepEqual(
    scoreCounterparty(strangerRecord(), { amountYocto: ONE_NEAR, currentBlock: 1000 }),
    { status: 'warn', reasons: ['new account with no interaction history'] },
  );

  // Old enough and seen before: no new-account warn.
  const oldStranger = knownRecord({ firstSeenBlock: 0, interactions: 0 });
  assert.deepEqual(scoreCounterparty(oldStranger, { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'allow',
    reasons: [],
  });
});

test('scoreCounterparty warns when contract code changed', () => {
  const record = knownRecord({ isContract: true, codeChanged: true });
  assert.deepEqual(scoreCounterparty(record, { amountYocto: ONE_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: ['contract code changed since last interaction'],
  });
});

test('scoreCounterparty warns on a large first payment', () => {
  const record = knownRecord({ interactions: 0 });
  assert.deepEqual(scoreCounterparty(record, { amountYocto: SIX_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: ['first payment to this counterparty above warn threshold'],
  });

  // Same record, amount at the threshold: no warn.
  assert.deepEqual(
    scoreCounterparty(record, {
      amountYocto: '5000000000000000000000000',
      currentBlock: 1000,
    }),
    { status: 'allow', reasons: [] },
  );

  // A custom threshold is honoured.
  assert.deepEqual(
    scoreCounterparty(record, {
      amountYocto: ONE_NEAR,
      warnAmountYocto: '500000000000000000000000',
      currentBlock: 1000,
    }),
    { status: 'warn', reasons: ['first payment to this counterparty above warn threshold'] },
  );
});

test('scoreCounterparty collects all applicable warn reasons', () => {
  const record = knownRecord({
    firstSeenBlock: 999,
    interactions: 0,
    isContract: true,
    codeChanged: true,
  });
  assert.deepEqual(scoreCounterparty(record, { amountYocto: SIX_NEAR, currentBlock: 1000 }), {
    status: 'warn',
    reasons: [
      'new account with no interaction history',
      'contract code changed since last interaction',
      'first payment to this counterparty above warn threshold',
    ],
  });
});

test('scoreCounterparty allows an established counterparty', () => {
  assert.deepEqual(
    scoreCounterparty(knownRecord(), { amountYocto: ONE_NEAR, currentBlock: 1000 }),
    { status: 'allow', reasons: [] },
  );
});
