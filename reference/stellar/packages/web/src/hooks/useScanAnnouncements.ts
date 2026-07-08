import { useState, useCallback, useRef } from "react";
import { xdr, Address } from "@stellar/stellar-sdk";
import { scanAnnouncements, SCHEME_ID, bytesToHex } from "@wraith/sdk";
import type { Announcement, MatchedAnnouncement } from "@wraith/sdk";
import { useWallet } from "@/context/wallet";
import { getContracts } from "@/config/contracts";
import { NETWORKS } from "@/config/stellar";
import { useToast } from "@/context/toast";
import { parseError } from "@/lib/errors";

/**
 * Fetches announcement events directly from Soroban RPC using JSON-RPC.
 * Parses the XDR-encoded topics and values into Announcement objects.
 */
async function fetchAnnouncementEvents(
  rpcUrl: string,
  contractId: string
): Promise<Announcement[]> {
  const all: Announcement[] = [];

  try {
    // Discover the valid ledger range by making a probe request.
    let startLedger = 1;
    const probeRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "getEvents",
        params: {
          startLedger: 1,
          filters: [{ type: "contract", contractIds: [contractId] }],
          pagination: { limit: 1 },
        },
      }),
    });
    const probeData = await probeRes.json();

    if (probeData.error?.message) {
      const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
      if (match) {
        const oldest = parseInt(match[1], 10);
        const latest = parseInt(match[2], 10);
        // Soroban RPC has an internal limit on how far back it scans
        // for events in a single request. Use a tight window from the
        // latest ledger to ensure events are returned.
        startLedger = Math.max(oldest, latest - 5000);
      } else {
        return all;
      }
    } else if (probeData.result?.events?.length > 0) {
      startLedger = 1;
    }

    // Fetch events from the announcer contract
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params: any = {
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
          },
        ],
        pagination: { limit: 1000 },
      };

      if (cursor) {
        params.pagination.cursor = cursor;
      } else {
        params.startLedger = startLedger;
      }

      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "getEvents",
          params,
        }),
      });

      const data = await res.json();
      const events = data.result?.events ?? [];

      for (const event of events) {
        try {
          const ann = parseAnnouncementEvent(event);
          if (ann) all.push(ann);
        } catch {
          // Skip malformed events
        }
      }

      if (events.length < 1000) {
        hasMore = false;
      } else {
        cursor = data.result?.cursor;
        if (!cursor) hasMore = false;
      }
    }
  } catch {
    // Events API may not be available
  }

  return all;
}

/**
 * Parses a raw Soroban event into an Announcement.
 *
 * Event structure from StealthAnnouncer contract:
 *   topics: [Symbol("announce"), u32(scheme_id), Address(stealth_address)]
 *   value:  (Address(caller), BytesN<32>(ephemeral_pub_key), Bytes(metadata))
 */
function parseAnnouncementEvent(event: any): Announcement | null {
  const topics = event.topic;
  if (!topics || topics.length < 3) return null;

  // topic[1] = scheme_id (u32)
  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], "base64");
  const schemeId = schemeIdScVal.u32();

  // topic[2] = stealth_address (Address)
  const stealthScVal = xdr.ScVal.fromXDR(topics[2], "base64");
  const stealthScAddress = stealthScVal.address();
  const stealthAddress = Address.fromScAddress(stealthScAddress).toString();

  // value = tuple (caller, ephemeral_pub_key, metadata)
  const valueScVal = xdr.ScVal.fromXDR(event.value, "base64");
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  // caller
  const callerScAddress = valueVec[0].address();
  const caller = Address.fromScAddress(callerScAddress).toString();

  // ephemeral_pub_key (BytesN<32>)
  const ephBytes = valueVec[1].bytes();
  const ephemeralPubKey = bytesToHex(new Uint8Array(ephBytes));

  // metadata (Bytes)
  const metaBytes = valueVec[2].bytes();
  const metadata = bytesToHex(new Uint8Array(metaBytes));

  return {
    schemeId,
    stealthAddress,
    caller,
    ephemeralPubKey,
    metadata,
  };
}

export function useScanAnnouncements() {
  const { network } = useWallet();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const scanLock = useRef(false);

  const scan = useCallback(
    async (
      viewingKey: Uint8Array,
      spendingPubKey: Uint8Array,
      spendingScalar: bigint,
      silent = false
    ) => {
      if (scanLock.current) return;

      const contracts = getContracts(network);
      if (
        !contracts ||
        contracts.announcer === "PLACEHOLDER_ANNOUNCER_ADDRESS"
      ) {
        if (!silent)
          toastRef.current(
            "Announcer contract not deployed on this network",
            "error"
          );
        return;
      }

      const rpcUrl = NETWORKS[network]?.rpcUrl;
      if (!rpcUrl) {
        if (!silent) toastRef.current("RPC URL not configured", "error");
        return;
      }

      scanLock.current = true;
      setIsScanning(true);

      try {
        const announcements = await fetchAnnouncementEvents(
          rpcUrl,
          contracts.announcer
        );

        const results = scanAnnouncements(
          announcements,
          viewingKey,
          spendingPubKey,
          spendingScalar
        );

        setMatched(results);

        if (!silent) {
          if (results.length > 0) {
            toastRef.current(
              `Found ${results.length} stealth transfer${
                results.length > 1 ? "s" : ""
              }`,
              "success"
            );
          } else {
            toastRef.current(
              `Scanned ${announcements.length} announcement${
                announcements.length !== 1 ? "s" : ""
              } -- none matched`,
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
    [network]
  );

  return { scan, matched, isScanning };
}
