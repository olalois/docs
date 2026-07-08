import { EXPLORER_URLS } from "@/config/contracts";

export function txUrl(chainId: number, hash: string): string | null {
  const base = EXPLORER_URLS[chainId];
  if (!base) return null;
  return `${base}/tx/${hash}`;
}

export function addressUrl(chainId: number, address: string): string | null {
  const base = EXPLORER_URLS[chainId];
  if (!base) return null;
  return `${base}/address/${address}`;
}
