'use strict';

// Off-chain gate service: purpose-semantic checks + ed25519 signing.
//
// Signing uses RAW ed25519 via node:crypto so the resulting signatures are
// compatible with NEAR's on-chain env::ed25519_verify, which verifies a raw
// ed25519 signature over the exact message bytes. (near-api-js's sign helper
// pre-hashes the message before signing, which would NOT verify on-chain —
// that is why this module deliberately avoids it.)

const crypto = require('node:crypto');
const { purposeHash, gateMessage } = require('../core/purpose');
const { classifyPurpose, checkPurposeConsistency } = require('../core/policy');

// DER prefix for an ed25519 SubjectPublicKeyInfo: the SPKI header followed by
// the raw 32-byte public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function createGateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  if (
    spkiDer.length !== ED25519_SPKI_PREFIX.length + 32 ||
    !spkiDer.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    throw new Error('unexpected ed25519 SPKI DER layout');
  }
  const publicKeyBytes = Buffer.from(spkiDer.subarray(ED25519_SPKI_PREFIX.length));

  function sign(messageString) {
    // Raw ed25519: algorithm must be null; signature is 64 bytes over the
    // exact UTF-8 message bytes.
    return crypto.sign(null, Buffer.from(String(messageString), 'utf8'), privateKey);
  }

  return { publicKey, privateKey, publicKeyBytes, sign };
}

function verifyGateSignature({ publicKeyBytes, message, signatureBytes }) {
  try {
    const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]);
    const keyObject = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(
      null,
      Buffer.from(String(message), 'utf8'),
      keyObject,
      Buffer.from(signatureBytes)
    );
  } catch {
    return false;
  }
}

function createGate({ keypair }) {
  if (!keypair || !keypair.publicKeyBytes) {
    throw new Error('createGate requires a keypair from createGateKeypair()');
  }
  const sign =
    typeof keypair.sign === 'function'
      ? keypair.sign
      : (messageString) =>
          crypto.sign(null, Buffer.from(String(messageString), 'utf8'), keypair.privateKey);

  return {
    publicKeyBytes: keypair.publicKeyBytes,

    decide({ recipient, amountYocto, purpose, nonce, expiry, counterparty }) {
      const category = classifyPurpose(purpose);
      if (!category) {
        return { decision: 'refuse', reason: 'purpose does not match an allowed category' };
      }

      const consistency = checkPurposeConsistency({ category, counterparty });
      if (!consistency.ok) {
        return { decision: 'refuse', reason: consistency.reason };
      }

      if (counterparty && counterparty.blocklisted) {
        const evidence = counterparty.evidence ? ` (evidence: ${counterparty.evidence})` : '';
        return { decision: 'refuse', reason: `counterparty is blocklisted${evidence}` };
      }

      const amount = String(amountYocto);
      const hash = purposeHash({ recipient, amountYocto: amount, purpose, nonce });
      const message = gateMessage({
        recipient,
        amountYocto: amount,
        purposeHashHex: hash,
        nonce,
        expiry,
      });
      const signature = sign(message);
      return { decision: 'sign', signature, purposeHash: hash, category };
    },
  };
}

module.exports = { createGateKeypair, verifyGateSignature, createGate };
