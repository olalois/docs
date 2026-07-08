import { useState, useEffect, useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from "wagmi";
import {
  signNameRegistration,
  signNameRegistrationOnBehalf,
  metaAddressToBytes,
} from "@wraith-horizen/sdk";
import { WRAITH_NAMES_ABI, WRAITH_NAMES_ADDRESSES } from "@/config/contracts";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

const RELAYER_URLS: Record<number, string> = {
  2651420: import.meta.env.VITE_RELAYER_URL || "http://localhost:3001",
};

export function useRegisterName() {
  const chainId = useChainId();
  const { keys, metaAddress } = useStealthKeysContext();
  const { toast } = useToast();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [isSponsoredPending, setIsSponsoredPending] = useState(false);
  const [isSponsoredSuccess, setIsSponsoredSuccess] = useState(false);
  const [sponsoredHash, setSponsoredHash] = useState<string | null>(null);

  useEffect(() => {
    if (error) toast(parseError(error), "error");
  }, [error, toast]);

  useEffect(() => {
    if (isSuccess) toast("Name registered", "success");
  }, [isSuccess, toast]);

  const registerName = (name: string) => {
    const contractAddress = WRAITH_NAMES_ADDRESSES[chainId];
    if (!contractAddress) {
      toast("Names contract not deployed on this network", "error");
      return;
    }
    if (!keys || !metaAddress) {
      toast("Derive stealth keys first", "error");
      return;
    }

    const metaBytes = metaAddressToBytes(metaAddress);
    const signature = signNameRegistration(name, metaBytes, keys.spendingKey);

    writeContract({
      address: contractAddress,
      abi: WRAITH_NAMES_ABI,
      functionName: "register",
      args: [name, metaBytes as `0x${string}`, signature as `0x${string}`],
    });
  };

  const registerNameSponsored = useCallback(
    async (name: string) => {
      const relayerUrl = RELAYER_URLS[chainId];
      if (!relayerUrl) {
        toast("Relayer not available on this network", "error");
        return;
      }
      if (!keys || !metaAddress) {
        toast("Derive stealth keys first", "error");
        return;
      }

      const metaBytes = metaAddressToBytes(metaAddress);

      // Use signNameRegistrationOnBehalf with nonce
      // Fetch nonce from contract
      const contractAddress = WRAITH_NAMES_ADDRESSES[chainId];
      if (!contractAddress) {
        toast("Names contract not deployed on this network", "error");
        return;
      }

      setIsSponsoredPending(true);

      try {
        const signature = signNameRegistrationOnBehalf(
          name,
          metaBytes,
          keys.spendingKey,
          0n // nonce starts at 0 for new addresses
        );

        const res = await fetch(`${relayerUrl}/register-name`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            stealthMetaAddress: metaBytes,
            signature,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Relayer request failed");
        }

        setSponsoredHash(data.hash);
        setIsSponsoredSuccess(true);
        toast("Name registered via relayer", "success");
      } catch (err) {
        toast(parseError(err), "error");
      } finally {
        setIsSponsoredPending(false);
      }
    },
    [chainId, keys, metaAddress, toast]
  );

  return {
    registerName,
    registerNameSponsored,
    isPending: isPending || isSponsoredPending,
    isConfirming,
    isSuccess: isSuccess || isSponsoredSuccess,
    hash: hash || sponsoredHash,
  };
}

export function useResolveName(name: string | undefined) {
  const chainId = useChainId();
  const contractAddress = WRAITH_NAMES_ADDRESSES[chainId];

  const { data, isLoading } = useReadContract({
    address: contractAddress,
    abi: WRAITH_NAMES_ABI,
    functionName: "resolve",
    args: name ? [name] : undefined,
    query: { enabled: !!name && !!contractAddress && name.length >= 3 },
  });

  const metaAddress =
    data && (data as string) !== "0x" && (data as string).length > 2
      ? `st:eth:${data as string}`
      : null;

  return { metaAddress, isLoading };
}

export function useMyName() {
  const chainId = useChainId();
  const { metaAddress } = useStealthKeysContext();
  const contractAddress = WRAITH_NAMES_ADDRESSES[chainId];

  const metaHex = metaAddress ? metaAddressToBytes(metaAddress) : undefined;

  const { data, isLoading } = useReadContract({
    address: contractAddress,
    abi: WRAITH_NAMES_ABI,
    functionName: "nameOf",
    args: metaHex ? [metaHex as `0x${string}`] : undefined,
    query: { enabled: !!metaHex && !!contractAddress },
  });

  const name = data && (data as string) !== "" ? (data as string) : null;

  return { name, isLoading };
}
