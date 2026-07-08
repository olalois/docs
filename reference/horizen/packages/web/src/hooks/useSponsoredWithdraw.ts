import { useState, useCallback } from "react";
import { useChainId } from "wagmi";
import {
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { horizenTestnet, horizenMainnet } from "@/config/chains";
import { WRAITH_WITHDRAWER_ADDRESSES } from "@/config/contracts";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

const RELAYER_URLS: Record<number, string> = {
  2651420: import.meta.env.VITE_RELAYER_URL || "http://localhost:3001",
};

function getChain(chainId: number) {
  if (chainId === 2651420) return horizenTestnet;
  if (chainId === 26514) return horizenMainnet;
  return undefined;
}

export function useSponsoredWithdraw() {
  const chainId = useChainId();
  const { toast } = useToast();
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const sponsoredWithdraw = useCallback(
    async (
      stealthPrivateKey: Hex,
      stealthAddress: Hex,
      token: Hex,
      destination: Hex
    ) => {
      const relayerUrl = RELAYER_URLS[chainId];
      if (!relayerUrl) {
        toast("Sponsored withdrawals not available on this network", "error");
        return null;
      }

      const withdrawerAddress = WRAITH_WITHDRAWER_ADDRESSES[chainId];
      if (!withdrawerAddress) {
        toast("Withdrawer contract not deployed on this network", "error");
        return null;
      }

      const chain = getChain(chainId);
      if (!chain) {
        toast("Unsupported chain", "error");
        return null;
      }

      setIsWithdrawing(true);

      try {
        const account = privateKeyToAccount(stealthPrivateKey);
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(),
        });

        // Sign EIP-7702 authorization delegating to WraithWithdrawer
        const authorization = await walletClient.signAuthorization({
          contractAddress: withdrawerAddress,
        });

        // Send to relayer
        const res = await fetch(`${relayerUrl}/sponsor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stealthAddress,
            token,
            destination,
            authorization: {
              address: authorization.address,
              chainId: authorization.chainId,
              nonce: authorization.nonce,
              r: authorization.r,
              s: authorization.s,
              yParity: authorization.yParity,
            },
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Relayer request failed");
        }

        toast("Sponsored withdrawal complete", "success");
        return data.hash as string;
      } catch (err) {
        toast(parseError(err), "error");
        return null;
      } finally {
        setIsWithdrawing(false);
      }
    },
    [chainId, toast]
  );

  return { sponsoredWithdraw, isWithdrawing };
}
