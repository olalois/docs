# Implementation Guide

This folder contains detailed implementation guides for building the Wraith multichain stealth address platform. These documents are written to be machine-readable — an LLM or developer can follow them step-by-step to implement the entire system from scratch.

## Documents

| File | Purpose |
|---|---|
| [01-sdk-structure.md](./01-sdk-structure.md) | Package structure, build system, exports, and how to organize the `@wraith-protocol/sdk` monorepo |
| [02-evm-chain-crypto.md](./02-evm-chain-crypto.md) | EVM stealth crypto implementation (secp256k1): key derivation, stealth addresses, scanning, spending, names |
| [03-stellar-chain-crypto.md](./03-stellar-chain-crypto.md) | Stellar stealth crypto implementation (ed25519): key derivation, X25519 ECDH, scalar math, spending |
| [04-chain-connector-interface.md](./04-chain-connector-interface.md) | The ChainConnector interface, EVM connector, Stellar connector, and how to add new chains |
| [05-tee-server.md](./05-tee-server.md) | TEE server architecture: NestJS modules, agent service, tool orchestration, AI integration, database schema |
| [06-agent-client-sdk.md](./06-agent-client-sdk.md) | The `@wraith-protocol/sdk` root export — the managed platform client that talks to hosted TEEs |
| [07-smart-contracts.md](./07-smart-contracts.md) | Smart contract specs for EVM (Solidity) and Stellar (Soroban/Rust) |
| [08-testing.md](./08-testing.md) | Test strategy, test cases, expected results, and verification procedures |
| [09-ai-agent-behavior.md](./09-ai-agent-behavior.md) | System prompt, tool orchestration loop, privacy check algorithm, agent personality |

## Reading Order

For implementing from scratch:
1. Start with `01-sdk-structure.md` to set up the monorepo
2. Implement `02-evm-chain-crypto.md` (or `03-stellar-chain-crypto.md` for Stellar)
3. Define the `04-chain-connector-interface.md`
4. Build the `05-tee-server.md`
5. Build the `06-agent-client-sdk.md`
6. Deploy contracts per `07-smart-contracts.md`
7. Verify everything with `08-testing.md`

## Key Principles

- The SDK package name is `@wraith-protocol/sdk`
- EVM crypto lives at `@wraith-protocol/sdk/chains/evm`
- Stellar crypto lives at `@wraith-protocol/sdk/chains/stellar`
- Agent client lives at `@wraith-protocol/sdk` (root)
- The TEE server is internal infrastructure, not published
- Chain connectors implement a standard interface — adding EVM chains is config, adding chain families is one file
- All keys are derived inside TEE hardware and never stored
