import { useState, useCallback, useEffect, useRef } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";
import { parseEther, parseUnits, erc20Abi } from "viem";
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
} from "@wraith-horizen/sdk";
import type { HexString } from "@wraith-horizen/sdk";
import {
  WRAITH_SENDER_ABI,
  WRAITH_SENDER_ADDRESSES,
} from "@/config/contracts";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

export interface TokenOption {
  symbol: string;
  address: `0x${string}` | "native";
  decimals: number;
}

export const TOKEN_LIST: Record<number, TokenOption[]> = {
  2651420: [
    { symbol: "ETH", address: "native", decimals: 18 },
    { symbol: "ZEN", address: "0x4b36cb6E7c257E9aA246122a997be0F7Dc1eFCd1", decimals: 18 },
    { symbol: "USDC", address: "0x01c7AEb2A0428b4159c0E333712f40e127aF639E", decimals: 6 },
  ],
  26514: [
    { symbol: "ETH", address: "native", decimals: 18 },
    { symbol: "ZEN", address: "0x57da2D504bf8b83Ef304759d9f2648522D7a9280", decimals: 18 },
    { symbol: "USDC", address: "0x52F77B624a9f20d41a60eF550e5792a00747262c", decimals: 6 },
  ],
  31337: [
    { symbol: "ETH", address: "native", decimals: 18 },
  ],
};

export function useSendStealth(chainId: number) {
  const { toast } = useToast();

  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: HexString;
    ephemeralPubKey: HexString;
    viewTag: number;
  } | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [pendingToken, setPendingToken] = useState<TokenOption | null>(null);
  const [pendingAmount, setPendingAmount] = useState<bigint>(0n);
  const [pendingGasTip, setPendingGasTip] = useState<bigint>(0n);

  const toastedApprovalError = useRef<string | null>(null);
  const toastedSendError = useRef<string | null>(null);
  const toastedSuccess = useRef<string | null>(null);

  const {
    writeContract: writeApproval,
    data: approvalHash,
    isPending: isApprovalPending,
    error: approvalError,
    reset: resetApproval,
  } = useWriteContract();
  const { isSuccess: isApprovalSuccess } =
    useWaitForTransactionReceipt({ hash: approvalHash });

  const {
    writeContract,
    data: sendHash,
    isPending: isSendPending,
    error: sendError,
    reset: resetSend,
  } = useWriteContract();
  const { isLoading: isSendConfirming, isSuccess: isSendSuccess } =
    useWaitForTransactionReceipt({ hash: sendHash });

  // Toast errors and success exactly once per unique occurrence
  useEffect(() => {
    if (approvalError) {
      const msg = parseError(approvalError);
      if (toastedApprovalError.current !== msg) {
        toastedApprovalError.current = msg;
        toast(msg, "error");
      }
    }
  }, [approvalError, toast]);

  useEffect(() => {
    if (sendError) {
      const msg = parseError(sendError);
      if (toastedSendError.current !== msg) {
        toastedSendError.current = msg;
        toast(msg, "error");
      }
    }
  }, [sendError, toast]);

  useEffect(() => {
    if (isSendSuccess && sendHash && toastedSuccess.current !== sendHash) {
      toastedSuccess.current = sendHash;
      toast("Transfer and announcement confirmed", "success");
    }
  }, [isSendSuccess, sendHash, toast]);

  // After approval succeeds, fire the actual send
  useEffect(() => {
    if (!isApprovalSuccess || !needsApproval || !stealthResult || !pendingToken) return;
    setNeedsApproval(false);

    const senderAddress = WRAITH_SENDER_ADDRESSES[chainId];
    if (!senderAddress) return;

    const viewTagHex = stealthResult.viewTag.toString(16).padStart(2, "0");
    const metadata = `0x${viewTagHex}` as HexString;

    writeContract({
      address: senderAddress,
      abi: WRAITH_SENDER_ABI,
      functionName: "sendERC20",
      args: [
        pendingToken.address as `0x${string}`,
        pendingAmount,
        SCHEME_ID,
        stealthResult.stealthAddress as `0x${string}`,
        stealthResult.ephemeralPubKey as `0x${string}`,
        metadata as `0x${string}`,
      ],
      value: pendingGasTip,
    });
  }, [isApprovalSuccess, needsApproval, stealthResult, pendingToken, pendingAmount, pendingGasTip, chainId, writeContract]);

  const generateAndSend = useCallback(
    (metaAddress: string, amount: string, token: TokenOption, gasTipEth?: string) => {
      const senderAddress = WRAITH_SENDER_ADDRESSES[chainId];
      if (!senderAddress) {
        toast("Sender contract not deployed on this network", "error");
        return;
      }

      try {
        const decoded = decodeStealthMetaAddress(metaAddress);
        const result = generateStealthAddress(
          decoded.spendingPubKey,
          decoded.viewingPubKey
        );
        setStealthResult(result);

        const viewTagHex = result.viewTag.toString(16).padStart(2, "0");
        const metadata = `0x${viewTagHex}` as HexString;

        if (token.address === "native") {
          writeContract({
            address: senderAddress,
            abi: WRAITH_SENDER_ABI,
            functionName: "sendETH",
            args: [
              SCHEME_ID,
              result.stealthAddress as `0x${string}`,
              result.ephemeralPubKey as `0x${string}`,
              metadata as `0x${string}`,
            ],
            value: parseEther(amount),
          });
        } else {
          const parsedAmount = parseUnits(amount, token.decimals);
          const tip = gasTipEth ? parseEther(gasTipEth) : 0n;
          setPendingToken(token);
          setPendingAmount(parsedAmount);
          setPendingGasTip(tip);
          setNeedsApproval(true);

          writeApproval({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [senderAddress, parsedAmount],
          });
        }

        return result;
      } catch (err) {
        toast(parseError(err), "error");
      }
    },
    [chainId, writeContract, writeApproval, toast]
  );

  const reset = useCallback(() => {
    setStealthResult(null);
    setNeedsApproval(false);
    setPendingToken(null);
    setPendingAmount(0n);
    setPendingGasTip(0n);
    toastedApprovalError.current = null;
    toastedSendError.current = null;
    toastedSuccess.current = null;
    resetApproval();
    resetSend();
  }, [resetApproval, resetSend]);

  const isPending = isSendPending || isApprovalPending;

  return {
    generateAndSend,
    reset,
    stealthResult,
    isPending,
    isSendConfirming,
    isSendSuccess,
    sendHash,
  };
}
