/**
 * Keep cached picker rows visible until the auxiliary refresh resolves.
 *
 * `null` means the refresh has not produced an authoritative result yet;
 * an empty array is a valid result and must not fall back to stale cached rows.
 */
export function sessionPickerRowsForDisplay<T>(
  refreshedRows: readonly T[] | null,
  cachedRows: readonly T[],
): readonly T[] {
  return refreshedRows ?? cachedRows
}
