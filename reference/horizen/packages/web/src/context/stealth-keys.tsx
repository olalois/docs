import { createContext, useContext, useState, useCallback } from "react";
import type { StealthKeys, HexString } from "@wraith-horizen/sdk";

interface StealthKeysContextValue {
  keys: StealthKeys | null;
  metaAddress: string | null;
  setKeys: (keys: StealthKeys) => void;
  setMetaAddress: (metaAddress: string) => void;
  clear: () => void;
}

const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

export function StealthKeysProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [keys, setKeysState] = useState<StealthKeys | null>(null);
  const [metaAddress, setMetaAddressState] = useState<string | null>(null);

  const setKeys = useCallback((k: StealthKeys) => setKeysState(k), []);
  const setMetaAddress = useCallback(
    (m: string) => setMetaAddressState(m),
    []
  );
  const clear = useCallback(() => {
    setKeysState(null);
    setMetaAddressState(null);
  }, []);

  return (
    <StealthKeysContext.Provider
      value={{ keys, metaAddress, setKeys, setMetaAddress, clear }}
    >
      {children}
    </StealthKeysContext.Provider>
  );
}

export function useStealthKeysContext() {
  const ctx = useContext(StealthKeysContext);
  if (!ctx) throw new Error("useStealthKeysContext must be used within StealthKeysProvider");
  return ctx;
}
