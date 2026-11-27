/** 42_000 → "42s", 300_000 → "5m", 7_200_000 → "2h", 3 days → "3d". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function timeAgo(date: Date | null, now: Date): string {
  return date ? `${formatDuration(now.getTime() - date.getTime())} ago` : "never";
}
