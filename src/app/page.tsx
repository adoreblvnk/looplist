export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--canvas)] px-6 py-16 text-[var(--ink)]">
      <section className="mx-auto max-w-3xl border border-[var(--hairline)] bg-[var(--paper)] p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ink-muted)]">LoopList</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Agent-native resale marketplace</h1>
        <p className="mt-4 max-w-2xl text-[var(--ink-muted)]">
          Photo-grounded listing analysis and comparable-based price recommendations are being prepared for the seller experience.
        </p>
      </section>
    </main>
  );
}
