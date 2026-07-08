import { useState, useCallback, useRef } from "react";
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
  bytesToHex,
} from "@wraith/sdk";
import { useWallet } from "@/context/wallet";
import { useSorobanClient, useNetworkPassphrase, useHorizonUrl } from "./useSoroban";
import { getContracts, TOKENS } from "@/config/contracts";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";
import type { NetworkId } from "@/config/stellar";

export interface TokenOption {
  symbol: string;
  address: string;
  decimals: number;
}

export function getTokenList(network: NetworkId): TokenOption[] {
  return TOKENS[network] ?? TOKENS.testnet;
}

export function useSendStealth() {
  const { address, network, signTransaction } = useWallet();
  const soroban = useSorobanClient();
  const networkPassphrase = useNetworkPassphrase();
  const horizonUrl = useHorizonUrl();
  const { toast } = useToast();

  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    ephemeralPubKey: string;
    viewTag: number;
  } | null>(null);

  const [isPending, setIsPending] = useState(false);
  const [isSendConfirming, setIsSendConfirming] = useState(false);
  const [isSendSuccess, setIsSendSuccess] = useState(false);
  const [sendHash, setSendHash] = useState<string | null>(null);

  const toastedError = useRef<string | null>(null);

  const generateAndSend = useCallback(
    async (metaAddress: string, amount: string, token: TokenOption) => {
      const contracts = getContracts(network);
      if (!contracts || contracts.announcer === "PLACEHOLDER_ANNOUNCER_ADDRESS") {
        toast("Contracts not deployed on this network", "error");
        return;
      }
      if (!address) {
        toast("Wallet not connected", "error");
        return;
      }

      setIsPending(true);
      toastedError.current = null;

      try {
        // Generate stealth address
        const decoded = decodeStealthMetaAddress(metaAddress);
        const result = generateStealthAddress(
          decoded.spendingPubKey,
          decoded.viewingPubKey
        );
        setStealthResult({
          stealthAddress: result.stealthAddress,
          ephemeralPubKey: bytesToHex(result.ephemeralPubKey),
          viewTag: result.viewTag,
        });

        // Step 1: Create stealth account + send XLM via classic Stellar operation
        const accountRes = await fetch(`${horizonUrl}/accounts/${address}`);
        if (!accountRes.ok) throw new Error("Failed to load sender account");
        const accountData = await accountRes.json();
        const sourceAccount = new Account(address, accountData.sequence);

        // Check if stealth account already exists
        const stealthExists = await fetch(
          `${horizonUrl}/accounts/${result.stealthAddress}`
        ).then((r) => r.ok);

        let classicTx;

        if (token.address === "native") {
          if (stealthExists) {
            // Account exists, just send payment
            classicTx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase,
            })
              .addOperation(
                Operation.payment({
                  destination: result.stealthAddress,
                  asset: Asset.native(),
                  amount,
                })
              )
              .setTimeout(30)
              .build();
          } else {
            // Create account with the amount as starting balance
            classicTx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase,
            })
              .addOperation(
                Operation.createAccount({
                  destination: result.stealthAddress,
                  startingBalance: amount,
                })
              )
              .setTimeout(30)
              .build();
          }
        } else {
          // For tokens: create account first (if needed), then transfer via SAC
          // For MVP: create with minimum balance, then token transfer needs trustline setup
          // Simplified: just create with 1.5 XLM and do a separate token transfer
          if (!stealthExists) {
            const createTx = new TransactionBuilder(sourceAccount, {
              fee: "100",
              networkPassphrase,
            })
              .addOperation(
                Operation.createAccount({
                  destination: result.stealthAddress,
                  startingBalance: "2",
                })
              )
              .setTimeout(30)
              .build();

            setIsSendConfirming(true);
            const signedCreate = await signTransaction(createTx.toXDR());
            const createRes = await fetch(`${horizonUrl}/transactions`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `tx=${encodeURIComponent(signedCreate)}`,
            });
            if (!createRes.ok) {
              const err = await createRes.json();
              throw new Error(err.extras?.result_codes?.transaction || "Account creation failed");
            }
            setIsSendConfirming(false);
          }

          // Token transfer via payment (for USDC etc)
          // Re-fetch sequence after create
          const freshRes = await fetch(`${horizonUrl}/accounts/${address}`);
          const freshData = await freshRes.json();
          const freshAccount = new Account(address, freshData.sequence);

          classicTx = new TransactionBuilder(freshAccount, {
            fee: "100",
            networkPassphrase,
          })
            .addOperation(
              Operation.payment({
                destination: result.stealthAddress,
                asset: Asset.native(), // TODO: resolve SAC asset for non-native tokens
                amount,
              })
            )
            .setTimeout(30)
            .build();
        }

        // Sign and submit the classic transaction
        setIsSendConfirming(true);
        const signedXdr = await signTransaction(classicTx.toXDR());

        const submitRes = await fetch(`${horizonUrl}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `tx=${encodeURIComponent(signedXdr)}`,
        });

        const submitData = await submitRes.json();
        if (!submitRes.ok) {
          throw new Error(
            submitData.extras?.result_codes?.transaction ||
              submitData.title ||
              "Transaction failed"
          );
        }

        setSendHash(submitData.hash);

        // Step 2: Emit announcement via Soroban announcer contract
        try {
          const announcerContract = new Contract(contracts.announcer);
          const freshRes2 = await fetch(`${horizonUrl}/accounts/${address}`);
          const freshData2 = await freshRes2.json();
          const freshAccount2 = new Account(address, freshData2.sequence);

          const announceTx = new TransactionBuilder(freshAccount2, {
            fee: "100",
            networkPassphrase,
          })
            .addOperation(
              announcerContract.call(
                "announce",
                nativeToScVal(SCHEME_ID, { type: "u32" }),
                new Address(result.stealthAddress).toScVal(),
                xdr.ScVal.scvBytes(Buffer.from(result.ephemeralPubKey)),
                xdr.ScVal.scvBytes(Buffer.from([result.viewTag]))
              )
            )
            .setTimeout(30)
            .build();

          const simulated = await soroban.simulateTransaction(announceTx);
          if (!("error" in simulated)) {
            const { rpc: rpcMod } = await import("@stellar/stellar-sdk");
            const assembled = rpcMod
              .assembleTransaction(announceTx, simulated as any)
              .build();

            const signedAnnounce = await signTransaction(assembled.toXDR());
            await soroban.sendTransaction(
              TransactionBuilder.fromXDR(signedAnnounce, networkPassphrase)
            );
          }
        } catch {
          // Announcement is best-effort — payment already succeeded
        }

        setIsSendSuccess(true);
        toast("Transfer complete", "success");

        return result;
      } catch (err) {
        const msg = parseError(err);
        if (toastedError.current !== msg) {
          toastedError.current = msg;
          toast(msg, "error");
        }
      } finally {
        setIsPending(false);
        setIsSendConfirming(false);
      }
    },
    [address, network, soroban, networkPassphrase, horizonUrl, signTransaction, toast]
  );

  const reset = useCallback(() => {
    setStealthResult(null);
    setIsPending(false);
    setIsSendConfirming(false);
    setIsSendSuccess(false);
    setSendHash(null);
    toastedError.current = null;
  }, []);

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
