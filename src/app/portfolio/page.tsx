import type { Metadata } from "next";
import PortfolioView from "@/components/PortfolioView";

export const metadata: Metadata = { title: "Your portfolio" };

export default function PortfolioPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pb-16 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your portfolio</h1>
      <p className="mt-1 text-sm text-muted">See what you own as a whole: sectors, where the sales come from, dividend income, risk and who reports next.</p>
      <PortfolioView />
    </main>
  );
}
