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
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useSorobanClient, useNetworkPassphrase } from "./useSoroban";
import { getContracts } from "@/config/contracts";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";
import { bytesToHex } from "@wraith/sdk";

export function useRegisterName() {
  const { address, network, signTransaction } = useWallet();
  const { keys, metaAddress } = useStealthKeysContext();
  const soroban = useSorobanClient();
  const networkPassphrase = useNetworkPassphrase();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const registerName = useCallback(
    async (name: string) => {
      const contracts = getContracts(network);
      if (!contracts || !contracts.names) {
        toast("Names contract not deployed", "error");
        return;
      }
      if (!address || !keys || !metaAddress) {
        toast("Wallet not connected or keys not derived", "error");
        return;
      }

      setIsPending(true);
      try {
        const accountResponse = await soroban.getAccount(address);
        const sourceAccount = new Account(
          accountResponse.accountId(),
          accountResponse.sequenceNumber()
        );

        const contract = new Contract(contracts.names);

        // Concatenate spending + viewing pubkeys into 64-byte meta-address
        const metaBytes = new Uint8Array(64);
        metaBytes.set(keys.spendingPubKey, 0);
        metaBytes.set(keys.viewingPubKey, 32);

        const tx = new TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase,
        })
          .addOperation(
            contract.call(
              "register",
              new Address(address).toScVal(),
              xdr.ScVal.scvString(name),
              xdr.ScVal.scvBytes(Buffer.from(metaBytes))
            )
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(tx);
        if ("error" in simulated) {
          throw new Error(
            (simulated as { error: string }).error || "Simulation failed"
          );
        }

        const { rpc: rpcMod } = await import("@stellar/stellar-sdk");
        const assembled = rpcMod
          .assembleTransaction(tx, simulated as any)
          .build();

        setIsConfirming(true);
        const signedXdr = await signTransaction(assembled.toXDR());

        const response = await soroban.sendTransaction(
          TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
        );

        if (response.status === "ERROR") {
          throw new Error("Transaction submission failed");
        }

        // Poll
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
              toast(`Name "${name}.wraith" registered`, "success");
            } else if (result.status === "FAILED") {
              throw new Error("Transaction failed on-chain");
            }
            break;
          } catch (pollErr: any) {
            if (pollErr?.message?.includes("Bad union switch")) {
              setIsSuccess(true);
              toast(`Name "${name}.wraith" registered`, "success");
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
    [address, network, keys, metaAddress, soroban, networkPassphrase, signTransaction, toast]
  );

  return { registerName, isPending, isConfirming, isSuccess };
}

export function useResolveName(name: string | undefined) {
  const { network } = useWallet();
  const soroban = useSorobanClient();
  const networkPassphrase = useNetworkPassphrase();
  const [metaAddress, setMetaAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!name || name.length < 3) {
      setMetaAddress(null);
      return;
    }

    const contracts = getContracts(network);
    if (!contracts || !contracts.names) {
      setMetaAddress(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        // We need a source account for simulation — use a dummy
        // Simulate a read-only call to resolve(name)
        const contract = new Contract(contracts.names);

        const rpcUrl =
          network === "testnet"
            ? "https://soroban-testnet.stellar.org"
            : "https://soroban.stellar.org";

        // Use raw JSON-RPC to simulate without needing a real account
        const tx = new TransactionBuilder(
          new Account(
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            "0"
          ),
          { fee: "100", networkPassphrase }
        )
          .addOperation(
            contract.call("resolve", xdr.ScVal.scvString(name))
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(tx);

        if (
          !cancelled &&
          !("error" in simulated) &&
          "result" in simulated &&
          (simulated as any).result?.retval
        ) {
          const retval = (simulated as any).result.retval;
          // retval is ScVal of type scvBytes (64 bytes: spending || viewing)
          const resultXdr = xdr.ScVal.fromXDR(retval.toXDR());
          const bytes = resultXdr.bytes();
          if (bytes && bytes.length === 64) {
            const spendHex = bytesToHex(new Uint8Array(bytes.slice(0, 32)));
            const viewHex = bytesToHex(new Uint8Array(bytes.slice(32)));
            setMetaAddress(`st:xlm:${spendHex}${viewHex}`);
          }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, network, networkPassphrase]);

  return { metaAddress, isLoading };
}

export function useMyName() {
  const { network } = useWallet();
  const { keys } = useStealthKeysContext();
  const soroban = useSorobanClient();
  const networkPassphrase = useNetworkPassphrase();
  const [name, setName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!keys) {
      setName(null);
      return;
    }

    const contracts = getContracts(network);
    if (!contracts || !contracts.names) {
      setName(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        const contract = new Contract(contracts.names);
        const metaBytes = new Uint8Array(64);
        metaBytes.set(keys.spendingPubKey, 0);
        metaBytes.set(keys.viewingPubKey, 32);

        const tx = new TransactionBuilder(
          new Account(
            "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            "0"
          ),
          { fee: "100", networkPassphrase }
        )
          .addOperation(
            contract.call(
              "name_of",
              xdr.ScVal.scvBytes(Buffer.from(metaBytes))
            )
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(tx);

        if (
          !cancelled &&
          !("error" in simulated) &&
          "result" in simulated &&
          (simulated as any).result?.retval
        ) {
          const retval = (simulated as any).result.retval;
          const resultXdr = xdr.ScVal.fromXDR(retval.toXDR());
          const nameStr = resultXdr.str()?.toString();
          if (nameStr && nameStr.length > 0) {
            setName(nameStr);
          }
        }
      } catch {
        if (!cancelled) setName(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys?.spendingPubKey, network, networkPassphrase]);

  return { name, isLoading };
}
