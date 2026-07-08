import { useEffect, useState } from "react";
import { usePublicClient, useChainId } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { TOKEN_LIST } from "@/hooks/useSendStealth";

export interface TokenBalance {
  symbol: string;
  balance: string;
  raw: bigint;
}

// Below this ETH amount, consider it dust (gas leftovers)
export const DUST_THRESHOLD = 10_000_000_000_000n; // 0.00001 ETH

export function useTokenBalances(address: `0x${string}` | undefined) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address || !publicClient) return;

    const tokens = TOKEN_LIST[chainId] ?? [];
    let cancelled = false;

    async function fetch() {
      setIsLoading(true);
      const results: TokenBalance[] = [];

      // Native balance
      try {
        const ethBal = await publicClient!.getBalance({ address: address! });
        if (ethBal > 0n) {
          results.push({ symbol: "ETH", balance: formatUnits(ethBal, 18), raw: ethBal });
        }
      } catch {}

      // ERC-20 balances
      const erc20Tokens = tokens.filter((t) => t.address !== "native");
      for (const token of erc20Tokens) {
        try {
          const bal = await publicClient!.readContract({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address!],
          });
          if (bal > 0n) {
            results.push({
              symbol: token.symbol,
              balance: formatUnits(bal, token.decimals),
              raw: bal,
            });
          }
        } catch {}
      }

      if (!cancelled) {
        setBalances(results);
        setIsLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, [address, chainId, publicClient]);

  // Dust = only has ETH below threshold and no ERC-20s
  const hasTokens = balances.some((b) => b.symbol !== "ETH");
  const ethBalance = balances.find((b) => b.symbol === "ETH");
  const isDust = !hasTokens && (!ethBalance || ethBalance.raw < DUST_THRESHOLD);

  return { balances, isLoading, isDust };
}
