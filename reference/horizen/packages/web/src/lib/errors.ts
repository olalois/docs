export function parseError(err: unknown): string {
  if (!err) return "Unknown error";

  const error = err as { shortMessage?: string; message?: string; details?: string; cause?: { shortMessage?: string; message?: string } };

  // Wagmi/viem errors have shortMessage
  if (error.shortMessage) {
    // Strip "ContractFunctionExecutionError: " prefixes etc.
    return cleanMessage(error.shortMessage);
  }

  // Nested cause
  if (error.cause?.shortMessage) {
    return cleanMessage(error.cause.shortMessage);
  }

  if (error.details) {
    return cleanMessage(error.details);
  }

  if (error.message) {
    return cleanMessage(error.message);
  }

  return "Something went wrong";
}

function cleanMessage(msg: string): string {
  // Remove common prefixes
  return msg
    .replace(/^User rejected the request\.?/, "Transaction rejected by user")
    .replace(/^The requested method .* is not supported.*/, "Method not supported by wallet")
    .replace(/execution reverted:?\s*/i, "")
    .trim();
}
