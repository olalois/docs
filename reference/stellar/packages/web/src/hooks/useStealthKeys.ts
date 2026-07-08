import { useCallback, useState } from "react";
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  STEALTH_SIGNING_MESSAGE,
} from "@wraith/sdk";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useWallet } from "@/context/wallet";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

export function useStealthKeyDerivation() {
  const { setKeys, setMetaAddress } = useStealthKeysContext();
  const { signMessage } = useWallet();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const deriveKeys = useCallback(async () => {
    setIsLoading(true);

    try {
      // Sign the derivation message with Freighter to get ed25519 signature
      const signature = await signMessage(STEALTH_SIGNING_MESSAGE);

      const keys = deriveStealthKeys(signature);
      const metaAddr = encodeStealthMetaAddress(
        keys.spendingPubKey,
        keys.viewingPubKey
      );

      setKeys(keys);
      setMetaAddress(metaAddr);
      toast("Stealth keys derived successfully", "success");

      return { keys, metaAddress: metaAddr };
    } catch (err) {
      toast(parseError(err), "error");
    } finally {
      setIsLoading(false);
    }
  }, [signMessage, setKeys, setMetaAddress, toast]);

  return { deriveKeys, isLoading };
}
