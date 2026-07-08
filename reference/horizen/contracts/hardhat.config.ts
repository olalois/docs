import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    horizenMainnet: {
      url: "https://horizen.calderachain.xyz/http",
      chainId: 26514,
      accounts: [PRIVATE_KEY],
    },
    horizenTestnet: {
      url: "https://horizen-testnet.rpc.caldera.xyz/http",
      chainId: 2651420,
      accounts: [PRIVATE_KEY],
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  etherscan: {
    apiKey: {
      horizenTestnet: "no-api-key-needed",
    },
    customChains: [
      {
        network: "horizenTestnet",
        chainId: 2651420,
        urls: {
          apiURL: "https://horizen-testnet.explorer.caldera.xyz/api",
          browserURL: "https://horizen-testnet.explorer.caldera.xyz",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./deploy",
  },
};

export default config;
