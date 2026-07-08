import { useState, useCallback, useEffect } from "react";
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import { useWallet } from "@/context/wallet";
import { useToast } from "@/context/toast";
import { useSorobanClient, useNetworkPassphrase } from "./useSoroban";
import { getContracts } from "@/config/contracts";
import { SCHEME_ID } from "@wraith/sdk";
import { parseError } from "@/lib/errors";

export function useRegisterKeys() {
  const { address, network, signTransaction } = useWallet();
  const soroban = useSorobanClient();
  const networkPassphrase = useNetworkPassphrase();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  const registerKeys = useCallback(
    async (spendingPubKey: Uint8Array, viewingPubKey: Uint8Array) => {
      const contracts = getContracts(network);
      if (!contracts || contracts.registry === "PLACEHOLDER_REGISTRY_ADDRESS") {
        toast("Registry contract not deployed on this network", "error");
        return;
      }
      if (!address) {
        toast("Wallet not connected", "error");
        return;
      }

      setIsPending(true);
      try {
        // Fetch source account
        const accountResponse = await soroban.getAccount(address);
        const sourceAccount = new Account(
          accountResponse.accountId(),
          accountResponse.sequenceNumber()
        );

        // Build Soroban contract call
        const contract = new Contract(contracts.registry);

        // Concatenate spending + viewing pubkeys into a single 64-byte meta-address
        const metaAddressBytes = new Uint8Array(64);
        metaAddressBytes.set(spendingPubKey, 0);
        metaAddressBytes.set(viewingPubKey, 32);

        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase,
        })
          .addOperation(
            contract.call(
              "register_keys",
              new Address(address).toScVal(),
              nativeToScVal(SCHEME_ID, { type: "u32" }),
              xdr.ScVal.scvBytes(Buffer.from(metaAddressBytes))
            )
          )
          .setTimeout(30)
          .build();

        // Simulate to get proper footprint and assemble
        const simulated = await soroban.simulateTransaction(tx);
        if ("error" in simulated) {
          throw new Error(
            (simulated as { error: string }).error || "Simulation failed"
          );
        }

        // Assemble the transaction with simulation results (adds auth, footprint, fees)
        const { rpc: rpcMod } = await import("@stellar/stellar-sdk");
        const assembled = rpcMod.assembleTransaction(tx, simulated as any).build();

        // Sign with Freighter
        setIsConfirming(true);
        const signedXdr = await signTransaction(assembled.toXDR());

        // Submit
        const response = await soroban.sendTransaction(
          TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
        );

        if (response.status === "ERROR") {
          throw new Error("Transaction submission failed");
        }

        // Poll for result
        setHash(response.hash);
        let attempts = 0;
        while (attempts < 30) {
          try {
            const result = await soroban.getTransaction(response.hash);
            if (result.status === "NOT_FOUND") {
              attempts++;
              await new Promise((r) => setTimeout(r, 1000));
              continue;
            }
            if (result.status === "SUCCESS") {
              setIsSuccess(true);
              toast("Meta-address registered on-chain", "success");
            } else if (result.status === "FAILED") {
              throw new Error("Transaction failed on-chain");
            }
            break;
          } catch (pollErr: any) {
            // "Bad union switch" is a known XDR parsing issue with some Soroban results
            // If we get this but already have a hash, treat as success
            if (pollErr?.message?.includes("Bad union switch")) {
              setIsSuccess(true);
              toast("Meta-address registered on-chain", "success");
              break;
            }
            throw pollErr;
          }
        }
      } catch (err) {
        toast(parseError(err), "error");
      } finally {
        setIsPending(false);
        setIsConfirming(false);
      }
    },
    [address, network, soroban, networkPassphrase, signTransaction, toast]
  );

  return { registerKeys, isPending, isConfirming, isSuccess, hash };
}

export function useIsRegistered() {
  const { address, network } = useWallet();
  const soroban = useSorobanClient();
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const check = useCallback(async () => {
    if (!address) {
      setIsRegistered(false);
      setIsLoading(false);
      return;
    }

    const contracts = getContracts(network);
    if (!contracts || contracts.registry === "PLACEHOLDER_REGISTRY_ADDRESS") {
      setIsRegistered(false);
      setIsLoading(false);
      return;
    }

    try {
      // Query the registry for this address
      const contract = new Contract(contracts.registry);
      const accountResponse = await soroban.getAccount(address);
      const sourceAccount = new Account(
        accountResponse.accountId(),
        accountResponse.sequenceNumber()
      );

      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase:
          network === "testnet"
            ? "Test SDF Network ; September 2015"
            : "Public Global Stellar Network ; September 2015",
      })
        .addOperation(
          contract.call(
            "stealth_meta_address_of",
            new Address(address).toScVal(),
            nativeToScVal(SCHEME_ID, { type: "u32" })
          )
        )
        .setTimeout(30)
        .build();

      const simulated = await soroban.simulateTransaction(tx);
      if (!("error" in simulated) && "result" in simulated) {
        setIsRegistered(true);
      }
    } catch {
      setIsRegistered(false);
    }

    setIsLoading(false);
  }, [address, network, soroban]);

  useEffect(() => {
    check();
  }, [check]);

  return { isRegistered, isLoading };
}

export function useLookupMetaAddress(stellarAddress: string | undefined) {
  const { network } = useWallet();
  const soroban = useSorobanClient();
  const [metaAddress, setMetaAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!stellarAddress) {
      setMetaAddress(null);
      return;
    }

    const contracts = getContracts(network);
    if (!contracts || contracts.registry === "PLACEHOLDER_REGISTRY_ADDRESS") {
      setMetaAddress(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const contract = new Contract(contracts.registry);
        const accountResponse = await soroban.getAccount(stellarAddress);
        const sourceAccount = new Account(
          accountResponse.accountId(),
          accountResponse.sequenceNumber()
        );

        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase:
            network === "testnet"
              ? "Test SDF Network ; September 2015"
              : "Public Global Stellar Network ; September 2015",
        })
          .addOperation(
            contract.call(
              "stealth_meta_address_of",
              new Address(stellarAddress).toScVal(),
              nativeToScVal(SCHEME_ID, { type: "u32" })
            )
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(tx);
        if (
          !cancelled &&
          !("error" in simulated) &&
          "result" in simulated
        ) {
          // Extract the bytes from the result and construct the meta-address
          // For now placeholder - actual decoding depends on contract return type
          setMetaAddress(null);
        }
      } catch {
        if (!cancelled) setMetaAddress(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stellarAddress, network, soroban]);

  return { metaAddress, isLoading };
}
