import { headers } from "next/headers";
import { isDashboardAuthorized } from "@/lib/auth";

/**
 * Call at the top of every dashboard data read and every server action.
 * Server actions are reachable by direct POST, so the Proxy check alone isn't enough.
 */
export async function requireDashboardAuth(): Promise<void> {
  const requestHeaders = await headers();
  if (!isDashboardAuthorized(requestHeaders.get("authorization"))) {
    throw new Error("Unauthorized");
  }
}
