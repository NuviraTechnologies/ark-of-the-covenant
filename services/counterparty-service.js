'use strict';

// Local counterparty-check service (ARCHITECTURE.md section 4).
//
// In-memory store of counterparty records plus the scoring rules from
// core/counterparty.js. This is the component the gate service consults
// off-chain; the same signals are held on-chain by the vault contract.
//
// CLI:
//   node services/counterparty-service.js check <account>
// seeds a small demo dataset and prints the check result as JSON.

const { scoreCounterparty } = require('../core/counterparty');

function blankRecord() {
  return {
    firstSeenBlock: null,
    interactions: 0,
    isContract: false,
    codeChanged: false,
    blocklisted: false,
    evidence: null,
    codeHash: null,
  };
}

class CounterpartyService {
  constructor() {
    this.records = new Map();
  }

  /**
   * Record an observation of an account.
   *
   * The first report creates the record with firstSeenBlock set to
   * currentBlock and zero interactions. On a later report, if the stored
   * code hash differs from the reported one, the record is flagged
   * codeChanged; the latest code hash is stored either way.
   *
   * @param {string} account
   * @param {{isContract: boolean, codeHash: (string|null), currentBlock: number}} info
   * @returns {object} a copy of the stored record.
   */
  report(account, { isContract, codeHash, currentBlock } = {}) {
    let record = this.records.get(account);
    if (!record) {
      record = blankRecord();
      record.firstSeenBlock = currentBlock !== undefined ? currentBlock : null;
      record.isContract = Boolean(isContract);
      record.codeHash = codeHash !== undefined ? codeHash : null;
      this.records.set(account, record);
      return { ...record };
    }

    if (isContract !== undefined) {
      record.isContract = Boolean(isContract);
    }
    if (codeHash !== undefined) {
      if (record.codeHash !== codeHash) {
        record.codeChanged = true;
      }
      record.codeHash = codeHash;
    }
    return { ...record };
  }

  /**
   * Note that a completed interaction with this account happened.
   * Creates a record for a previously unknown account.
   *
   * @param {string} account
   * @returns {object} a copy of the stored record.
   */
  noteInteraction(account) {
    let record = this.records.get(account);
    if (!record) {
      record = blankRecord();
      this.records.set(account, record);
    }
    record.interactions += 1;
    return { ...record };
  }

  /**
   * Add an account to the shared blocklist, with evidence.
   *
   * @param {string} account
   * @param {string} evidence why the account was blocked.
   * @returns {object} a copy of the stored record.
   */
  block(account, evidence) {
    let record = this.records.get(account);
    if (!record) {
      record = blankRecord();
      this.records.set(account, record);
    }
    record.blocklisted = true;
    record.evidence = evidence !== undefined ? evidence : null;
    return { ...record };
  }

  /**
   * Remove an account from the shared blocklist.
   *
   * @param {string} account
   * @returns {object|null} a copy of the stored record, or null if unknown.
   */
  unblock(account) {
    const record = this.records.get(account);
    if (!record) {
      return null;
    }
    record.blocklisted = false;
    record.evidence = null;
    return { ...record };
  }

  /**
   * Return a copy of the stored record, or the brand-new record shape
   * for an unknown account.
   *
   * @param {string} account
   * @returns {object}
   */
  getRecord(account) {
    const record = this.records.get(account);
    if (!record) {
      return blankRecord();
    }
    return { ...record };
  }

  /**
   * Score an account for a proposed payment. An unknown account is
   * scored as brand-new: never seen, zero interactions.
   *
   * @param {string} account
   * @param {object} [opts] see scoreCounterparty in core/counterparty.js.
   * @returns {{status: ('allow'|'warn'|'block'), reasons: string[]}}
   */
  check(account, opts = {}) {
    return scoreCounterparty(this.getRecord(account), opts);
  }
}

module.exports = CounterpartyService;
module.exports.CounterpartyService = CounterpartyService;

// --- CLI -----------------------------------------------------------------

const DEMO_CURRENT_BLOCK = 1000;
const DEMO_AMOUNT_YOCTO = '1000000000000000000000000'; // 1 NEAR, below the warn threshold

function seedDemoService() {
  const service = new CounterpartyService();

  // vendor.testnet: old record, 12 interactions.
  service.report('vendor.testnet', {
    isContract: false,
    codeHash: 'vendor-code-v1',
    currentBlock: DEMO_CURRENT_BLOCK - 1000,
  });
  for (let i = 0; i < 12; i += 1) {
    service.noteInteraction('vendor.testnet');
  }

  // attacker.testnet: blocklisted, with evidence.
  service.report('attacker.testnet', {
    isContract: false,
    codeHash: null,
    currentBlock: DEMO_CURRENT_BLOCK - 500,
  });
  service.block('attacker.testnet', 'reported drain attempt, 2026-11-10');

  // newbie.testnet: first seen 5 blocks ago, 0 interactions.
  service.report('newbie.testnet', {
    isContract: false,
    codeHash: null,
    currentBlock: DEMO_CURRENT_BLOCK - 5,
  });

  return service;
}

function main(argv) {
  const [command, account] = argv;
  if (command !== 'check' || !account) {
    process.stderr.write('usage: node services/counterparty-service.js check <account>\n');
    process.exitCode = 1;
    return;
  }
  const service = seedDemoService();
  const result = service.check(account, {
    amountYocto: DEMO_AMOUNT_YOCTO,
    currentBlock: DEMO_CURRENT_BLOCK,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2));
}
