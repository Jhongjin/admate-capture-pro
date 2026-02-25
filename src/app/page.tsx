"use client";

import { useState, useCallback } from "react";
import CaptureForm from "./components/CaptureForm";
import CaptureList from "./components/CaptureList";

export default function Home() {
  /** 캡처 생성 시 리스트 갱신을 위한 트리거 */
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  /** 새 캡처가 생성되면 리스트 갱신 */
  const handleCaptureCreated = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] bg-grid relative">
      {/* 배경 그라디언트 */}
      <div className="bg-gradient-radial fixed inset-0 pointer-events-none" />

      {/* 헤더 */}
      <header className="relative z-10 border-b border-[var(--color-border-subtle)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 로고 */}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              AV
            </div>
            <div>
              <h1 className="text-base font-bold text-[var(--color-text-primary)] leading-tight">
                Ad Vision
              </h1>
              <p className="text-[10px] text-[var(--color-text-muted)] leading-tight">
                AdMate Capture Pro
              </p>
            </div>
          </div>

          {/* 상태 뱃지 */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
              Engine Online
            </span>
            <span className="px-3 py-1 text-xs rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20">
              MVP v0.1
            </span>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* 좌측: 캡처 요청 폼 */}
          <div className="lg:col-span-2">
            <CaptureForm onCaptureCreated={handleCaptureCreated} />
          </div>

          {/* 우측: 캡처 이력 리스트 */}
          <div className="lg:col-span-3">
            <CaptureList refreshTrigger={refreshTrigger} />
          </div>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="relative z-10 border-t border-[var(--color-border-subtle)] mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span>© 2026 AdMate Vision</span>
          <span>Powered by Puppeteer + Supabase</span>
        </div>
      </footer>
    </div>
  );
}
