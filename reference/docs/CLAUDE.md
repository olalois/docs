# Wraith Protocol — Multi-Repo Implementation

Wraith is a multichain stealth address platform. The codebase is split across 4 repos under the `wraith-protocol` GitHub organization. Each repo has its own CLAUDE.md with specific instructions.

## Repos

| Repo | Purpose | npm Package |
|---|---|---|
| `wraith-protocol/sdk` | SDK — crypto primitives + agent client | `@wraith-protocol/sdk` |
| `wraith-protocol/spectre` | TEE server — managed agent infrastructure | Internal (not published) |
| `wraith-protocol/contracts` | Smart contracts — EVM (Solidity) + Stellar (Soroban) | Not published |
| `wraith-protocol/docs` | Documentation site | N/A |

## Implementation Order

### Phase 1: SDK (`wraith-protocol/sdk`)
Build first. Everything else depends on it.
1. EVM chain crypto (secp256k1)
2. Stellar chain crypto (ed25519)
3. Agent client (Wraith, WraithAgent, Chain enum)

### Phase 2: Contracts (`wraith-protocol/contracts`)
Can start once SDK crypto is done (for test verification).
1. EVM contracts (Solidity + Hardhat)
2. Stellar contracts (Soroban/Rust)

### Phase 3: Spectre (`wraith-protocol/spectre`)
Depends on SDK being published/linked.
1. NestJS server foundation
2. Chain connectors (EVM + Stellar)
3. Agent service + AI tools
4. Supporting features
5. Docker + deployment

### Phase 4: Docs (`wraith-protocol/docs`)
Can happen in parallel with anything.

## Per-Repo CLAUDE.md Files

Copy the appropriate CLAUDE.md into each repo root. The files are below.

---

## Reference Material

Each repo that needs reference code should have a `reference/` folder:

- **sdk** → copy `reference/horizen/packages/sdk/` and `reference/stellar/packages/sdk/`
- **spectre** → copy `reference/horizen/packages/tee/` and `reference/stellar/packages/tee/`
- **contracts** → copy `reference/horizen/contracts/` and `reference/stellar/contracts/`

Also copy `docs/implementation/` into each repo's `reference/docs/` so the agent has the full spec.
