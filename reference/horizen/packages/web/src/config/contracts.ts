export const ANNOUNCER_ABI = [
  {
    type: "function",
    name: "announce",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Announcement",
    inputs: [
      { name: "schemeId", type: "uint256", indexed: true },
      { name: "stealthAddress", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "ephemeralPubKey", type: "bytes", indexed: false },
      { name: "metadata", type: "bytes", indexed: false },
    ],
  },
] as const;

export const REGISTRY_ABI = [
  {
    type: "function",
    name: "registerKeys",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthMetaAddress", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "stealthMetaAddressOf",
    inputs: [
      { name: "registrant", type: "address" },
      { name: "schemeId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "StealthMetaAddressSet",
    inputs: [
      { name: "registrant", type: "address", indexed: true },
      { name: "schemeId", type: "uint256", indexed: true },
      { name: "stealthMetaAddress", type: "bytes", indexed: false },
    ],
  },
] as const;

export const ANNOUNCER_ADDRESSES: Record<number, `0x${string}`> = {
  2651420: "0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3",
  31337: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

export const REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {
  2651420: "0x953E6cEdcdfAe321796e7637d33653F6Ce05c527",
  31337: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
};

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
  {
    type: "function",
    name: "sendERC20",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddress", type: "address" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "batchSendETH",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddresses", type: "address[]" },
      { name: "ephemeralPubKeys", type: "bytes[]" },
      { name: "metadatas", type: "bytes[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "batchSendERC20",
    inputs: [
      { name: "token", type: "address" },
      { name: "schemeId", type: "uint256" },
      { name: "stealthAddresses", type: "address[]" },
      { name: "ephemeralPubKeys", type: "bytes[]" },
      { name: "metadatas", type: "bytes[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

export const WRAITH_SENDER_ADDRESSES: Record<number, `0x${string}`> = {
  2651420: "0x226C5eb4e139D9fa01cc09eA318638b090b12095",
};

export const WRAITH_WITHDRAWER_ABI = [
  {
    type: "function",
    name: "withdrawETHDirect",
    inputs: [{ name: "destination", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawERC20Direct",
    inputs: [
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const WRAITH_WITHDRAWER_ADDRESSES: Record<number, `0x${string}`> = {
  2651420: "0x9F7f1C9d8B5a83245c6fC8415Ef744C458101711",
};

export const WRAITH_NAMES_ABI = [
  {
    type: "function",
    name: "register",
    inputs: [
      { name: "name", type: "string" },
      { name: "stealthMetaAddress", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "resolve",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nameOf",
    inputs: [{ name: "stealthMetaAddress", type: "bytes" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "NameRegistered",
    inputs: [
      { name: "nameHash", type: "bytes32", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "stealthMetaAddress", type: "bytes", indexed: false },
    ],
  },
] as const;

export const WRAITH_NAMES_ADDRESSES: Record<number, `0x${string}`> = {
  2651420: "0x3d46f709a99A3910f52bD292211Eb5D557F882D6",
};

// Block number at which contracts were deployed — scan logs from here, not from 0
export const DEPLOYMENT_BLOCKS: Record<number, bigint> = {
  2651420: 14202900n,
  31337: 0n,
};

// Block explorer base URLs for building tx/address links
export const EXPLORER_URLS: Record<number, string> = {
  2651420: "https://horizen-testnet.explorer.caldera.xyz",
  26514: "https://horizen.calderaexplorer.xyz",
};
