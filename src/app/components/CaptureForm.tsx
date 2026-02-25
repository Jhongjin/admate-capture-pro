"use client";

import { useState, useCallback } from "react";

/** 채널 타입 */
type ChannelOption = {
  value: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
};

const CHANNELS: ChannelOption[] = [
  {
    value: "gdn",
    label: "GDN",
    description: "Google Display Network",
    icon: "🌐",
    enabled: true,
  },
  {
    value: "youtube",
    label: "YouTube",
    description: "YouTube 광고",
    icon: "▶️",
    enabled: false,
  },
  {
    value: "meta",
    label: "Meta",
    description: "Facebook / Instagram",
    icon: "📘",
    enabled: false,
  },
  {
    value: "naver",
    label: "Naver",
    description: "네이버 DA",
    icon: "🇳",
    enabled: false,
  },
];

/** 폼 데이터 타입 */
interface CaptureFormData {
  channel: string;
  publisherUrl: string;
  creativeUrl: string;
  clickUrl: string;
  captureLanding: boolean;
}

/** 캡처 결과 타입 */
export interface CaptureResult {
  id: string;
  status: string;
  channel: string;
  source_url: string;
  creative_url: string;
  capture_landing: boolean;
  created_at: string;
}

interface CaptureFormProps {
  onCaptureCreated?: (capture: CaptureResult) => void;
}

/** URL 유효성 검사 */
function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function CaptureForm({ onCaptureCreated }: CaptureFormProps) {
  const [form, setForm] = useState<CaptureFormData>({
    channel: "gdn",
    publisherUrl: "",
    creativeUrl: "",
    clickUrl: "",
    captureLanding: false,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  /** 토스트 표시 */
  const showToast = useCallback(
    (type: "success" | "error" | "info", message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 4000);
    },
    [],
  );

  /** 폼 유효성 검증 */
  const isFormValid =
    form.publisherUrl &&
    form.creativeUrl &&
    isValidUrl(form.publisherUrl) &&
    isValidUrl(form.creativeUrl);

  /** 폼 제출 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) {
      showToast("error", "게재면 URL과 소재 URL을 올바르게 입력해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: form.channel,
          publisherUrl: form.publisherUrl,
          creativeUrl: form.creativeUrl,
          clickUrl: form.clickUrl || undefined,
          captureLanding: form.captureLanding,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "캡처 요청에 실패했습니다.");
      }

      showToast(
        "success",
        "캡처 요청이 생성되었습니다! 잠시 후 결과를 확인해주세요.",
      );

      // 콜백 호출
      if (onCaptureCreated && result.data) {
        onCaptureCreated(result.data);
      }

      // 폼 초기화
      setForm((prev) => ({
        ...prev,
        publisherUrl: "",
        creativeUrl: "",
        clickUrl: "",
        captureLanding: false,
      }));
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      showToast("error", errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="glass-card-static p-6 animate-fade-in"
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            📸
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              새 캡처 요청
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              광고 게재면 URL과 소재를 입력하세요
            </p>
          </div>
        </div>

        {/* 매체 선택 */}
        <div className="mb-5">
          <label className="form-label">매체 (Channel)</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CHANNELS.map((ch) => (
              <button
                key={ch.value}
                type="button"
                disabled={!ch.enabled}
                onClick={() =>
                  setForm((prev) => ({ ...prev, channel: ch.value }))
                }
                className={`
                  flex flex-col items-center gap-1 p-3 rounded-xl border text-center text-sm
                  transition-all duration-200
                  ${!ch.enabled ? "opacity-30 cursor-not-allowed border-[var(--color-border)]" : "cursor-pointer"}
                  ${
                    form.channel === ch.value && ch.enabled
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                      : ch.enabled
                        ? "border-[var(--color-border)] hover:border-[var(--color-text-muted)] text-[var(--color-text-secondary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                  }
                `}
              >
                <span className="text-xl">{ch.icon}</span>
                <span className="font-semibold">{ch.label}</span>
                {!ch.enabled && (
                  <span className="text-[10px] opacity-70">준비중</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 게재면 URL */}
        <div className="mb-4">
          <label className="form-label" htmlFor="publisherUrl">
            게재면 URL <span className="text-[var(--color-error)]">*</span>
          </label>
          <input
            id="publisherUrl"
            type="url"
            className="form-input"
            placeholder="https://www.example.com/article/12345"
            value={form.publisherUrl}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, publisherUrl: e.target.value }))
            }
            required
          />
          <p className="form-helper">
            광고가 게재된 뉴스 기사 또는 웹페이지 URL
          </p>
          {form.publisherUrl && !isValidUrl(form.publisherUrl) && (
            <p className="text-xs text-[var(--color-error)] mt-1">
              올바른 URL 형식을 입력해주세요 (https://...)
            </p>
          )}
        </div>

        {/* 소재 이미지 URL */}
        <div className="mb-4">
          <label className="form-label" htmlFor="creativeUrl">
            소재 이미지 URL <span className="text-[var(--color-error)]">*</span>
          </label>
          <input
            id="creativeUrl"
            type="url"
            className="form-input"
            placeholder="https://via.placeholder.com/300x250.png"
            value={form.creativeUrl}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, creativeUrl: e.target.value }))
            }
            required
          />
          <p className="form-helper">
            광고 슬롯에 교체할 이미지 URL (300x250 권장)
          </p>
          {form.creativeUrl && !isValidUrl(form.creativeUrl) && (
            <p className="text-xs text-[var(--color-error)] mt-1">
              올바른 URL 형식을 입력해주세요 (https://...)
            </p>
          )}
        </div>

        {/* 구분선 */}
        <div className="border-t border-[var(--color-border)] my-5" />

        {/* 고급 옵션 */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            고급 옵션
          </p>

          {/* 랜딩 페이지 캡처 토글 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                랜딩 페이지 캡처
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                광고 클릭 후 이동하는 페이지도 함께 캡처
              </p>
            </div>
            <div
              className={`toggle-switch ${form.captureLanding ? "active" : ""}`}
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  captureLanding: !prev.captureLanding,
                }))
              }
              role="switch"
              aria-checked={form.captureLanding}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setForm((prev) => ({
                    ...prev,
                    captureLanding: !prev.captureLanding,
                  }));
                }
              }}
            />
          </div>

          {/* 클릭 URL (랜딩 캡처 활성화 시) */}
          {form.captureLanding && (
            <div className="animate-fade-in">
              <label className="form-label" htmlFor="clickUrl">
                클릭 URL (랜딩 페이지)
              </label>
              <input
                id="clickUrl"
                type="url"
                className="form-input"
                placeholder="https://landing.example.com"
                value={form.clickUrl}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, clickUrl: e.target.value }))
                }
              />
              <p className="form-helper">광고 클릭 시 이동할 랜딩 페이지 URL</p>
            </div>
          )}
        </div>

        {/* 제출 버튼 */}
        <div className="mt-6">
          <button
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="spinner" />
                캡처 요청 중...
              </>
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                캡처 요청 시작
              </>
            )}
          </button>
        </div>
      </form>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === "success" && "✅ "}
          {toast.type === "error" && "❌ "}
          {toast.type === "info" && "ℹ️ "}
          {toast.message}
        </div>
      )}
    </>
  );
}
