"use client";

import { useActionState } from "react";
import { addRepoAction, type AddRepoState } from "./actions";
import { SubmitButton } from "./submit-button";

export function AddRepoForm() {
  const [state, action] = useActionState<AddRepoState, FormData>(addRepoAction, null);

  return (
    <form action={action} className="space-y-2">
      <label htmlFor="repo" className="sr-only">
        Repository
      </label>
      <div className="flex gap-2">
        <input
          // Re-mount after each attempt so a failed entry stays editable and a successful one clears.
          key={state?.at ?? 0}
          id="repo"
          name="repo"
          required
          defaultValue={state && !state.ok ? state.input : ""}
          placeholder="owner/name or GitHub URL"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:focus:border-neutral-400"
        />
        <SubmitButton
          pendingLabel="Checking…"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Watch
        </SubmitButton>
      </div>
      {state && (
        <p
          role="status"
          className={`text-xs ${state.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
