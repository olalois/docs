import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/config/wagmi";
import { StealthKeysProvider } from "@/context/stealth-keys";
import { ToastProvider } from "@/context/toast";
import { PrivacyProvider } from "@/context/privacy";
import { useState } from "react";

import "@rainbow-me/rainbowkit/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <StealthKeysProvider>
            <ToastProvider>
              <PrivacyProvider>{children}</PrivacyProvider>
            </ToastProvider>
          </StealthKeysProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
