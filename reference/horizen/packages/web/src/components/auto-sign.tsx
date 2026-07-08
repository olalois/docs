import { useEffect, useRef, useState } from "react";
import { useAccount, useConnectorClient } from "wagmi";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useStealthKeyDerivation } from "@/hooks/useStealthKeys";

export function AutoSign() {
  const { isConnected, address, connector } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { keys } = useStealthKeysContext();
  const { deriveKeys, isLoading } = useStealthKeyDerivation();
  const prompted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  // Wait for connector to be fully initialized after page refresh
  useEffect(() => {
    if (isConnected && connector && connectorClient) {
      const timer = setTimeout(() => setReady(true), 500);
      return () => clearTimeout(timer);
    }
    setReady(false);
  }, [isConnected, connector, connectorClient]);

  useEffect(() => {
    if (!ready || !address) return;
    if (keys) return;
    if (isLoading) return;
    if (prompted.current === address) return;

    prompted.current = address;
    deriveKeys();
  }, [ready, address, keys, isLoading, deriveKeys]);

  useEffect(() => {
    if (!isConnected) {
      prompted.current = null;
      setReady(false);
    }
  }, [isConnected]);

  return null;
}
