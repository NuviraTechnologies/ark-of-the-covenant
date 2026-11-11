# Ark of the Covenant — Submission Payload Draft (DO NOT SEND AS-IS)

Target: `POST https://nearhackathon.com/api/applications`

This is a draft for Richard's review. **Nothing is sent until Richard
confirms the exact payload on submission day.** `projectUrl` was
filled 2026-11-11 at clean-export time; `demoUrl` is still a
placeholder until Richard posts the demo, the email awaits his
confirmation, and `consent` stays un-set until that confirmation
(see the marker in the payload).

## Exact payload (JSON)

```json
{
  "projectName": "Ark of the Covenant",
  "leadName": "Richard Burgess",
  "email": "[RICHARD TO CONFIRM — likely r.vigslist@gmail.com]",
  "size": "1",
  "tracks": ["security", "agents"],
  "nearAddress": "calmdata2120.near",
  "projectUrl": "https://github.com/NuviraTechnologies/ark-of-the-covenant",
  "demoUrl": "[PLACEHOLDER — X demo post URL, filled after Richard posts]",
  "idea": "AI agents are getting wallets, and one poisoned instruction — hidden in a page or message the agent reads — can order it to send everything it holds to an attacker. Between the agent and the chain, nothing says no. Ark of the Covenant is a vault contract on NEAR that holds an agent's funds and sealed secrets. The agent never holds a master key: it gets a scoped function-call key (three methods, a small gas allowance), and every release is bound to one recipient, one amount, and one purpose, signed by a gate, and verified inside the contract before funds move. New counterparties pause for owner approval; blocklisted ones are refused by the contract itself; secrets are usable only as derived fingerprints, never exposed. Live on testnet now, with a local attack suite that stops drain, bypass, replay, and exfiltration attempts.",
  "consent": "REQUIRES-RE-CONFIRMATION — set to true ONLY at submission time, after Richard confirms this exact payload",
  "requestId": "2db23e02-b7fd-47b0-aaed-f4d960785201"
}
```

## Field notes

- `projectName`: "Ark of the Covenant" — the film's title throughout.
- `leadName`: "Richard Burgess" (entrant's legal name; he publishes as
  Richard Vigslist).
- `email`: **not filled in.** Richard confirms the address at submission
  (likely r.vigslist@gmail.com). Do not guess-fill and send.
- `size`: "1" — solo entry.
- `tracks`: `["security", "agents"]` — cross-entry decided YES by
  Richard's plan: the build is an agent vault; security is primary.
- `nearAddress`: `calmdata2120.near` — mainnet payout address, verified
  to exist (0 balance). Testnet accounts are never used here.
- `projectUrl`: **filled 2026-11-11** with the clean-export repo URL
  (https://github.com/NuviraTechnologies/ark-of-the-covenant — clean
  export built and gated per `film/clean-export-checklist.md`).
- `demoUrl`: filled after Richard posts the demo to X himself
  (text in `film/x-post-draft.md`, video attached).
- `idea`: 835 characters (contract band: 20 to 2000). Same honesty
  rails as the film: live testnet and the local attack suite are
  distinguished in the text; no mainnet, real-funds, or production-seal
  claims.
- `consent`: **REQUIRES-RE-CONFIRMATION.** The draft deliberately does
  not carry `true`. At submission time, Richard reviews this exact
  payload — every field, including the filled URLs and the confirmed
  email — and only then is `consent` set to `true` and the POST sent.
- `requestId`: `2db23e02-b7fd-47b0-aaed-f4d960785201` — generated once
  for this submission; it is not a secret. Reuse this exact value on
  any retry of the same submission so the API can deduplicate; do not
  generate a new one for a retry.

## Submission-day sequence

1. Publish the clean-export repo → fill `projectUrl`.
2. Richard posts the X demo (video + thread) → fill `demoUrl`.
3. Richard confirms the email and the full payload → set `consent` to
   `true`.
4. Send the POST once, with the recorded `requestId`. Record the API's
   response in the BUILD-LOG. On any retry, reuse the same `requestId`.
5. Deadline: Sat Nov 14, 2026, 6:59 PM ET.
