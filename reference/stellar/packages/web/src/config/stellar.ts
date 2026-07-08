export const NETWORKS = {
  testnet: {
    name: "Stellar Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
  },
  pubnet: {
    name: "Stellar Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://soroban.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/public",
  },
};

export type NetworkId = keyof typeof NETWORKS;

export const DEFAULT_NETWORK: NetworkId = "testnet";
