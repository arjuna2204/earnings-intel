/** Content that exists only in Pro mode. In Simple mode a one-line note says where it went. */
export default function ProGate({ what, children }: { what: string; children: React.ReactNode }) {
  return (
    <>
      <p className="simple-only rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
        {what} is in <b className="text-foreground">Pro</b> mode. Switch with the Simple / Pro toggle at the top right.
      </p>
      <div className="pro-only">{children}</div>
    </>
  );
}
