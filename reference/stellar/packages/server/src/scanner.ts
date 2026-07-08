import { Horizon } from "@stellar/stellar-sdk";

/**
 * Stealth payment scanner that checks Stellar for incoming payments
 * to one-time stealth addresses.
 *
 * Uses the Horizon API to query account balances and verify that
 * payments have arrived at the expected stealth addresses.
 */
export class StealthScanner {
  private horizon: Horizon.Server;

  constructor(network: "testnet" | "pubnet") {
    const url =
      network === "testnet"
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org";

    this.horizon = new Horizon.Server(url);
  }

  /**
   * Checks whether a payment of sufficient amount has arrived at a stealth address.
   *
   * Looks up the account on Horizon and checks if the native XLM balance or
   * any USDC balance meets or exceeds the expected amount.
   *
   * @param stealthAddress - The Stellar public key (G...) of the stealth address.
   * @param expectedAmount - The minimum payment amount expected (as a number, e.g. 0.01).
   * @returns true if a sufficient payment was detected.
   */
  async checkPayment(
    stealthAddress: string,
    expectedAmount: number
  ): Promise<boolean> {
    try {
      const account = await this.horizon.loadAccount(stealthAddress);

      // Check for USDC balance (primary payment asset for x402)
      for (const balance of account.balances) {
        if (
          balance.asset_type === "credit_alphanum4" &&
          (balance as Horizon.HorizonApi.BalanceLineAsset).asset_code ===
            "USDC"
        ) {
          const amount = parseFloat(
            (balance as Horizon.HorizonApi.BalanceLineAsset).balance
          );
          if (amount >= expectedAmount) {
            return true;
          }
        }
      }

      // Also check native XLM balance as fallback
      // For stealth addresses funded via createAccount, the total balance
      // IS the payment amount (reserve is included in startingBalance).
      for (const balance of account.balances) {
        if (balance.asset_type === "native") {
          const amount = parseFloat(
            (balance as Horizon.HorizonApi.BalanceLineNative).balance
          );
          if (amount >= expectedAmount) {
            return true;
          }
        }
      }

      return false;
    } catch (error: unknown) {
      // Account not found means no payment has been made yet
      if (
        error instanceof Error &&
        "response" in error &&
        (error as { response?: { status?: number } }).response?.status === 404
      ) {
        return false;
      }

      console.error(
        `[scanner] Error checking payment for ${stealthAddress}:`,
        error
      );
      return false;
    }
  }

  /**
   * Polls for a payment with retries and a timeout.
   *
   * @param stealthAddress - The stealth address to watch.
   * @param expectedAmount - Minimum payment amount.
   * @param timeoutMs - Maximum time to wait (default: 5 minutes).
   * @param intervalMs - Polling interval (default: 3 seconds).
   * @returns true if payment detected within timeout, false otherwise.
   */
  async waitForPayment(
    stealthAddress: string,
    expectedAmount: number,
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 3000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const found = await this.checkPayment(stealthAddress, expectedAmount);
      if (found) return true;

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
  }
}
