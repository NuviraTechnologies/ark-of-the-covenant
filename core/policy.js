'use strict';

// Policy evaluation (ARCHITECTURE.md sections 3.3 and 3.4).
//
// Two kinds of checks live here:
//   - Caps: plain arithmetic limits on a single payment and on the total
//     spent in a day. Amounts are yoctoNEAR decimal strings, so all math
//     uses BigInt.
//   - Purpose semantics: the gate service classifies the free-text purpose
//     into an allowed category and checks that the category is consistent
//     with what is known about the recipient.

/**
 * Check a payment amount against the per-transaction and daily caps.
 *
 * @param {{amountYocto: string, maxPerTxYocto: string,
 *          dailyCapYocto: string, dailySpentYocto: string}} input
 *   All amounts are decimal strings (yoctoNEAR).
 * @returns {{ok: boolean, reason: (string|null)}}
 */
function checkCaps({ amountYocto, maxPerTxYocto, dailyCapYocto, dailySpentYocto }) {
  const amount = BigInt(amountYocto);
  const maxPerTx = BigInt(maxPerTxYocto);
  const dailyCap = BigInt(dailyCapYocto);
  const dailySpent = BigInt(dailySpentYocto);

  if (amount > maxPerTx) {
    return { ok: false, reason: 'exceeds per-transaction cap' };
  }
  if (dailySpent + amount > dailyCap) {
    return { ok: false, reason: 'exceeds daily cap' };
  }
  return { ok: true, reason: null };
}

// Purpose classification keyword rules.
//
// Matching is a lowercased substring test: a rule matches when any of its
// keywords appears anywhere in the purpose text. Rules are evaluated in
// the order listed here, and the first match wins, so the order is part
// of the behaviour:
//
//   1. refund         - 'refund'
//      A refund is a distinct obligation (money going back), so it is
//      checked before any category the original charge might suggest.
//   2. payroll        - 'payroll', 'salary', 'wages'
//      Paying people is distinct from paying suppliers, and these terms
//      are unambiguous, so they win over generic commercial terms.
//   3. subscription   - 'subscription', 'renewal'
//      A recurring service payment. 'renewal' is specific to this
//      category, so "API subscription renewal" classifies as a
//      subscription rather than generic API usage.
//   4. api-usage      - 'usage credits', 'api'
//      Metered API use. Checked after subscription so a subscription
//      renewal for an API service is not misread as metered usage.
//   5. vendor-payment - 'invoice', 'vendor'
//      The generic commercial fallback: a supplier invoice or a payment
//      to a vendor that matched nothing more specific above.
//
// Text matching none of the lists classifies as null (not allowed).
const PURPOSE_RULES = [
  ['refund', ['refund']],
  ['payroll', ['payroll', 'salary', 'wages']],
  ['subscription', ['subscription', 'renewal']],
  ['api-usage', ['usage credits', 'api']],
  ['vendor-payment', ['invoice', 'vendor']],
];

/**
 * Classify a free-text purpose into an allowed category.
 *
 * @param {string} text the stated purpose of the payment.
 * @returns {('subscription'|'api-usage'|'payroll'|'vendor-payment'|'refund'|null)}
 */
function classifyPurpose(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const lowered = text.toLowerCase();
  for (const [category, keywords] of PURPOSE_RULES) {
    for (const keyword of keywords) {
      if (lowered.includes(keyword)) {
        return category;
      }
    }
  }
  return null;
}

/**
 * Check that a purpose category is consistent with the recipient's
 * counterparty record.
 *
 * Rules:
 *   - A blocklisted counterparty is never consistent.
 *   - 'payroll' and 'vendor-payment' require a prior relationship: paying
 *     wages or a supplier invoice to an account with zero prior
 *     interactions is refused.
 *   - Everything else is consistent.
 *
 * @param {{category: (string|null), counterparty: object}} input
 *   counterparty: {firstSeenBlock: number|null, interactions: number,
 *   isContract: boolean, codeChanged: boolean, blocklisted: boolean,
 *   evidence: string|null}
 * @returns {{ok: boolean, reason: (string|null)}}
 */
function checkPurposeConsistency({ category, counterparty }) {
  if (counterparty && counterparty.blocklisted) {
    const reason = counterparty.evidence
      ? `counterparty is blocklisted: ${counterparty.evidence}`
      : 'counterparty is blocklisted';
    return { ok: false, reason };
  }

  if (
    (category === 'payroll' || category === 'vendor-payment') &&
    counterparty &&
    counterparty.interactions === 0
  ) {
    return {
      ok: false,
      reason: `${category} to a counterparty with no prior interactions`,
    };
  }

  return { ok: true, reason: null };
}

module.exports = { checkCaps, classifyPurpose, checkPurposeConsistency };
