/** The Earnings Intel mark: a rising line in a filled circle. Follows the text color (inverts in dark mode). */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <circle cx="16" cy="16" r="16" className="fill-foreground" />
      <path d="M8 20.5 13 15.5 16.5 18.5 24 11" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-background" />
      <circle cx="24" cy="11" r="2.1" className="fill-up" />
    </svg>
  );
}
