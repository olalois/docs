import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { NetworkId } from "@/config/stellar";
import { DEFAULT_NETWORK } from "@/config/stellar";

interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
  network: NetworkId;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<Uint8Array>;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkId>(DEFAULT_NETWORK);

  const isConnected = !!address;

  // Check if Freighter is already connected on mount
  useEffect(() => {
    (async () => {
      try {
        const freighter = await import("@stellar/freighter-api");
        const { isConnected: connected } = await freighter.isConnected();
        if (connected) {
          const { address: addr } = await freighter.getAddress();
          if (addr) {
            setAddress(addr);
          }
          const { networkPassphrase } = await freighter.getNetworkDetails();
          if (
            networkPassphrase === "Test SDF Network ; September 2015"
          ) {
            setNetwork("testnet");
          } else {
            setNetwork("pubnet");
          }
        }
      } catch {
        // Freighter not available
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    try {
      const freighter = await import("@stellar/freighter-api");
      const { isConnected: connected } = await freighter.isConnected();
      if (!connected) {
        throw new Error(
          "Freighter wallet not found. Please install the Freighter browser extension."
        );
      }

      await freighter.requestAccess();
      const { address: addr } = await freighter.getAddress();
      if (!addr) {
        throw new Error("Failed to get public key from Freighter");
      }
      setAddress(addr);

      const { networkPassphrase } = await freighter.getNetworkDetails();
      if (networkPassphrase === "Test SDF Network ; September 2015") {
        setNetwork("testnet");
      } else {
        setNetwork("pubnet");
      }
    } catch (err) {
      const error = err as Error;
      throw new Error(error.message || "Failed to connect wallet");
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const signMessage = useCallback(
    async (message: string): Promise<Uint8Array> => {
      if (!address) throw new Error("Wallet not connected");

      const freighter = await import("@stellar/freighter-api");
      const { signedMessage } = await freighter.signMessage(message, {
        address,
        networkPassphrase:
          network === "testnet"
            ? "Test SDF Network ; September 2015"
            : "Public Global Stellar Network ; September 2015",
      });

      // signedMessage is a base64-encoded ed25519 signature
      const raw = signedMessage as unknown as string;
      if (!raw) throw new Error("Signing failed: no signature returned");
      const binaryString = atob(raw);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    },
    [address, network]
  );

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!address) throw new Error("Wallet not connected");

      const freighter = await import("@stellar/freighter-api");
      const { signedTxXdr } = await freighter.signTransaction(xdr, {
        address,
        networkPassphrase:
          network === "testnet"
            ? "Test SDF Network ; September 2015"
            : "Public Global Stellar Network ; September 2015",
      });

      return signedTxXdr;
    },
    [address, network]
  );

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected,
        network,
        connect,
        disconnect,
        signMessage,
        signTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
