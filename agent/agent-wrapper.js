'use strict';

// GuardedAgent: the agent-side wrapper. Flow per payment:
//   request_release (vault scores policy + counterparty)
//     -> block: stop, the attempt is already in the audit log
//     -> warn:  a human must approve before anything else happens
//     -> gate service re-checks purpose semantics and signs the decision
//     -> release (vault verifies the gate signature against the stored tuple)
//
// The wrapper is a convenience, not the enforcement point: a compromised
// agent that skips this wrapper and calls the vault directly still cannot
// release funds, because release() requires the gate signature.

const crypto = require('node:crypto');

class GuardedAgent {
  constructor({ agentClient, ownerClient, gate }) {
    if (!agentClient) throw new Error('GuardedAgent requires an agentClient');
    if (!ownerClient) throw new Error('GuardedAgent requires an ownerClient');
    if (!gate) throw new Error('GuardedAgent requires a gate');
    this.agentClient = agentClient;
    this.ownerClient = ownerClient;
    this.gate = gate;
  }

  async pay({ recipient, amountYocto, purpose, humanApprove }) {
    const nonce = crypto.randomUUID();
    const expiry = Math.floor(Date.now() / 1000) + 300;

    const counterparty = await this.agentClient.getCounterparty(recipient);
    const req = await this.agentClient.requestRelease({
      recipient,
      amountYocto,
      purpose,
      nonce,
      expiry,
    });

    if (req.status === 'block') {
      return { outcome: 'blocked', reason: req.reason, purposeHash: req.purposeHash };
    }

    if (req.status === 'warn') {
      const approved =
        typeof humanApprove === 'function'
          ? await humanApprove({ recipient, amountYocto, purpose, reason: req.reason })
          : false;
      if (!approved) {
        return { outcome: 'warn-declined', reason: req.reason, purposeHash: req.purposeHash };
      }
      await this.ownerClient.approveRelease(req.releaseId);
    }

    const gateDecision = this.gate.decide({
      recipient,
      amountYocto,
      purpose,
      nonce,
      expiry,
      counterparty,
    });
    if (gateDecision.decision === 'refuse') {
      return { outcome: 'gate-refused', reason: gateDecision.reason, purposeHash: req.purposeHash };
    }

    const rel = await this.agentClient.release({
      releaseId: req.releaseId,
      signature: gateDecision.signature,
    });
    return { outcome: 'released', release: rel, purposeHash: req.purposeHash };
  }

  async useSecret({ id, operation }) {
    return this.agentClient.useSecret({ id, operation });
  }
}

module.exports = { GuardedAgent };
