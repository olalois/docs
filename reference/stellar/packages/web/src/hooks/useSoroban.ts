import { rpc } from "@stellar/stellar-sdk";
import { NETWORKS, DEFAULT_NETWORK } from "@/config/stellar";
import { useWallet } from "@/context/wallet";

export function useSorobanClient() {
  const { network } = useWallet();
  const net = NETWORKS[network ?? DEFAULT_NETWORK];
  return new rpc.Server(net.rpcUrl);
}

export function useHorizonUrl() {
  const { network } = useWallet();
  const net = NETWORKS[network ?? DEFAULT_NETWORK];
  return net.horizonUrl;
}

export function useNetworkPassphrase() {
  const { network } = useWallet();
  const net = NETWORKS[network ?? DEFAULT_NETWORK];
  return net.networkPassphrase;
}
