import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { http } from "wagmi";

export const horizenTestnet = defineChain({
  id: 2651420,
  name: "Horizen Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://horizen-testnet.rpc.caldera.xyz/http"] },
  },
  blockExplorers: {
    default: {
      name: "Horizen Testnet Explorer",
      url: "https://horizen-testnet.explorer.caldera.xyz",
    },
  },
  testnet: true,
});

export const horizenMainnet = defineChain({
  id: 26514,
  name: "Horizen",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://horizen.calderachain.xyz/http"] },
  },
  blockExplorers: {
    default: {
      name: "Horizen Explorer",
      url: "https://horizen.calderaexplorer.xyz",
    },
  },
});

export const wagmiConfig = getDefaultConfig({
  appName: "Wraith Agent",
  projectId: import.meta.env.VITE_WC_PROJECT_ID || "YOUR_PROJECT_ID",
  chains: [horizenTestnet, horizenMainnet],
  transports: {
    [horizenTestnet.id]: http(),
    [horizenMainnet.id]: http(),
  },
});

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3002";
export const EXPLORER_URL = "https://horizen-testnet.explorer.caldera.xyz";

export const WRAITH_SENDER_ADDRESS = "0x226C5eb4e139D9fa01cc09eA318638b090b12095";

export const WRAITH_SENDER_ABI = [
  {
    type: "function",
    name: "sendETH",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;
