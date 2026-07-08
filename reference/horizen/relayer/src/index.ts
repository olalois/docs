import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const NAMES_ABI = [
  {
    type: "function",
    name: "registerOnBehalf",
    inputs: [
      { name: "name", type: "string" },
      { name: "stealthMetaAddress", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const WITHDRAWER_ABI = [
  {
    type: "function",
    name: "withdrawERC20",
    inputs: [
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "sponsorFee", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const {
  RELAYER_PRIVATE_KEY,
  RPC_URL,
  WITHDRAWER_ADDRESS,
  NAMES_ADDRESS,
  CHAIN_ID,
  MAX_GAS_COST_ETH = "0.005",
  ALLOWED_ORIGINS = "http://localhost:5173",
  PORT = "3001",
} = process.env;

if (!RELAYER_PRIVATE_KEY || !RPC_URL || !WITHDRAWER_ADDRESS || !NAMES_ADDRESS || !CHAIN_ID) {
  console.error("Missing required env vars: RELAYER_PRIVATE_KEY, RPC_URL, WITHDRAWER_ADDRESS, NAMES_ADDRESS, CHAIN_ID");
  process.exit(1);
}

const chain = defineChain({
  id: Number(CHAIN_ID),
  name: "Horizen",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as Hex);

const walletClient = createWalletClient({
  account: relayerAccount,
  chain,
  transport: http(RPC_URL),
});

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

const maxGasCost = parseEther(MAX_GAS_COST_ETH);

const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGINS.split(",") }));

// Health check
app.get("/health", async (_req, res) => {
  const balance = await publicClient.getBalance({ address: relayerAccount.address });
  res.json({
    status: "ok",
    relayer: relayerAccount.address,
    balance: balance.toString(),
    chain: Number(CHAIN_ID),
  });
});

// Sponsored ERC-20 withdrawal via EIP-7702
app.post("/sponsor", async (req, res) => {
  try {
    const {
      stealthAddress,
      token,
      destination,
      authorization,
    } = req.body as {
      stealthAddress: Hex;
      token: Hex;
      destination: Hex;
      authorization: {
        address: Hex;
        chainId: number;
        nonce: number;
        r: Hex;
        s: Hex;
        yParity: number;
      };
    };

    if (!stealthAddress || !token || !destination || !authorization) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // Validate the authorization targets our WraithWithdrawer
    if (authorization.address.toLowerCase() !== WITHDRAWER_ADDRESS.toLowerCase()) {
      res.status(400).json({ error: "Authorization targets wrong contract" });
      return;
    }

    if (authorization.chainId !== Number(CHAIN_ID)) {
      res.status(400).json({ error: "Authorization chain ID mismatch" });
      return;
    }

    // Estimate gas cost to determine sponsor fee
    const gasPrice = await publicClient.getGasPrice();
    const estimatedGas = 150_000n; // conservative estimate for ERC-20 transfer + delegation
    const gasCost = gasPrice * estimatedGas * 150n / 100n; // 50% buffer

    if (gasCost > maxGasCost) {
      res.status(400).json({ error: "Gas cost exceeds maximum allowed" });
      return;
    }

    // Encode the call to withdrawERC20 on the delegated stealth address
    const callData = encodeFunctionData({
      abi: WITHDRAWER_ABI,
      functionName: "withdrawERC20",
      args: [token, destination, gasCost],
    });

    // Submit EIP-7702 transaction
    const hash = await walletClient.sendTransaction({
      to: stealthAddress,
      data: callData,
      authorizationList: [authorization],
      gas: estimatedGas,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    res.json({
      hash,
      status: receipt.status,
      sponsorFee: gasCost.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Sponsor error:", message);
    res.status(500).json({ error: message });
  }
});

// Sponsored name registration
app.post("/register-name", async (req, res) => {
  try {
    const { name, stealthMetaAddress, signature } = req.body as {
      name: string;
      stealthMetaAddress: Hex;
      signature: Hex;
    };

    if (!name || !stealthMetaAddress || !signature) {
      res.status(400).json({ error: "Missing required fields: name, stealthMetaAddress, signature" });
      return;
    }

    if (name.length < 3 || name.length > 32 || !/^[a-z0-9]+$/.test(name)) {
      res.status(400).json({ error: "Invalid name: must be 3-32 lowercase alphanumeric characters" });
      return;
    }

    if (stealthMetaAddress.length !== 134) { // 0x + 132 hex chars = 66 bytes
      res.status(400).json({ error: "Invalid meta-address length" });
      return;
    }

    const hash = await walletClient.writeContract({
      address: NAMES_ADDRESS as Hex,
      abi: NAMES_ABI,
      functionName: "registerOnBehalf",
      args: [name, stealthMetaAddress, signature],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    res.json({
      hash,
      status: receipt.status,
      name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Register name error:", message);
    res.status(500).json({ error: message });
  }
});

app.listen(Number(PORT), () => {
  console.log(`Wraith relayer running on port ${PORT}`);
  console.log(`Relayer address: ${relayerAccount.address}`);
  console.log(`Chain: ${CHAIN_ID}`);
  console.log(`Withdrawer: ${WITHDRAWER_ADDRESS}`);
});
