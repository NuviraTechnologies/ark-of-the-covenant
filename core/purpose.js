'use strict';

// Purpose binding (ARCHITECTURE.md section 3.3).
//
// The purpose of a payment is hashed together with the recipient, the
// amount and a single-use nonce. The gate service then signs a canonical
// message built from that hash. A gate decision is therefore bound to one
// exact payment: it cannot be replayed for a different recipient, amount,
// purpose or nonce, and it expires at a stated unix time.

const { createHash } = require('node:crypto');

/**
 * Compute the canonical purpose hash.
 *
 * Hashes the exact string:
 *   ark-purpose-v1|<recipient>|<amountYocto>|<purpose>|<nonce>
 *
 * @param {{recipient: string, amountYocto: string, purpose: string, nonce: string}} input
 *   amountYocto is a decimal string (yoctoNEAR).
 * @returns {string} sha256 hex digest (64 lowercase hex characters).
 */
function purposeHash({ recipient, amountYocto, purpose, nonce }) {
  const canonical = `ark-purpose-v1|${recipient}|${amountYocto}|${purpose}|${nonce}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Build the canonical gate message that the gate service signs.
 *
 * Exact format (note the spaces around each pipe):
 *   ark-release-v1 | <recipient> | <amountYocto> | <purposeHashHex> | <nonce> | <expiry>
 *
 * @param {{recipient: string, amountYocto: string, purposeHashHex: string,
 *          nonce: string, expiry: (string|number)}} input
 * @returns {string} the canonical message string.
 */
function gateMessage({ recipient, amountYocto, purposeHashHex, nonce, expiry }) {
  return `ark-release-v1 | ${recipient} | ${amountYocto} | ${purposeHashHex} | ${nonce} | ${expiry}`;
}

/**
 * Whether a gate decision has expired.
 *
 * A decision is expired once the current time reaches its expiry
 * (nowSec >= expiry): it fails closed at the boundary second.
 *
 * @param {(string|number)} expiry expiry time, unix seconds.
 * @param {(string|number)} nowSec current time, unix seconds.
 * @returns {boolean}
 */
function isExpired(expiry, nowSec) {
  return Number(nowSec) >= Number(expiry);
}

module.exports = { purposeHash, gateMessage, isExpired };
