/**
 * Server-only configuration, read lazily so `next build` works without secrets
 * and the CLI poller only needs the variables it actually uses.
 */

function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters long.`);
  }
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Classic PAT with the `public_repo` scope (or any token that can read the watched repos). */
  get githubToken() {
    return required("GITHUB_TOKEN");
  },
  /** Shared secret the scheduler sends as `Authorization: Bearer <CRON_SECRET>`. */
  get cronSecret() {
    return required("CRON_SECRET", 16);
  },
  get dashboardUser() {
    return required("DASHBOARD_USER");
  },
  get dashboardPassword() {
    return required("DASHBOARD_PASSWORD", 12);
  },
};
