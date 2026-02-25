"use client";

import { useState, useCallback, useRef } from "react";

/** 채널 타입 */
type ChannelOption = {
  value: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
};

const CHANNELS: ChannelOption[] = [
  { value: "gdn", label: "GDN", description: "Google Display Network", icon: "🌐", enabled: true },
  { value: "youtube", label: "YouTube", description: "YouTube 광고", icon: "▶️", enabled: false },
  { value: "meta", label: "Meta", description: "Facebook / Instagram", icon: "📘", enabled: false },
  { value: "naver", label: "Naver", description: "네이버 DA", icon: "🇳", enabled: false },
];

/** 게재면 프리셋 */
interface PublisherPreset {
  name: string;
  url: string;
  category: string;
  icon: string;
  adSize: string;
}

const PUBLISHER_PRESETS: PublisherPreset[] = [
  // 종합 뉴스
  { name: "연합뉴스", url: "https://www.yna.co.kr/", category: "뉴스", icon: "📰", adSize: "300x250" },
  { name: "조선일보", url: "https://www.chosun.com/", category: "뉴스", icon: "📰", adSize: "300x250" },
  { name: "중앙일보", url: "https://www.joongang.co.kr/", category: "뉴스", icon: "📰", adSize: "300x250" },
  { name: "동아일보", url: "https://www.donga.com/", category: "뉴스", icon: "📰", adSize: "300x250" },
  { name: "한국경제", url: "https://www.hankyung.com/", category: "경제", icon: "💰", adSize: "300x250" },
  { name: "매일경제", url: "https://www.mk.co.kr/", category: "경제", icon: "💰", adSize: "300x250" },
  // IT/테크
  { name: "ZDNet Korea", url: "https://zdnet.co.kr/", category: "IT", icon: "💻", adSize: "300x250" },
  { name: "블로터", url: "https://www.bloter.net/", category: "IT", icon: "💻", adSize: "300x250" },
  // 커뮤니티/포털
  { name: "SBS 뉴스", url: "https://news.sbs.co.kr/", category: "방송", icon: "📺", adSize: "300x250" },
  { name: "KBS 뉴스", url: "https://news.kbs.co.kr/", category: "방송", icon: "📺", adSize: "300x250" },
];

/** 프리셋 카테고리 목록 */
const PRESET_CATEGORIES = ["전체", ...Array.from(new Set(PUBLISHER_PRESETS.map((p) => p.category)))];

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

/** 파일 크기 포맷 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function CaptureForm({ onCaptureCreated }: CaptureFormProps) {
  const [form, setForm] = useState<CaptureFormData>({
    channel: "gdn",
    publisherUrl: "",
    creativeUrl: "",
    clickUrl: "",
    captureLanding: false,
  });

  // 이미지 업로드 관련 상태
  const [uploadMode, setUploadMode] = useState<"upload" | "url">("upload");
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: number; preview: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 게재면 프리셋 관련 상태
  const [publisherMode, setPublisherMode] = useState<"preset" | "custom">("preset");
  const [presetCategory, setPresetCategory] = useState("전체");
  const [showAllPresets, setShowAllPresets] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  /** 토스트 표시 */
  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /** 파일 업로드 처리 */
  const handleFileUpload = async (file: File) => {
    // 유효성 검증
    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      showToast("error", "PNG, JPG, WebP, GIF 형식만 지원합니다.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast("error", "파일 크기는 10MB 이하여야 합니다.");
      return;
    }

    // 미리보기 생성
    const preview = URL.createObjectURL(file);
    setUploadedFile({ name: file.name, size: file.size, preview });
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "업로드에 실패했습니다.");
      }

      // 업로드 성공 → creativeUrl 설정
      setForm((prev) => ({ ...prev, creativeUrl: result.url }));
      showToast("success", "소재 이미지가 업로드되었습니다!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "업로드 실패";
      showToast("error", msg);
      setUploadedFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  /** 드래그 앤 드롭 핸들러 */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  /** 파일 선택 핸들러 */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  /** 업로드 파일 제거 */
  const removeUploadedFile = () => {
    setUploadedFile(null);
    setForm((prev) => ({ ...prev, creativeUrl: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /** 프리셋 선택 */
  const selectPreset = (preset: PublisherPreset) => {
    setForm((prev) => ({ ...prev, publisherUrl: preset.url }));
  };

  /** 필터링된 프리셋 */
  const filteredPresets = presetCategory === "전체"
    ? PUBLISHER_PRESETS
    : PUBLISHER_PRESETS.filter((p) => p.category === presetCategory);

  const visiblePresets = showAllPresets ? filteredPresets : filteredPresets.slice(0, 4);

  /** 폼 유효성 검증 */
  const isFormValid = form.publisherUrl && form.creativeUrl && isValidUrl(form.publisherUrl) && isValidUrl(form.creativeUrl);

  /** 폼 제출 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) {
      showToast("error", "게재면 URL과 소재를 올바르게 입력해주세요.");
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

      showToast("success", "캡처 요청이 생성되었습니다! 잠시 후 결과를 확인해주세요.");

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
      setUploadedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      showToast("error", errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="glass-card-static p-6 animate-fade-in">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            📸
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">새 캡처 요청</h2>
            <p className="text-xs text-[var(--color-text-muted)]">광고 게재면과 소재를 선택하세요</p>
          </div>
        </div>

        {/* ===== 매체 선택 ===== */}
        <div className="mb-5">
          <label className="form-label">매체 (Channel)</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CHANNELS.map((ch) => (
              <button
                key={ch.value}
                type="button"
                disabled={!ch.enabled}
                onClick={() => setForm((prev) => ({ ...prev, channel: ch.value }))}
                className={`
                  flex flex-col items-center gap-1 p-3 rounded-xl border text-center text-sm
                  transition-all duration-200
                  ${!ch.enabled ? "opacity-30 cursor-not-allowed border-[var(--color-border)]" : "cursor-pointer"}
                  ${form.channel === ch.value && ch.enabled
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                    : ch.enabled
                      ? "border-[var(--color-border)] hover:border-[var(--color-text-muted)] text-[var(--color-text-secondary)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                  }
                `}
              >
                <span className="text-xl">{ch.icon}</span>
                <span className="font-semibold">{ch.label}</span>
                {!ch.enabled && <span className="text-[10px] opacity-70">준비중</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ===== 게재면 URL ===== */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">
              게재면 (Publisher) <span className="text-[var(--color-error)]">*</span>
            </label>
            {/* 모드 전환 탭 */}
            <div className="flex gap-1 bg-[var(--color-bg-primary)] rounded-lg p-0.5 border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setPublisherMode("preset")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  publisherMode === "preset"
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                🏢 프리셋
              </button>
              <button
                type="button"
                onClick={() => setPublisherMode("custom")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  publisherMode === "custom"
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                ✏️ 직접 입력
              </button>
            </div>
          </div>

          {publisherMode === "preset" ? (
            /* 프리셋 모드 */
            <div className="animate-fade-in">
              {/* 카테고리 필터 */}
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {PRESET_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => { setPresetCategory(cat); setShowAllPresets(false); }}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                      presetCategory === cat
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* 프리셋 그리드 */}
              <div className="grid grid-cols-2 gap-2">
                {visiblePresets.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => selectPreset(preset)}
                    className={`
                      flex items-center gap-2.5 p-3 rounded-xl border text-left text-sm
                      transition-all duration-200 cursor-pointer
                      ${form.publisherUrl === preset.url
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                        : "border-[var(--color-border)] hover:border-[var(--color-text-muted)]"
                      }
                    `}
                  >
                    <span className="text-lg flex-shrink-0">{preset.icon}</span>
                    <div className="min-w-0">
                      <p className={`font-semibold text-xs truncate ${
                        form.publisherUrl === preset.url ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"
                      }`}>
                        {preset.name}
                      </p>
                      <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                        {preset.adSize}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {filteredPresets.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllPresets(!showAllPresets)}
                  className="mt-2 w-full text-center text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] py-1"
                >
                  {showAllPresets ? "접기 ▲" : `더 보기 (${filteredPresets.length - 4}개) ▼`}
                </button>
              )}

              {/* 선택된 프리셋 URL 표시 */}
              {form.publisherUrl && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border)]">
                  <p className="text-[11px] text-[var(--color-text-muted)] mb-0.5">선택된 게재면</p>
                  <p className="text-xs text-[var(--color-accent)] truncate">{form.publisherUrl}</p>
                </div>
              )}
            </div>
          ) : (
            /* 직접 입력 모드 */
            <div className="animate-fade-in">
              <input
                type="url"
                className="form-input"
                placeholder="https://www.example.com/article/12345"
                value={form.publisherUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, publisherUrl: e.target.value }))}
                required
              />
              <p className="form-helper">광고가 게재된 뉴스 기사 또는 웹페이지 URL</p>
              {form.publisherUrl && !isValidUrl(form.publisherUrl) && (
                <p className="text-xs text-[var(--color-error)] mt-1">올바른 URL 형식을 입력해주세요</p>
              )}
            </div>
          )}
        </div>

        {/* ===== 소재 이미지 ===== */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">
              소재 이미지 <span className="text-[var(--color-error)]">*</span>
            </label>
            {/* 모드 전환 탭 */}
            <div className="flex gap-1 bg-[var(--color-bg-primary)] rounded-lg p-0.5 border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => setUploadMode("upload")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  uploadMode === "upload"
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                📁 파일 업로드
              </button>
              <button
                type="button"
                onClick={() => setUploadMode("url")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  uploadMode === "url"
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                🔗 URL 입력
              </button>
            </div>
          </div>

          {uploadMode === "upload" ? (
            /* 파일 업로드 모드 */
            <div className="animate-fade-in">
              {!uploadedFile ? (
                /* 드래그&드롭 영역 */
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`
                    relative flex flex-col items-center justify-center gap-3 p-6
                    rounded-xl border-2 border-dashed cursor-pointer
                    transition-all duration-200
                    ${isDragOver
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-text-muted)] bg-[var(--color-bg-primary)]"
                    }
                  `}
                >
                  <div className={`text-3xl ${isDragOver ? "animate-float" : ""}`}>
                    {isDragOver ? "📥" : "🖼️"}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                      {isDragOver ? "여기에 놓으세요!" : "이미지를 드래그하거나 클릭하여 업로드"}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      PNG, JPG, WebP, GIF · 최대 10MB · 300×250 권장
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              ) : (
                /* 업로드 완료 / 업로드 중 */
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] overflow-hidden">
                  {/* 이미지 프리뷰 */}
                  <div className="relative aspect-video bg-[var(--color-bg-secondary)] flex items-center justify-center">
                    <img
                      src={uploadedFile.preview}
                      alt="소재 미리보기"
                      className="max-w-full max-h-full object-contain"
                    />
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                          <div className="spinner spinner-lg" />
                          <p className="text-xs text-white font-medium">업로드 중...</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* 파일 정보 */}
                  <div className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                        {uploadedFile.name}
                      </p>
                      <p className="text-[11px] text-[var(--color-text-muted)]">
                        {formatFileSize(uploadedFile.size)}
                        {!isUploading && form.creativeUrl && (
                          <span className="text-[var(--color-success)] ml-2">✓ 업로드 완료</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={removeUploadedFile}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg
                                 text-[var(--color-text-muted)] hover:text-[var(--color-error)]
                                 hover:bg-[rgba(239,68,68,0.1)] transition-all"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* URL 입력 모드 */
            <div className="animate-fade-in">
              <input
                type="url"
                className="form-input"
                placeholder="https://via.placeholder.com/300x250.png"
                value={form.creativeUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, creativeUrl: e.target.value }))}
                required
              />
              <p className="form-helper">광고 슬롯에 교체할 이미지 URL (300×250 권장)</p>
              {form.creativeUrl && !isValidUrl(form.creativeUrl) && (
                <p className="text-xs text-[var(--color-error)] mt-1">올바른 URL 형식을 입력해주세요</p>
              )}
            </div>
          )}
        </div>

        {/* 구분선 */}
        <div className="border-t border-[var(--color-border)] my-5" />

        {/* ===== 고급 옵션 ===== */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">고급 옵션</p>

          {/* 랜딩 페이지 캡처 토글 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">랜딩 페이지 캡처</p>
              <p className="text-xs text-[var(--color-text-muted)]">광고 클릭 후 이동하는 페이지도 함께 캡처</p>
            </div>
            <div
              className={`toggle-switch ${form.captureLanding ? "active" : ""}`}
              onClick={() => setForm((prev) => ({ ...prev, captureLanding: !prev.captureLanding }))}
              role="switch"
              aria-checked={form.captureLanding}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setForm((prev) => ({ ...prev, captureLanding: !prev.captureLanding }));
                }
              }}
            />
          </div>

          {/* 클릭 URL */}
          {form.captureLanding && (
            <div className="animate-fade-in">
              <label className="form-label" htmlFor="clickUrl">클릭 URL (랜딩 페이지)</label>
              <input
                id="clickUrl"
                type="url"
                className="form-input"
                placeholder="https://landing.example.com"
                value={form.clickUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, clickUrl: e.target.value }))}
              />
              <p className="form-helper">광고 클릭 시 이동할 랜딩 페이지 URL</p>
            </div>
          )}
        </div>

        {/* ===== 제출 버튼 ===== */}
        <div className="mt-6">
          <button
            type="submit"
            className="btn btn-primary btn-lg w-full"
            disabled={!isFormValid || isSubmitting || isUploading}
          >
            {isSubmitting ? (
              <>
                <span className="spinner" />
                캡처 요청 중...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
