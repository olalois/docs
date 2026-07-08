import { useCallback, useState } from "react";
import { useSignMessage } from "wagmi";
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  STEALTH_SIGNING_MESSAGE,
} from "@wraith-horizen/sdk";
import type { HexString } from "@wraith-horizen/sdk";
import { useStealthKeysContext } from "@/context/stealth-keys";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

export function useStealthKeyDerivation() {
  const { setKeys, setMetaAddress } = useStealthKeysContext();
  const { signMessageAsync } = useSignMessage();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const deriveKeys = useCallback(async () => {
    setIsLoading(true);

    try {
      const signature = await signMessageAsync({
        message: STEALTH_SIGNING_MESSAGE,
      });

      const keys = deriveStealthKeys(signature as HexString);
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
  }, [signMessageAsync, setKeys, setMetaAddress, toast]);

  return { deriveKeys, isLoading };
}
