"use client";

import { useEffect } from "react";

export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-16">
      <h1 className="text-lg font-semibold">The dashboard couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-neutral-500">
        This usually means the database is unreachable or an environment variable is missing. The server logs have the
        details. Check <code className="font-mono">DATABASE_URL</code> and <code className="font-mono">GITHUB_TOKEN</code>.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Try again
      </button>
    </main>
  );
}
