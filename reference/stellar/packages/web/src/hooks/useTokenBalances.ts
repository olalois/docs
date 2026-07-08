import { useEffect, useState } from "react";
import { useWallet } from "@/context/wallet";
import { useHorizonUrl } from "./useSoroban";
import { TOKENS } from "@/config/contracts";

export interface TokenBalance {
  symbol: string;
  balance: string;
  raw: bigint;
}

// Below this XLM amount (in stroops), consider it dust
export const DUST_THRESHOLD = 20_000_000n; // 2 XLM

export function useTokenBalances(stellarAddress: string | undefined) {
  const { network } = useWallet();
  const horizonUrl = useHorizonUrl();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!stellarAddress) return;

    const tokens = TOKENS[network] ?? [];
    let cancelled = false;

    async function fetchBalances() {
      setIsLoading(true);
      const results: TokenBalance[] = [];

      try {
        const res = await fetch(`${horizonUrl}/accounts/${stellarAddress}`);
        if (!res.ok) {
          // Account might not exist (not funded)
          if (!cancelled) {
            setBalances([]);
            setIsLoading(false);
          }
          return;
        }

        const account = await res.json();
        const accountBalances: Array<{
          asset_type: string;
          asset_code?: string;
          asset_issuer?: string;
          balance: string;
        }> = account.balances ?? [];

        // XLM balance
        const nativeBalance = accountBalances.find(
          (b) => b.asset_type === "native"
        );
        if (nativeBalance) {
          const xlmAmount = nativeBalance.balance;
          // Convert to stroops: split on decimal to avoid float precision issues
          const parts = xlmAmount.split(".");
          const whole = BigInt(parts[0] || "0") * 10_000_000n;
          const frac = parts[1] ? BigInt(parts[1].padEnd(7, "0").slice(0, 7)) : 0n;
          const stroops = whole + frac;
          if (stroops > 0n) {
            results.push({
              symbol: "XLM",
              balance: xlmAmount,
              raw: stroops,
            });
          }
        }

        // Token balances (trustlines)
        const tokenConfigs = tokens.filter((t) => t.address !== "native");
        for (const token of tokenConfigs) {
          // For Soroban-wrapped assets (SAC), check credit_alphanum balances
          const matchingBalance = accountBalances.find((b) => {
            if (b.asset_code === token.symbol) return true;
            return false;
          });

          if (matchingBalance) {
            const amount = matchingBalance.balance;
            const raw = BigInt(
              Math.round(parseFloat(amount) * 10 ** token.decimals)
            );
            if (raw > 0n) {
              results.push({
                symbol: token.symbol,
                balance: amount,
                raw,
              });
            }
          }
        }
      } catch {
        // Account may not exist or horizon may be unavailable
      }

      if (!cancelled) {
        setBalances(results);
        setIsLoading(false);
      }
    }

    fetchBalances();
    return () => {
      cancelled = true;
    };
  }, [stellarAddress, network, horizonUrl]);

  // Dust = has XLM but below threshold, and no other tokens.
  // Empty balances (unfunded accounts) are NOT dust — they show as "Empty".
  const hasTokens = balances.some((b) => b.symbol !== "XLM");
  const xlmBalance = balances.find((b) => b.symbol === "XLM");
  const isDust = !hasTokens && !!xlmBalance && xlmBalance.raw < DUST_THRESHOLD;

  return { balances, isLoading, isDust };
}
