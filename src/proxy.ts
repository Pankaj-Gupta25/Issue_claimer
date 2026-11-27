import { NextResponse, type NextRequest } from "next/server";
import { isDashboardAuthorized } from "@/lib/auth";

/**
 * Puts the whole dashboard behind HTTP Basic auth. /api/poll is excluded: it has
 * its own bearer-token check. Pages and server actions re-check auth themselves
 * (see requireDashboardAuth), because Next.js treats Proxy as an optimistic gate only.
 */
export function proxy(request: NextRequest) {
  let authorized: boolean;
  try {
    authorized = isDashboardAuthorized(request.headers.get("authorization"));
  } catch (err) {
    console.error(err);
    return new NextResponse("Dashboard credentials are not configured (DASHBOARD_USER / DASHBOARD_PASSWORD).", {
      status: 500,
    });
  }

  if (authorized) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Issue Radar", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/poll|_next/static|_next/image|favicon.ico).*)"],
};
