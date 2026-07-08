import { useState, useCallback, useRef } from "react";
import { scanAnnouncements, SCHEME_ID } from "@wraith-horizen/sdk";
import type { HexString, Announcement, MatchedAnnouncement } from "@wraith-horizen/sdk";
import { SUBGRAPH_URLS } from "@/config/subgraph";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

const ANNOUNCEMENTS_QUERY = `
  query($first: Int!, $skip: Int!) {
    announcements(
      first: $first
      skip: $skip
      where: { schemeId: "1" }
      orderBy: block_number
      orderDirection: asc
    ) {
      schemeId
      stealthAddress
      caller
      ephemeralPubKey
      metadata
    }
  }
`;

async function fetchAllAnnouncements(url: string): Promise<Announcement[]> {
  const all: Announcement[] = [];
  let skip = 0;
  const first = 1000;

  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: ANNOUNCEMENTS_QUERY,
        variables: { first, skip },
      }),
    });

    const json = await res.json();
    const items = json.data?.announcements ?? [];

    for (const item of items) {
      all.push({
        schemeId: BigInt(item.schemeId),
        stealthAddress: item.stealthAddress as HexString,
        caller: item.caller as HexString,
        ephemeralPubKey: item.ephemeralPubKey as HexString,
        metadata: item.metadata as HexString,
      });
    }

    if (items.length < first) break;
    skip += first;
  }

  return all;
}

export function useScanAnnouncements(chainId: number) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const scanLock = useRef(false);

  const scan = useCallback(
    async (
      viewingKey: HexString,
      spendingPubKey: HexString,
      spendingKey: HexString,
      silent = false
    ) => {
      if (scanLock.current) return;

      const subgraphUrl = SUBGRAPH_URLS[chainId];
      if (!subgraphUrl) {
        if (!silent) toastRef.current("Subgraph not available for this network", "error");
        return;
      }

      scanLock.current = true;
      setIsScanning(true);

      try {
        const announcements = await fetchAllAnnouncements(subgraphUrl);

        const results = scanAnnouncements(
          announcements,
          viewingKey,
          spendingPubKey,
          spendingKey
        );

        setMatched(results);

        if (!silent) {
          if (results.length > 0) {
            toastRef.current(
              `Found ${results.length} stealth transfer${results.length > 1 ? "s" : ""}`,
              "success"
            );
          } else {
            toastRef.current(
              `Scanned ${announcements.length} announcement${announcements.length !== 1 ? "s" : ""} — none matched`,
              "info"
            );
          }
        }
      } catch (err) {
        if (!silent) toastRef.current(parseError(err), "error");
      } finally {
        setIsScanning(false);
        scanLock.current = false;
      }
    },
    [chainId]
  );

  return { scan, matched, isScanning };
}
