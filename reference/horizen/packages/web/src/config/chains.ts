import { defineChain } from "viem";

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
