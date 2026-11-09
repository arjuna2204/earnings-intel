/**
 * Peers are picked by SEC industry code, which sometimes groups very different businesses (Apple with
 * PC makers). If the peer median forward P/E is less than half or more than double what this stock
 * usually trades at, the peers aren't a fair yardstick: don't use them for valuation, and say why.
 */
export function comparablePeerPe(
  peerPe: number | null | undefined,
  ownMedianPe: number | null | undefined,
  currentPe: number | null | undefined,
  ticker: string,
): { pe: number | null; note: string | null } {
  if (!peerPe || peerPe <= 0) return { pe: null, note: null };
  const ref = ownMedianPe && ownMedianPe > 0 ? ownMedianPe : currentPe && currentPe > 0 ? currentPe : null;
  if (!ref) return { pe: peerPe, note: null };
  const ratio = peerPe / ref;
  if (ratio >= 0.5 && ratio <= 2) return { pe: peerPe, note: null };
  return {
    pe: null,
    note: `Peer comparison left out: the peer group trades at ${peerPe.toFixed(1)}x forward earnings vs ${ref.toFixed(1)}x ${ownMedianPe ? `${ticker}'s usual multiple` : `for ${ticker}`} — likely not comparable businesses. You can change the peers on the Peers tab.`,
  };
}
