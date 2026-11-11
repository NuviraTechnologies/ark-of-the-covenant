'use strict';

// Counterparty scoring (ARCHITECTURE.md section 4).
//
// Decision order: blocklist -> Block; any warn signal -> Warn (all
// applicable warn reasons are collected); otherwise Allow.

const DEFAULT_WARN_AMOUNT_YOCTO = '5000000000000000000000000'; // 5 NEAR
const DEFAULT_NEW_ACCOUNT_MIN_BLOCKS = 100;

/**
 * Score a counterparty record for a proposed payment.
 *
 * Warn signals, checked in this order after the blocklist:
 *   (b) new account with no interaction history: the account was never
 *       seen (firstSeenBlock === null) or was first seen fewer than
 *       newAccountMinBlocks blocks ago, and interactions === 0.
 *   (c) contract code changed since the last interaction.
 *   (d) first payment above the warn threshold: interactions === 0 and
 *       amountYocto > warnAmountYocto.
 *
 * @param {{firstSeenBlock: (number|null), interactions: number,
 *          isContract: boolean, codeChanged: boolean,
 *          blocklisted: boolean, evidence: (string|null)}} record
 * @param {{amountYocto: (string|undefined),
 *          warnAmountYocto: (string|undefined),
 *          newAccountMinBlocks: (number|undefined),
 *          currentBlock: (number|undefined)}} [opts]
 * @returns {{status: ('allow'|'warn'|'block'), reasons: string[]}}
 */
function scoreCounterparty(record, opts = {}) {
  const warnAmountYocto =
    opts.warnAmountYocto !== undefined ? opts.warnAmountYocto : DEFAULT_WARN_AMOUNT_YOCTO;
  const newAccountMinBlocks =
    opts.newAccountMinBlocks !== undefined
      ? opts.newAccountMinBlocks
      : DEFAULT_NEW_ACCOUNT_MIN_BLOCKS;
  const currentBlock = opts.currentBlock;

  // (a) Blocklist: terminal, no other signals are reported.
  if (record.blocklisted) {
    return { status: 'block', reasons: [`on shared blocklist: ${record.evidence}`] };
  }

  const reasons = [];

  // (b) New account with no interaction history.
  const neverSeen = record.firstSeenBlock === null || record.firstSeenBlock === undefined;
  const recentlySeen =
    !neverSeen &&
    typeof currentBlock === 'number' &&
    currentBlock - record.firstSeenBlock < newAccountMinBlocks;
  if ((neverSeen || recentlySeen) && record.interactions === 0) {
    reasons.push('new account with no interaction history');
  }

  // (c) Contract code changed since the last interaction.
  if (record.codeChanged) {
    reasons.push('contract code changed since last interaction');
  }

  // (d) First payment to this counterparty above the warn threshold.
  if (
    record.interactions === 0 &&
    opts.amountYocto !== undefined &&
    opts.amountYocto !== null &&
    BigInt(opts.amountYocto) > BigInt(warnAmountYocto)
  ) {
    reasons.push('first payment to this counterparty above warn threshold');
  }

  if (reasons.length > 0) {
    return { status: 'warn', reasons };
  }
  return { status: 'allow', reasons: [] };
}

module.exports = { scoreCounterparty };
