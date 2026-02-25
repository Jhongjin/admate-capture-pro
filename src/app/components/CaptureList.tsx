"use client";

import { useState, useEffect, useCallback } from "react";

/** 캡처 레코드 타입 */
interface CaptureRecord {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  channel: string;
  source_url: string | null;
  creative_url: string;
  placement_image_url: string | null;
  landing_image_url: string | null;
  landing_final_url: string | null;
  error_message: string | null;
  capture_landing: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string;
}

interface CaptureListProps {
  /** 외부에서 추가된 캡처를 받아들이기 위한 트리거 */
  refreshTrigger?: number;
}

/** 상태 라벨 매핑 */
const STATUS_LABELS: Record<string, { label: string; class: string; icon: string }> = {
  pending: { label: "대기중", class: "badge-pending", icon: "⏳" },
  processing: { label: "처리중", class: "badge-processing", icon: "⚙️" },
  completed: { label: "완료", class: "badge-completed", icon: "✅" },
  failed: { label: "실패", class: "badge-failed", icon: "❌" },
};

/** 채널 라벨 */
const CHANNEL_LABELS: Record<string, string> = {
  gdn: "GDN",
  youtube: "YouTube",
  meta: "Meta",
  naver: "Naver",
};

/** 날짜 포맷 */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
}

/** URL 줄임 */
function truncateUrl(url: string, maxLength = 40): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + "…";
}

export default function CaptureList({ refreshTrigger }: CaptureListProps) {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCapture, setSelectedCapture] = useState<CaptureRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  /** 캡처 목록 조회 */
  const fetchCaptures = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }

      const res = await fetch(`/api/captures?${params.toString()}`);
      const result = await res.json();

      if (res.ok && result.data) {
        setCaptures(result.data);
      }
    } catch (err) {
      console.error("[CaptureList] 목록 조회 실패:", err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  /** 초기 로드 + refreshTrigger 변경 시 재조회 */
  useEffect(() => {
    fetchCaptures();
  }, [fetchCaptures, refreshTrigger]);

  /** 처리중인 캡처가 있으면 5초마다 폴링 */
  useEffect(() => {
    const hasActive = captures.some((c) => c.status === "pending" || c.status === "processing");
    if (!hasActive) return;

    const interval = setInterval(fetchCaptures, 5000);
    return () => clearInterval(interval);
  }, [captures, fetchCaptures]);

  /** 필터링된 캡처 목록 */
  const filteredCaptures = captures;

  /** 상태별 카운트 */
  const statusCounts = captures.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      acc.all = (acc.all || 0) + 1;
      return acc;
    },
    { all: 0 } as Record<string, number>
  );

  return (
    <div className="animate-fade-in delay-200">
      {/* 헤더 + 필터 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
            style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
          >
            📋
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">캡처 이력</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              총 {statusCounts.all || 0}건
              {captures.some((c) => c.status === "processing") && (
                <span className="text-[var(--color-accent)] ml-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse mr-1" />
                  실시간 갱신 중
                </span>
              )}
            </p>
          </div>
        </div>

        {/* 상태 필터 탭 */}
        <div className="flex gap-1 bg-[var(--color-bg-primary)] rounded-lg p-1 border border-[var(--color-border)]">
          {[
            { key: "all", label: "전체" },
            { key: "completed", label: "완료" },
            { key: "processing", label: "처리중" },
            { key: "failed", label: "실패" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`
                px-3 py-1.5 rounded-md text-xs font-medium transition-all
                ${statusFilter === tab.key
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }
              `}
            >
              {tab.label}
              {statusCounts[tab.key] ? (
                <span className="ml-1 opacity-70">({statusCounts[tab.key]})</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* 리스트 */}
      <div className="glass-card-static overflow-hidden">
        {isLoading ? (
          /* 스켈레톤 로딩 */
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-[var(--color-bg-primary)]">
                <div className="skeleton w-16 h-16 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                </div>
                <div className="skeleton h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : filteredCaptures.length === 0 ? (
          /* 빈 상태 */
          <div className="empty-state py-16">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <p className="text-base font-medium mb-1">아직 캡처 기록이 없습니다</p>
            <p className="text-sm">위 폼에서 첫 번째 캡처를 요청해보세요!</p>
          </div>
        ) : (
          /* 캡처 리스트 */
          <div className="divide-y divide-[var(--color-border)]">
            {filteredCaptures.map((capture) => {
              const status = STATUS_LABELS[capture.status] || STATUS_LABELS.pending;
              const isActive = capture.status === "processing";

              return (
                <div
                  key={capture.id}
                  onClick={() => setSelectedCapture(capture)}
                  className={`
                    flex items-center gap-4 p-4 cursor-pointer transition-all duration-200
                    hover:bg-[var(--color-bg-elevated)]
                    ${isActive ? "bg-[var(--color-accent-subtle)]" : ""}
                  `}
                >
                  {/* 썸네일 / 상태 아이콘 */}
                  <div className="flex-shrink-0">
                    {capture.status === "completed" && capture.placement_image_url ? (
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                        <img
                          src={capture.placement_image_url}
                          alt="캡처 결과"
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div
                        className={`
                          w-16 h-16 rounded-lg flex items-center justify-center text-2xl
                          border border-[var(--color-border)] bg-[var(--color-bg-primary)]
                          ${isActive ? "animate-pulse" : ""}
                        `}
                      >
                        {status.icon}
                      </div>
                    )}
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                        {CHANNEL_LABELS[capture.channel] || capture.channel}
                      </span>
                      <span className={`badge ${status.class}`}>
                        {isActive && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                        {status.label}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-text-primary)] truncate">
                      {capture.source_url ? truncateUrl(capture.source_url) : "URL 없음"}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {formatDate(capture.created_at)}
                      {capture.metadata && typeof capture.metadata === "object" && "durationMs" in capture.metadata && (
                        <span className="ml-2">
                          ⏱ {Math.round(Number(capture.metadata.durationMs) / 1000)}초
                        </span>
                      )}
                    </p>
                    {capture.status === "failed" && capture.error_message && (
                      <p className="text-xs text-[var(--color-error)] mt-1 truncate">
                        {capture.error_message}
                      </p>
                    )}
                  </div>

                  {/* 화살표 */}
                  <div className="flex-shrink-0 text-[var(--color-text-muted)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {selectedCapture && (
        <CaptureDetailModal
          capture={selectedCapture}
          onClose={() => setSelectedCapture(null)}
        />
      )}
    </div>
  );
}

/** ============================
 * 캡처 상세 모달
 * ============================ */
function CaptureDetailModal({
  capture,
  onClose,
}: {
  capture: CaptureRecord;
  onClose: () => void;
}) {
  const status = STATUS_LABELS[capture.status] || STATUS_LABELS.pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* 오버레이 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* 모달 */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto glass-card-static p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg
                     text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                     hover:bg-[var(--color-bg-tertiary)] transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <span className={`badge ${status.class}`}>
            {status.icon} {status.label}
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
            {CHANNEL_LABELS[capture.channel] || capture.channel}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {formatDate(capture.created_at)}
          </span>
        </div>

        {/* 캡처 결과 이미지 */}
        {capture.status === "completed" && capture.placement_image_url && (
          <div className="mb-6">
            <p className="form-label mb-2">게재면 스크린샷</p>
            <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
              <img
                src={capture.placement_image_url}
                alt="게재면 캡처"
                className="w-full h-auto"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <a
                href={capture.placement_image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-secondary"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                새 탭에서 보기
              </a>
              <a
                href={capture.placement_image_url}
                download
                className="btn btn-sm btn-ghost"
              >
                ⬇️ 다운로드
              </a>
            </div>
          </div>
        )}

        {/* 랜딩 페이지 캡처 */}
        {capture.status === "completed" && capture.landing_image_url && (
          <div className="mb-6">
            <p className="form-label mb-2">랜딩 페이지 스크린샷</p>
            <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
              <img
                src={capture.landing_image_url}
                alt="랜딩 페이지 캡처"
                className="w-full h-auto"
              />
            </div>
            {capture.landing_final_url && (
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                최종 URL: <a href={capture.landing_final_url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline">{capture.landing_final_url}</a>
              </p>
            )}
          </div>
        )}

        {/* 에러 메시지 */}
        {capture.status === "failed" && capture.error_message && (
          <div className="mb-6 p-4 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]">
            <p className="text-sm font-semibold text-[var(--color-error)] mb-1">오류 발생</p>
            <p className="text-sm text-[var(--color-text-secondary)]">{capture.error_message}</p>
          </div>
        )}

        {/* 처리 중 */}
        {(capture.status === "pending" || capture.status === "processing") && (
          <div className="mb-6 flex flex-col items-center py-8">
            <div className="spinner spinner-lg mb-4" />
            <p className="text-sm text-[var(--color-text-secondary)]">
              {capture.status === "pending" ? "캡처 대기 중입니다..." : "캡처를 처리하고 있습니다..."}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">보통 30초~2분 정도 소요됩니다</p>
          </div>
        )}

        {/* 상세 정보 */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <p className="form-label mb-3">상세 정보</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">캡처 ID</span>
              <span className="text-[var(--color-text-secondary)] font-mono text-xs">{capture.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">게재면 URL</span>
              <a
                href={capture.source_url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] hover:underline text-xs max-w-[60%] truncate"
              >
                {capture.source_url || "-"}
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">소재 URL</span>
              <a
                href={capture.creative_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] hover:underline text-xs max-w-[60%] truncate"
              >
                {truncateUrl(capture.creative_url, 35)}
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">랜딩 캡처</span>
              <span className="text-[var(--color-text-secondary)]">{capture.capture_landing ? "예" : "아니오"}</span>
            </div>
            {capture.metadata && typeof capture.metadata === "object" && "durationMs" in capture.metadata && (
              <div className="flex justify-between">
                <span className="text-[var(--color-text-muted)]">소요 시간</span>
                <span className="text-[var(--color-text-secondary)]">
                  {(Number(capture.metadata.durationMs) / 1000).toFixed(1)}초
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
