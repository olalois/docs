import { useParams, Link } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { useResolveName } from "@/hooks/useWraithNames";
import { VaultStatus } from "@/components/vault-status";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-[10px] font-headline uppercase tracking-widest text-primary hover:text-primary-fixed transition-colors"
    >
      {copied ? "Copied" : "Copy Link"}
    </button>
  );
}

import { useState } from "react";

export default function Pay() {
  const { name } = useParams<{ name: string }>();
  const cleanName = name?.replace(/\.wraith$/i, "").toLowerCase() ?? "";
  const { metaAddress, isLoading } = useResolveName(cleanName.length >= 3 ? cleanName : undefined);

  const payUrl = `${window.location.origin}/pay/${cleanName}`;
  const sendUrl = `/send?to=${cleanName}`;

  if (!cleanName || cleanName.length < 3) {
    return (
      <>
        <VaultStatus />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary mb-4">
            Invalid Name
          </h1>
          <p className="text-on-surface-variant text-sm">
            The payment link is invalid.
          </p>
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <VaultStatus />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-on-surface-variant text-sm">Resolving {cleanName}.wraith...</p>
        </div>
      </>
    );
  }

  if (!metaAddress) {
    return (
      <>
        <VaultStatus />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h1 className="font-headline text-4xl font-bold tracking-tighter uppercase text-primary mb-4">
            Not Found
          </h1>
          <p className="text-on-surface-variant text-sm">
            <span className="text-primary">{cleanName}.wraith</span> is not registered.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <VaultStatus />

      <div className="flex flex-col items-center text-center gap-12">
        <div>
          <h1 className="font-headline text-5xl font-bold tracking-tighter uppercase text-primary mb-2">
            {cleanName}.wraith
          </h1>
          <p className="text-on-surface-variant text-sm">
            Scan to send privately
          </p>
        </div>

        <div className="bg-surface-container-lowest p-6 inline-block">
          <QRCodeCanvas
            value={payUrl}
            size={240}
            bgColor="#0e0e0e"
            fgColor="#c6c6c7"
            level="H"
            imageSettings={{
              src: "/logo.png",
              height: 48,
              width: 48,
              excavate: true,
            }}
          />
        </div>

        <div className="space-y-4 w-full max-w-sm">
          <div className="bg-surface-container-lowest p-4">
            <p className="text-[10px] font-headline uppercase tracking-widest text-on-surface-variant mb-2">
              Meta-Address
            </p>
            <code className="text-[10px] font-headline break-all text-primary opacity-80 leading-tight">
              {metaAddress}
            </code>
          </div>

          <div className="flex items-center justify-center gap-4">
            <CopyButton text={payUrl} />
            <Link
              to={sendUrl}
              className="text-[10px] font-headline uppercase tracking-widest text-primary hover:text-primary-fixed transition-colors"
            >
              Send Now
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
