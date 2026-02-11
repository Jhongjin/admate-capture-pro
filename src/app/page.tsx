export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-primary)]">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-[var(--color-text-primary)]">
          <span className="text-[var(--color-accent)]">Ad Vision</span>
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          디지털 광고 게재면 캡처 자동화 시스템
        </p>
        <div className="flex gap-2 justify-center mt-6">
          <span className="px-3 py-1 text-xs rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/30">
            MVP v0.1
          </span>
          <span className="px-3 py-1 text-xs rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30">
            Engine Ready
          </span>
        </div>
      </div>
    </main>
  );
}
