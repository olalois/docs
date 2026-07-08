import { useWallet } from "@/context/wallet";
import { NETWORKS } from "@/config/stellar";

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnected, network, connect, disconnect } = useWallet();

  if (!isConnected || !address) {
    return (
      <button
        onClick={connect}
        className="font-headline tracking-widest uppercase text-[10px] px-4 py-2 border border-outline-variant text-primary hover:bg-surface-container-high transition-all duration-150"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-headline text-[10px] uppercase tracking-widest text-on-surface-variant flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(198,198,199,0.5)]" />
        {NETWORKS[network].name}
      </span>
      <button
        onClick={disconnect}
        className="font-headline tracking-tighter text-[11px] px-3 py-1.5 bg-surface-container-high text-primary hover:bg-surface-container-highest transition-all duration-150"
      >
        {truncateAddress(address)}
      </button>
    </div>
  );
}
