import { Suspense } from "react";
import { Dashboard } from "./dashboard";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">Issue Radar</h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Dry run
        </span>
        <p className="w-full text-sm text-neutral-500">
          New issues in your watched repos are detected and checked against your filters. Nothing is posted to GitHub.
        </p>
      </header>
      {/* Everything below reads request headers (auth) and the database, so it renders per request. */}
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
