import { useEffect, useState, useCallback, useRef } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { REGISTRY_ABI, REGISTRY_ADDRESSES } from "@/config/contracts";
import { SUBGRAPH_URLS } from "@/config/subgraph";
import { SCHEME_ID } from "@wraith-horizen/sdk";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";
import type { HexString } from "@wraith-horizen/sdk";

export function useRegisterKeys(chainId: number) {
  const address = REGISTRY_ADDRESSES[chainId];
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { toast } = useToast();
  const toastedError = useRef<string | null>(null);
  const toastedSuccess = useRef<string | null>(null);

  useEffect(() => {
    if (error) {
      const msg = parseError(error);
      if (toastedError.current !== msg) {
        toastedError.current = msg;
        toast(msg, "error");
      }
    }
  }, [error, toast]);

  useEffect(() => {
    if (isSuccess && hash && toastedSuccess.current !== hash) {
      toastedSuccess.current = hash;
      toast("Meta-address registered on-chain", "success");
    }
  }, [isSuccess, hash, toast]);

  const registerKeys = (stealthMetaAddress: HexString) => {
    if (!address) {
      toast("Registry contract not deployed on this network", "error");
      return;
    }
    writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "registerKeys",
      args: [SCHEME_ID, stealthMetaAddress],
    });
  };

  return { registerKeys, isPending, isConfirming, isSuccess, hash };
}

export function useIsRegistered(chainId: number) {
  const { address: userAddress } = useAccount();
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const check = useCallback(async () => {
    if (!userAddress) {
      setIsRegistered(false);
      setIsLoading(false);
      return;
    }

    const subgraphUrl = SUBGRAPH_URLS[chainId];
    if (subgraphUrl) {
      try {
        const res = await fetch(subgraphUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `{ stealthMetaAddressSets(where: { registrant: "${userAddress.toLowerCase()}", schemeId: "1" }, first: 1) { id } }`,
          }),
        });
        const json = await res.json();
        const items = json.data?.stealthMetaAddressSets ?? [];
        setIsRegistered(items.length > 0);
      } catch {
        setIsRegistered(false);
      }
    }

    setIsLoading(false);
  }, [userAddress, chainId]);

  useEffect(() => {
    check();
  }, [check]);

  return { isRegistered, isLoading };
}

export function useLookupMetaAddress(
  registrant: `0x${string}` | undefined,
  chainId: number
) {
  const address = REGISTRY_ADDRESSES[chainId];

  return useReadContract({
    address,
    abi: REGISTRY_ABI,
    functionName: "stealthMetaAddressOf",
    args: registrant ? [registrant, SCHEME_ID] : undefined,
    query: { enabled: !!registrant && !!address },
  });
}
