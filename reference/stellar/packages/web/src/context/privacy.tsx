import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useWallet } from "@/context/wallet";

interface PrivacyContextValue {
  connectedAddresses: Set<string>;
  usedDestinations: Set<string>;
  addUsedDestination: (addr: string) => void;
  checkDestination: (addr: string) => PrivacyWarning | null;
}

export interface PrivacyWarning {
  level: "block" | "warn";
  message: string;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet();
  const [connectedAddresses, setConnectedAddresses] = useState<Set<string>>(
    new Set()
  );
  const [usedDestinations, setUsedDestinations] = useState<Set<string>>(
    new Set()
  );

  // Track every wallet address connected during this session
  useEffect(() => {
    if (address) {
      setConnectedAddresses((prev) => {
        const next = new Set(prev);
        next.add(address);
        return next;
      });
    }
  }, [address]);

  const addUsedDestination = useCallback((addr: string) => {
    setUsedDestinations((prev) => {
      const next = new Set(prev);
      next.add(addr);
      return next;
    });
  }, []);

  const checkDestination = useCallback(
    (addr: string): PrivacyWarning | null => {
      if (connectedAddresses.has(addr)) {
        return {
          level: "block",
          message:
            "This address was connected during this session. Withdrawing here links your stealth address to your identity.",
        };
      }

      if (usedDestinations.has(addr)) {
        return {
          level: "warn",
          message:
            "This address was already used as a withdrawal destination in this session. Reusing it creates a linkable pattern.",
        };
      }

      return null;
    },
    [connectedAddresses, usedDestinations]
  );

  return (
    <PrivacyContext.Provider
      value={{
        connectedAddresses,
        usedDestinations,
        addUsedDestination,
        checkDestination,
      }}
    >
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within PrivacyProvider");
  return ctx;
}
