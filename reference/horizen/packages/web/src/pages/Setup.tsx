import { useState, useRef, useCallback } from "react";
import { useAccount, useChainId } from "wagmi";
import { QRCodeCanvas } from "qrcode.react";
import { useStealthKeyDerivation } from "@/hooks/useStealthKeys";
import { useRegisterKeys, useIsRegistered } from "@/hooks/useRegistry";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { VaultStatus } from "@/components/vault-status";
import { WalletButton } from "@/components/connect-button";
import { REGISTRY_ADDRESSES, WRAITH_NAMES_ADDRESSES } from "@/config/contracts";
import { useRegisterName, useMyName } from "@/hooks/useWraithNames";
import { txUrl } from "@/lib/explorer";
import type { HexString } from "@wraith-horizen/sdk";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-[10px] font-headline uppercase tracking-widest text-primary hover:text-primary-fixed transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  const url = txUrl(chainId, hash);
  if (!url)
    return (
      <span className="text-on-surface-variant">
        Tx: {hash.slice(0, 14)}...
      </span>
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-on-surface-variant hover:text-primary transition-colors underline"
    >
      {hash.slice(0, 14)}...
    </a>
  );
}

export default function Setup() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { keys, metaAddress } = useStealthKeysContext();
  const { deriveKeys, isLoading: isDeriving } = useStealthKeyDerivation();
  const { registerKeys, isPending, isConfirming, isSuccess, hash } =
    useRegisterKeys(chainId);
  const { isRegistered, isLoading: isCheckingRegistration } =
    useIsRegistered(chainId);
  const { registerName, registerNameSponsored, isPending: isNamePending, isConfirming: isNameConfirming, isSuccess: isNameSuccess } =
    useRegisterName();
  const { name: existingName, isLoading: isCheckingName } = useMyName();
  const [wraith_name, setWraithName] = useState("");
  const [showQR, setShowQR] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  const hasContract = !!REGISTRY_ADDRESSES[chainId];
  const hasNamesContract = !!WRAITH_NAMES_ADDRESSES[chainId];
  const alreadyRegistered = isRegistered || isSuccess;
  const displayName = existingName || (isNameSuccess ? wraith_name : null);
  const hasName = !!displayName;

  if (!isConnected) {
    return (
      <>
        <VaultStatus />
        <header className="mb-16">
          <h1 className="text-5xl font-headline font-bold tracking-tighter uppercase text-primary mb-2">
            Setup
          </h1>
          <p className="text-on-surface-variant text-sm max-w-md">
            Connect your wallet to initialize your stealth identity.
          </p>
        </header>
        <div className="flex justify-center">
          <WalletButton />
        </div>
      </>
    );
  }

  return (
    <>
      <VaultStatus />

      <header className="mb-16">
        <h1 className="text-5xl font-headline font-bold tracking-tighter uppercase text-primary mb-2">
          Setup
        </h1>
        <p className="text-on-surface-variant text-sm max-w-md">
          Initialize your sovereign identity. This generates your stealth
          meta-address for private transactions.
        </p>
      </header>

      <section className="space-y-12">
        <div
          className={`relative pl-8 border-l border-outline-variant ${
            keys ? "opacity-40" : ""
          }`}
        >
          <div className="absolute -left-[5px] top-0 w-[9px] h-[9px] bg-primary" />
          <div className="mb-6">
            <h2 className="font-headline text-lg font-bold tracking-tight text-primary uppercase mb-1">
              Key Derivation
            </h2>
            <p className="text-xs text-on-surface-variant uppercase tracking-wider font-headline">
              Cryptographic Handshake
            </p>
          </div>
          <div className="bg-surface-container-low p-6 space-y-4">
            <p className="text-sm leading-relaxed text-on-surface">
              Sign a message with your connected wallet to derive your viewing
              and spending keys. This does not incur gas fees. Your keys never
              leave the local environment.
            </p>
            {!keys && (
              <button
                onClick={deriveKeys}
                disabled={isDeriving}
                className="w-full brushed-metal py-4 text-on-primary font-headline font-bold uppercase tracking-[0.2em] text-sm hover:brightness-110 transition-all disabled:opacity-50"
              >
                {isDeriving ? "Signing..." : "Sign to Derive Keys"}
              </button>
            )}
          </div>
        </div>

        <div
          className={`relative pl-8 border-l border-outline-variant ${
            !keys ? "opacity-40" : ""
          }`}
        >
          <div
            className={`absolute -left-[5px] top-0 w-[9px] h-[9px] ${
              keys ? "bg-primary" : "bg-outline"
            }`}
          />
          <div className="mb-6">
            <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface uppercase mb-1">
              Stealth Identity
            </h2>
            <p className="text-xs text-on-surface-variant uppercase tracking-wider font-headline">
              Meta-Address Generation
            </p>
          </div>
          <div className="bg-surface-container-low p-6">
            <div className="mb-6">
              <label className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-3 block">
                Public Meta-Address
              </label>
              <div className="bg-surface-container-lowest p-6">
                <div className="text-[11px] font-headline leading-tight break-all text-primary opacity-90 tracking-tighter">
                  {metaAddress || "Keys not yet derived..."}
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <p className="text-[11px] text-on-surface-variant italic">
                  Share this to receive private payments.
                </p>
                {metaAddress && <CopyButton text={metaAddress} />}
              </div>
            </div>

            <div className="pt-6 border-t border-outline-variant/10">
              {alreadyRegistered ? (
                <div className="text-center space-y-1">
                  <p className="text-sm text-primary">Registered on-chain</p>
                  {hash ? (
                    <p className="text-[11px]">
                      <TxLink hash={hash} chainId={chainId} />
                    </p>
                  ) : (
                    <p className="text-[11px] text-on-surface-variant">
                      Meta-address already registered for this wallet
                    </p>
                  )}
                </div>
              ) : !hasContract ? (
                <div className="text-center">
                  <p className="text-[11px] text-on-surface-variant">
                    Registry contract not deployed on this network. Switch to
                    Horizen Testnet.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (!metaAddress) return;
                    const hex = metaAddress.slice("st:eth:0x".length);
                    registerKeys(`0x${hex}` as HexString);
                  }}
                  disabled={
                    !keys || isPending || isConfirming || isCheckingRegistration
                  }
                  className="w-full py-4 border border-outline-variant text-primary font-headline font-bold uppercase tracking-[0.2em] text-sm hover:bg-surface-container-high transition-all disabled:opacity-30"
                >
                  {isPending
                    ? "Confirm in wallet..."
                    : isConfirming
                    ? "Confirming..."
                    : "Register on-chain"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Wraith Name */}
      {keys && hasNamesContract && (
        <section className="mt-12">
          <div className="relative pl-8 border-l border-outline-variant">
            <div
              className={`absolute -left-[5px] top-0 w-[9px] h-[9px] ${
                hasName ? "bg-primary" : "bg-outline"
              }`}
            />
            <div className="mb-6">
              <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface uppercase mb-1">
                Wraith Name
              </h2>
              <p className="text-xs text-on-surface-variant uppercase tracking-wider font-headline">
                Optional
              </p>
            </div>
            <div className="bg-surface-container-low p-6">
              {hasName ? (
                <div className="text-center">
                  <span className="font-headline text-2xl text-primary font-bold tracking-tight">
                    {displayName}.wraith
                  </span>
                  <p className="text-[11px] text-on-surface-variant mt-2">
                    Anyone can send to you using this name
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-4">
                    <CopyButton text={`${window.location.origin}/pay/${displayName}`} />
                    <button
                      onClick={() => setShowQR(true)}
                      className="text-[10px] font-headline uppercase tracking-widest text-primary hover:text-primary-fixed transition-colors"
                    >
                      Show QR
                    </button>
                  </div>
                </div>
              ) : isCheckingName ? (
                <p className="text-[11px] text-on-surface-variant text-center">
                  Checking...
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed text-on-surface">
                    Choose a name so others can send to you without needing your
                    full meta-address. Names are permanent and map directly to
                    your stealth keys — no wallet address is stored.
                  </p>
                  <div className="flex gap-2">
                    <div className="flex-1 flex items-center bg-surface-container-lowest">
                      <input
                        type="text"
                        value={wraith_name}
                        onChange={(e) =>
                          setWraithName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))
                        }
                        placeholder="yourname"
                        className="flex-1 bg-transparent border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
                        maxLength={32}
                      />
                      <span className="pr-4 font-headline text-sm text-on-surface-variant">
                        .wraith
                      </span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => registerName(wraith_name)}
                        disabled={wraith_name.length < 3 || isNamePending || isNameConfirming}
                        className="px-5 py-3 border border-outline-variant text-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:bg-surface-container-high transition-all disabled:opacity-30"
                      >
                        {isNamePending && !isNameConfirming
                          ? "..."
                          : isNameConfirming
                          ? "..."
                          : "Claim"}
                      </button>
                      <button
                        onClick={() => registerNameSponsored(wraith_name)}
                        disabled={wraith_name.length < 3 || isNamePending || isNameConfirming}
                        className="px-5 py-3 bg-surface-container-high text-on-surface-variant font-headline uppercase tracking-widest text-[10px] hover:text-primary transition-all disabled:opacity-30"
                        title="Register via relayer — no gas needed"
                      >
                        {isNamePending ? "..." : "Sponsored"}
                      </button>
                    </div>
                  </div>
                  {wraith_name.length > 0 && wraith_name.length < 3 && (
                    <p className="text-[10px] text-on-surface-variant">
                      Name must be at least 3 characters
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <aside className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 bg-surface-container">
          <h4 className="font-headline text-xs font-bold uppercase tracking-widest text-on-surface mb-2">
            Key Separation
          </h4>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Your viewing key finds transfers. Your spending key accesses them.
            You can delegate scanning without risking funds.
          </p>
        </div>
        <div className="p-6 bg-surface-container">
          <h4 className="font-headline text-xs font-bold uppercase tracking-widest text-on-surface mb-2">
            Stealth Mechanism
          </h4>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Each transaction generates a unique one-time address, making it
            impossible to link incoming funds to your identity.
          </p>
        </div>
      </aside>

      {showQR && displayName && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setShowQR(false)}
        >
          <div
            className="bg-surface-container p-8 flex flex-col items-center gap-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h3 className="font-headline text-xl font-bold text-primary uppercase tracking-tight">
                {displayName}.wraith
              </h3>
              <p className="text-[11px] text-on-surface-variant mt-1">
                Scan to send privately
              </p>
            </div>

            <div className="bg-surface-container-lowest p-5">
              <QRCodeCanvas
                ref={qrRef}
                value={`${window.location.origin}/pay/${displayName}`}
                size={220}
                bgColor="#0e0e0e"
                fgColor="#c6c6c7"
                level="H"
                imageSettings={{
                  src: "/logo.png",
                  height: 44,
                  width: 44,
                  excavate: true,
                }}
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => {
                  const canvas = qrRef.current;
                  if (!canvas) return;
                  const url = canvas.toDataURL("image/png");
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${displayName}-wraith-qr.png`;
                  a.click();
                }}
                className="px-5 py-2.5 border border-outline-variant text-primary font-headline font-bold uppercase tracking-widest text-[10px] hover:bg-surface-container-high transition-all"
              >
                Download
              </button>
              <button
                onClick={() => setShowQR(false)}
                className="px-5 py-2.5 text-on-surface-variant font-headline uppercase tracking-widest text-[10px] hover:text-primary transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
