import { NETWORKS, type NetworkId } from "@/config/stellar";

export function txUrl(network: NetworkId, hash: string): string | null {
  const net = NETWORKS[network];
  return net ? `${net.explorerUrl}/tx/${hash}` : null;
}

export function addressUrl(
  network: NetworkId,
  address: string
): string | null {
  const net = NETWORKS[network];
  return net ? `${net.explorerUrl}/account/${address}` : null;
}
