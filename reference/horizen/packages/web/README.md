# Wraith Web App

The frontend for [Wraith](https://github.com/truthixify/wraith) — stealth addresses for Horizen.

Built with Vite, React, TailwindCSS, wagmi, and RainbowKit.

## Setup

From the monorepo root:

```bash
pnpm install
```

## Development

```bash
cd packages/web
pnpm dev
```

Opens at `http://localhost:5173`.

## Build

```bash
pnpm build
```

Output goes to `dist/`. The build script automatically builds the SDK first.

## Environment variables

Create a `.env` file in `packages/web/`:

```
VITE_WC_PROJECT_ID=your_walletconnect_project_id
```

Get a WalletConnect project ID at [cloud.reown.com](https://cloud.reown.com).

## Pages

- **Setup** — Connect wallet, sign to derive stealth keys, register meta-address on-chain
- **Send** — Send ETH/ZEN/USDC to a stealth meta-address or wallet address. Single and batch modes. Atomic transfer + announcement via the WraithSender contract
- **Receive** — Scan for incoming stealth transfers via Goldsky subgraph. One-click withdrawal, batch withdrawal, token detection across ETH and ERC-20s
- **About** — How stealth addresses work, links to ERC specs

## Tech

- **Vite + React** — client-side SPA, no SSR
- **wagmi + RainbowKit** — wallet connection (MetaMask, Coinbase, WalletConnect, any EIP-1193)
- **@wraith-horizen/sdk** — stealth address cryptography (workspace dependency)
- **Goldsky subgraph** — indexed announcement scanning via GraphQL
- **TailwindCSS** — design system based on the Sovereign Vault spec (Space Grotesk + Inter, monochromatic palette, 0px radii)

## Deployment

Deployed on Vercel. Push to `main` triggers a build.

Vercel settings:
- Root directory: `packages/web`
- Build command: `pnpm run build`
- Output directory: `dist`
- Framework: Vite
