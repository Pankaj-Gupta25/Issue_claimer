"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";

const subscribeNever = () => () => {};

/**
 * Submit button for server-action forms. It stays disabled until the page has
 * hydrated: a click before that would fall back to a full-page form post, and on
 * this Cache Components route that post comes back as a blank page. It also shows
 * `pendingLabel` while its form's action runs.
 */
export function SubmitButton({
  pendingLabel,
  children,
  disabled,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { pendingLabel?: string }) {
  // false while server-rendering and hydrating, true once React owns the page.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const { pending } = useFormStatus();

  return (
    <button {...props} type="submit" disabled={disabled || !hydrated || pending} aria-busy={pending || undefined}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
