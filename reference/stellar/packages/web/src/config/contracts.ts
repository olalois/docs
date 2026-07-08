import type { NetworkId } from "./stellar";

export const CONTRACT_ADDRESSES: Record<
  string,
  { announcer: string; registry: string; sender: string; names: string }
> = {
  testnet: {
    announcer: "CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL",
    registry: "CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5",
    sender: "CCLV7RBAASFWGAOIZ5R7MV3SYS5HLVCKPJRRECQYENZNLXNU3Y4ILT2G",
    names: "CDEMB3MAE62ZOCCKZPTYSXR5CS5WVENPOU5MDVK4PNKTZXFVDC74AFBV",
  },
};

export function getContracts(network: NetworkId) {
  return CONTRACT_ADDRESSES[network] ?? null;
}

export const TOKENS: Record<NetworkId, { symbol: string; address: string; decimals: number }[]> = {
  testnet: [
    { symbol: "XLM", address: "native", decimals: 7 },
    {
      symbol: "USDC",
      address: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      decimals: 7,
    },
  ],
  pubnet: [
    { symbol: "XLM", address: "native", decimals: 7 },
    {
      symbol: "USDC",
      address: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI",
      decimals: 7,
    },
  ],
};
