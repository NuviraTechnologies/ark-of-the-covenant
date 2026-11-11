'use strict';

// Demo world: a fully local Ark setup — gate keypair, mock vault funded with
// 100 test NEAR, seeded counterparty records and one sealed secret. No
// network, standard cryptography only.

const crypto = require('node:crypto');
const { MockVault } = require('./mock-chain');
const { createGateKeypair, createGate } = require('../agent/gate');

const YOCTO_PER_NEAR = 10n ** 24n;

// parseNear('5') / parseNear('1.5') -> yocto string (BigInt math).
function parseNear(str) {
  const text = String(str).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`invalid NEAR amount: ${str}`);
  const whole = match[1];
  const fraction = match[2] || '';
  if (fraction.length > 24) {
    throw new Error(`NEAR amount has more than 24 decimal places: ${str}`);
  }
  const yocto = BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, '0') || '0');
  return yocto.toString();
}

// formatNear(yoctoString) -> short human string for demo output.
function formatNear(yoctoStr) {
  const yocto = BigInt(String(yoctoStr));
  const whole = yocto / YOCTO_PER_NEAR;
  const fraction = yocto % YOCTO_PER_NEAR;
  if (fraction === 0n) return whole.toString();
  const frac = fraction.toString().padStart(24, '0').replace(/0+$/, '');
  return `${whole.toString()}.${frac}`;
}

function buildDemoWorld() {
  const accounts = {
    owner: 'owner.testnet',
    agent: 'agent.testnet',
    vendor: 'vendor.testnet',
    attacker: 'attacker.testnet',
  };

  const gateKeypair = createGateKeypair();
  const gate = createGate({ keypair: gateKeypair });

  const vault = new MockVault({
    owner: accounts.owner,
    gatePublicKeyBytes: gateKeypair.publicKeyBytes,
    maxPerTxYocto: parseNear('10'),
    dailyCapYocto: parseNear('25'),
    allowlistOnly: false,
  });
  vault.currentBlock = 5000;

  vault.deposit({ from: accounts.owner, amountYocto: parseNear('100') });

  // Seeded counterparty records, stored inside the vault.
  vault.counterparties.set(accounts.vendor, {
    firstSeenBlock: 1000,
    interactions: 12,
    isContract: false,
    codeChanged: false,
    blocklisted: false,
    evidence: null,
  });
  vault.addToBlocklist({
    caller: accounts.owner,
    account: accounts.attacker,
    evidence: 'reported drain attempt, 2026-11-10',
  });

  // Sealed secret: the demo plaintext is encrypted locally with AES-256-GCM.
  // The encryption key stands in for key material held inside a TEE in the
  // production design; it lives ONLY in this world object and is never
  // printed. Only the ciphertext (base64) is stored in the vault.
  const secretId = 'api-key-1';
  const secretPlaintext = 'DEMO-ONLY-plaintext-not-a-real-key';
  const teeKeyStandIn = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', teeKeyStandIn, iv);
  const encrypted = Buffer.concat([
    cipher.update(secretPlaintext, 'utf8'),
    cipher.final(),
  ]);
  const ciphertextB64 = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  vault.sealSecret({
    caller: accounts.owner,
    id: secretId,
    ciphertextB64,
    label: 'Demo API key (sealed)',
  });

  return {
    vault,
    gate,
    gateKeypair,
    accounts,
    secretId,
    // For test assertions only — the demo and simulator never print this.
    secretPlaintext,
    teeKeyStandIn,
  };
}

module.exports = { buildDemoWorld, parseNear, formatNear };
