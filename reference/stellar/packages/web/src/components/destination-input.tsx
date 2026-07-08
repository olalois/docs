import { useState, useEffect } from "react";
import { usePrivacy, type PrivacyWarning } from "@/context/privacy";

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Check if a string looks like a valid Stellar public key (G..., 56 chars).
 */
function isStellarAddress(s: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(s);
}

export function DestinationInput({
  value,
  onChange,
  placeholder,
  className,
}: Props) {
  const { checkDestination } = usePrivacy();
  const [warning, setWarning] = useState<PrivacyWarning | null>(null);

  useEffect(() => {
    if (value && isStellarAddress(value)) {
      setWarning(checkDestination(value));
    } else {
      setWarning(null);
    }
  }, [value, checkDestination]);

  return (
    <div className="flex-1 flex flex-col gap-1.5">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Destination (G...)"}
        className={
          className ??
          "w-full bg-surface-container-lowest border-none py-3 px-4 font-headline text-sm text-primary focus:ring-0"
        }
      />
      {warning && (
        <p
          className={`text-[10px] font-body leading-relaxed ${
            warning.level === "block"
              ? "text-error"
              : "text-on-surface-variant"
          }`}
        >
          {warning.message}
        </p>
      )}
    </div>
  );
}

export function useIsBlocked(destination: string): boolean {
  const { checkDestination } = usePrivacy();
  if (!destination || !isStellarAddress(destination)) return false;
  const warning = checkDestination(destination);
  return warning?.level === "block";
}
