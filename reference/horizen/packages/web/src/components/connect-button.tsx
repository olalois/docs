import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return (
            <div className="h-8 w-28 bg-surface-container-high animate-pulse" />
          );
        }

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              className="font-headline tracking-widest uppercase text-[10px] px-4 py-2 border border-outline-variant text-primary hover:bg-surface-container-high transition-all duration-150"
            >
              Connect Wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              className="font-headline tracking-widest uppercase text-[10px] px-4 py-2 bg-error-container text-on-error-container hover:brightness-110 transition-all duration-150"
            >
              Wrong Network
            </button>
          );
        }

        return (
          <div className="flex items-center gap-3">
            <button
              onClick={openChainModal}
              className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors duration-150 flex items-center gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(198,198,199,0.5)]" />
              {chain.name}
            </button>
            <button
              onClick={openAccountModal}
              className="font-headline tracking-tighter text-[11px] px-3 py-1.5 bg-surface-container-high text-primary hover:bg-surface-container-highest transition-all duration-150"
            >
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
