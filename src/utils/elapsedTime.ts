/** Format a live activity duration using the desktop conversation timer contract. */
export function formatElapsedSeconds(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  if (totalSeconds < 60) return `${totalSeconds}s`

  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}
