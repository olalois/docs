import { WalletProvider } from "@/context/wallet";
import { StealthKeysProvider } from "@/context/stealth-keys";
import { ToastProvider } from "@/context/toast";
import { PrivacyProvider } from "@/context/privacy";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <StealthKeysProvider>
        <ToastProvider>
          <PrivacyProvider>{children}</PrivacyProvider>
        </ToastProvider>
      </StealthKeysProvider>
    </WalletProvider>
  );
}
