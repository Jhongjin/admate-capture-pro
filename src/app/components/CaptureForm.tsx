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
  adSizes: string[];
  description: string;
}

const PUBLISHER_PRESETS: PublisherPreset[] = [
  // 종합 뉴스
  { name: "연합뉴스", url: "https://www.yna.co.kr/", category: "뉴스", icon: "📰", adSizes: ["300x250", "728x90"], description: "국내 대표 통신사" },
  { name: "조선일보", url: "https://www.chosun.com/", category: "뉴스", icon: "📰", adSizes: ["300x250", "970x250"], description: "종합일간지" },
  { name: "중앙일보", url: "https://www.joongang.co.kr/", category: "뉴스", icon: "📰", adSizes: ["300x250", "728x90"], description: "종합일간지" },
  { name: "동아일보", url: "https://www.donga.com/", category: "뉴스", icon: "📰", adSizes: ["300x250", "728x90"], description: "종합일간지" },
  { name: "한국경제", url: "https://www.hankyung.com/", category: "경제", icon: "💰", adSizes: ["300x250", "970x90"], description: "경제전문지" },
  { name: "매일경제", url: "https://www.mk.co.kr/", category: "경제", icon: "💰", adSizes: ["300x250", "728x90"], description: "경제전문지" },
  // IT/테크
  { name: "ZDNet Korea", url: "https://zdnet.co.kr/", category: "IT", icon: "💻", adSizes: ["300x250", "728x90"], description: "IT전문 미디어" },
  { name: "블로터", url: "https://www.bloter.net/", category: "IT", icon: "💻", adSizes: ["300x250"], description: "테크 미디어" },
  // 방송
  { name: "SBS 뉴스", url: "https://news.sbs.co.kr/", category: "방송", icon: "📺", adSizes: ["300x250", "728x90"], description: "SBS 뉴스 포털" },
  { name: "KBS 뉴스", url: "https://news.kbs.co.kr/", category: "방송", icon: "📺", adSizes: ["300x250", "728x90"], description: "KBS 뉴스 포털" },
];

/** 프리셋 카테고리 목록 */
const PRESET_CATEGORIES = ["전체", ...Array.from(new Set(PUBLISHER_PRESETS.map((p) => p.category)))];

/** GDN 광고 사이즈 가이드 */
interface AdSizeInfo {
  size: string;
  width: number;
  height: number;
  name: string;
  usage: string;
  popularity: "높음" | "보통" | "낮음";
}

const GDN_AD_SIZES: AdSizeInfo[] = [
  { size: "300×250", width: 300, height: 250, name: "미디엄 렉탱글", usage: "기사 본문 사이드바", popularity: "높음" },
  { size: "728×90", width: 728, height: 90, name: "리더보드", usage: "페이지 상단/하단", popularity: "높음" },
  { size: "970×250", width: 970, height: 250, name: "빌보드", usage: "페이지 최상단", popularity: "보통" },
  { size: "160×600", width: 160, height: 600, name: "와이드 스카이스크래퍼", usage: "사이드바 세로", popularity: "보통" },
  { size: "320×100", width: 320, height: 100, name: "모바일 배너", usage: "모바일 상단/하단", popularity: "높음" },
  { size: "336×280", width: 336, height: 280, name: "라지 렉탱글", usage: "기사 본문 중간", popularity: "보통" },
];

/** 인젝션 모드 */
type InjectionMode = "single" | "all" | "custom";
interface InjectionModeOption {
  value: InjectionMode;
  label: string;
  icon: string;
  description: string;
}

const INJECTION_MODES: InjectionModeOption[] = [
  { value: "single", label: "최상위 1개", icon: "🎯", description: "가장 좋은 위치의 슬롯 1개만 교체" },
  { value: "all", label: "전체 슬롯", icon: "🔥", description: "탐지된 모든 광고 슬롯에 소재 교체" },
  { value: "custom", label: "직접 지정", icon: "⚙️", description: "원하는 슬롯 개수를 직접 선택" },
];

/** 폼 데이터 타입 */
interface CaptureFormData {
  channel: string;
  selectedPublishers: string[];  // 멀티 사이트 URL 배열
  creativeUrl: string;
  clickUrl: string;
  captureLanding: boolean;
  injectionMode: InjectionMode;
  slotCount: number;
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
    selectedPublishers: [],
    creativeUrl: "",
    clickUrl: "",
    captureLanding: false,
    injectionMode: "single",
    slotCount: 2,
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
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

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

  /** 프리셋 토글 (멀티 선택) */
  const togglePreset = (preset: PublisherPreset) => {
    setForm((prev) => {
      const isSelected = prev.selectedPublishers.includes(preset.url);
      return {
        ...prev,
        selectedPublishers: isSelected
          ? prev.selectedPublishers.filter((u) => u !== preset.url)
          : [...prev.selectedPublishers, preset.url],
      };
    });
  };

  /** 커스텀 URL 추가 */
  const addCustomUrl = () => {
    if (customUrl && isValidUrl(customUrl) && !form.selectedPublishers.includes(customUrl)) {
      setForm((prev) => ({
        ...prev,
        selectedPublishers: [...prev.selectedPublishers, customUrl],
      }));
      setCustomUrl("");
    }
  };

  /** 선택된 게재면 제거 */
  const removePublisher = (url: string) => {
    setForm((prev) => ({
      ...prev,
      selectedPublishers: prev.selectedPublishers.filter((u) => u !== url),
    }));
  };

  /** 프리셋 이름 찾기 */
  const getPresetName = (url: string): string => {
    const preset = PUBLISHER_PRESETS.find((p) => p.url === url);
    return preset ? preset.name : new URL(url).hostname;
  };

  /** 필터링된 프리셋 */
  const filteredPresets = presetCategory === "전체"
    ? PUBLISHER_PRESETS
    : PUBLISHER_PRESETS.filter((p) => p.category === presetCategory);

  const visiblePresets = showAllPresets ? filteredPresets : filteredPresets.slice(0, 6);

  /** 폼 유효성 검증 */
  const isFormValid = form.selectedPublishers.length > 0 && form.creativeUrl && isValidUrl(form.creativeUrl);

  /** 폼 제출 */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isFormValid) {
      showToast("error", "게재면과 소재를 올바르게 선택해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: form.channel,
          publisherUrls: form.selectedPublishers,
          creativeUrl: form.creativeUrl,
          clickUrl: form.clickUrl || undefined,
          captureLanding: form.captureLanding,
          injectionMode: form.injectionMode,
          slotCount: form.slotCount,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "캡처 요청에 실패했습니다.");
      }

      const siteCount = result.count || 1;
      showToast("success", `${siteCount}개 사이트 캡처 요청이 생성되었습니다!`);

      if (onCaptureCreated && result.data) {
        onCaptureCreated(result.data);
      }

      // 폼 초기화
      setForm((prev) => ({
        ...prev,
        selectedPublishers: [],
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
            <h2 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>새 캡처 요청</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>광고 게재면과 소재를 선택하세요</p>
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
                className="flex flex-col items-center gap-1 p-3 rounded-xl border text-center text-sm transition-all duration-200"
                style={{
                  opacity: !ch.enabled ? 0.3 : 1,
                  cursor: !ch.enabled ? "not-allowed" : "pointer",
                  borderColor: form.channel === ch.value && ch.enabled ? "var(--color-accent)" : "var(--color-border)",
                  backgroundColor: form.channel === ch.value && ch.enabled ? "var(--color-accent-subtle)" : "transparent",
                  color: form.channel === ch.value && ch.enabled ? "var(--color-accent)" : "var(--color-text-secondary)",
                }}
              >
                <span className="text-xl">{ch.icon}</span>
                <span className="font-semibold">{ch.label}</span>
                {!ch.enabled && <span className="text-[10px] opacity-70">준비중</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ===== 게재면 URL (멀티 선택) ===== */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">
              게재면 (Publisher) <span style={{ color: "var(--color-error)" }}>*</span>
              {form.selectedPublishers.length > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: "var(--color-accent)", color: "white" }}>
                  {form.selectedPublishers.length}개 선택
                </span>
              )}
            </label>
            {/* 모드 전환 탭 */}
            <div className="flex gap-1 rounded-lg p-0.5 border"
              style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)" }}>
              <button
                type="button"
                onClick={() => setPublisherMode("preset")}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: publisherMode === "preset" ? "var(--color-accent)" : "transparent",
                  color: publisherMode === "preset" ? "white" : "var(--color-text-muted)",
                }}
              >
                🏢 프리셋
              </button>
              <button
                type="button"
                onClick={() => setPublisherMode("custom")}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: publisherMode === "custom" ? "var(--color-accent)" : "transparent",
                  color: publisherMode === "custom" ? "white" : "var(--color-text-muted)",
                }}
              >
                ✏️ 직접 입력
              </button>
            </div>
          </div>

          {publisherMode === "preset" ? (
            /* 프리셋 모드 (멀티 선택) */
            <div className="animate-fade-in">
              {/* 카테고리 필터 */}
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {PRESET_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => { setPresetCategory(cat); setShowAllPresets(false); }}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border"
                    style={{
                      borderColor: presetCategory === cat ? "var(--color-accent)" : "var(--color-border)",
                      backgroundColor: presetCategory === cat ? "var(--color-accent-subtle)" : "transparent",
                      color: presetCategory === cat ? "var(--color-accent)" : "var(--color-text-muted)",
                    }}
                  >
                    {cat}
                  </button>
                ))}
                {/* 전체선택/해제 */}
                <button
                  type="button"
                  onClick={() => {
                    const allUrls = filteredPresets.map((p) => p.url);
                    const allSelected = allUrls.every((u) => form.selectedPublishers.includes(u));
                    setForm((prev) => ({
                      ...prev,
                      selectedPublishers: allSelected
                        ? prev.selectedPublishers.filter((u) => !allUrls.includes(u))
                        : [...new Set([...prev.selectedPublishers, ...allUrls])],
                    }));
                  }}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ml-auto"
                  style={{ borderColor: "var(--color-accent)", color: "var(--color-accent)" }}
                >
                  {filteredPresets.every((p) => form.selectedPublishers.includes(p.url)) ? "✓ 전체 해제" : "☐ 전체 선택"}
                </button>
              </div>

              {/* 프리셋 그리드 (체크박스 토글) */}
              <div className="grid grid-cols-2 gap-2">
                {visiblePresets.map((preset) => {
                  const isSelected = form.selectedPublishers.includes(preset.url);
                  return (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => togglePreset(preset)}
                      className="flex items-center gap-2.5 p-3 rounded-xl border text-left text-sm transition-all duration-200 cursor-pointer"
                      style={{
                        borderColor: isSelected ? "var(--color-accent)" : "var(--color-border)",
                        backgroundColor: isSelected ? "var(--color-accent-subtle)" : "transparent",
                      }}
                    >
                      {/* 체크박스 */}
                      <div className="shrink-0 w-5 h-5 rounded flex items-center justify-center border-2 transition-all"
                        style={{
                          borderColor: isSelected ? "var(--color-accent)" : "var(--color-border)",
                          backgroundColor: isSelected ? "var(--color-accent)" : "transparent",
                        }}>
                        {isSelected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <span className="text-lg shrink-0">{preset.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-xs truncate"
                          style={{ color: isSelected ? "var(--color-accent)" : "var(--color-text-primary)" }}>
                          {preset.name}
                        </p>
                        <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                          {preset.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {preset.adSizes.map((s) => (
                            <span key={s} className="text-[9px] px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)" }}>
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {filteredPresets.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllPresets(!showAllPresets)}
                  className="mt-2 w-full text-center text-xs py-1"
                  style={{ color: "var(--color-accent)" }}
                >
                  {showAllPresets ? "접기 ▲" : `더 보기 (${filteredPresets.length - 6}개) ▼`}
                </button>
              )}
            </div>
          ) : (
            /* 직접 입력 모드 */
            <div className="animate-fade-in">
              <div className="flex gap-2">
                <input
                  type="url"
                  className="form-input flex-1"
                  placeholder="https://www.example.com/article/12345"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomUrl(); } }}
                />
                <button
                  type="button"
                  onClick={addCustomUrl}
                  disabled={!customUrl || !isValidUrl(customUrl)}
                  className="btn btn-primary px-4 text-sm shrink-0"
                  style={{ opacity: !customUrl || !isValidUrl(customUrl) ? 0.5 : 1 }}
                >
                  + 추가
                </button>
              </div>
              <p className="form-helper">URL을 입력 후 추가 버튼으로 여러 사이트를 등록하세요</p>
              {customUrl && !isValidUrl(customUrl) && (
                <p className="text-xs mt-1" style={{ color: "var(--color-error)" }}>올바른 URL 형식을 입력해주세요</p>
              )}
            </div>
          )}

          {/* 선택된 게재면 목록 */}
          {form.selectedPublishers.length > 0 && (
            <div className="mt-3 px-3 py-2.5 rounded-lg border"
              style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)" }}>
              <p className="text-[11px] mb-2 font-semibold" style={{ color: "var(--color-text-muted)" }}>
                📋 선택된 게재면 ({form.selectedPublishers.length}개)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {form.selectedPublishers.map((url) => (
                  <span key={url} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border"
                    style={{ borderColor: "var(--color-accent)", backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>
                    {getPresetName(url)}
                    <button type="button" onClick={() => removePublisher(url)}
                      className="ml-0.5 hover:opacity-70 transition-opacity" aria-label="제거">
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== 소재 이미지 ===== */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">
              소재 이미지 <span style={{ color: "var(--color-error)" }}>*</span>
            </label>
            {/* 모드 전환 탭 */}
            <div className="flex gap-1 rounded-lg p-0.5 border"
              style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)" }}>
              <button
                type="button"
                onClick={() => setUploadMode("upload")}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: uploadMode === "upload" ? "var(--color-accent)" : "transparent",
                  color: uploadMode === "upload" ? "white" : "var(--color-text-muted)",
                }}
              >
                📁 파일 업로드
              </button>
              <button
                type="button"
                onClick={() => setUploadMode("url")}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
                style={{
                  backgroundColor: uploadMode === "url" ? "var(--color-accent)" : "transparent",
                  color: uploadMode === "url" ? "white" : "var(--color-text-muted)",
                }}
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
                  className="relative flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200"
                  style={{
                    borderColor: isDragOver ? "var(--color-accent)" : "var(--color-border)",
                    backgroundColor: isDragOver ? "var(--color-accent-subtle)" : "var(--color-bg-primary)",
                  }}
                >
                  <div className={`text-3xl ${isDragOver ? "animate-float" : ""}`}>
                    {isDragOver ? "📥" : "🖼️"}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                      {isDragOver ? "여기에 놓으세요!" : "이미지를 드래그하거나 클릭하여 업로드"}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                      PNG, JPG, WebP, GIF · 최대 10MB
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--color-accent)" }}>
                      💡 어떤 사이즈든 광고 슬롯에 자동 맞춤됩니다
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
                <div className="rounded-xl border overflow-hidden"
                  style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-primary)" }}>
                  {/* 이미지 프리뷰 */}
                  <div className="relative aspect-video flex items-center justify-center"
                    style={{ backgroundColor: "var(--color-bg-secondary)" }}>
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
                      <p className="text-xs font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
                        {uploadedFile.name}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {formatFileSize(uploadedFile.size)}
                        {!isUploading && form.creativeUrl && (
                          <span className="ml-2" style={{ color: "var(--color-success)" }}>✓ 업로드 완료</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={removeUploadedFile}
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                      style={{ color: "var(--color-text-muted)" }}
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
                <p className="text-xs mt-1" style={{ color: "var(--color-error)" }}>올바른 URL 형식을 입력해주세요</p>
              )}
            </div>
          )}

          {/* 사이즈 가이드 토글 */}
          <button
            type="button"
            onClick={() => setShowSizeGuide(!showSizeGuide)}
            className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-all duration-200"
            style={{
              color: "var(--color-text-muted)",
              borderColor: "var(--color-border)",
            }}
          >
            📐 GDN 광고 사이즈 가이드
            <span className="text-[10px]">{showSizeGuide ? "▲" : "▼"}</span>
          </button>

          {/* 사이즈 가이드 패널 */}
          {showSizeGuide && (
            <div className="mt-2 rounded-xl border p-4 animate-fade-in"
              style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-primary)" }}>
              <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg"
                style={{ backgroundColor: "var(--color-accent-subtle)" }}>
                <span className="text-sm mt-0.5">✨</span>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--color-accent)" }}>자동 사이즈 매핑</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                    어떤 크기의 이미지를 업로드하더라도, 게재면의 광고 슬롯 크기에 맞게 <strong>자동으로 리사이즈</strong>됩니다.
                    단, 원본과 슬롯의 비율이 크게 다르면 이미지 일부가 잘릴 수 있어요.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                {GDN_AD_SIZES.map((ad) => (
                  <div key={ad.size} className="flex items-center gap-3 p-2 rounded-lg transition-colors"
                    style={{ backgroundColor: "transparent" }}>
                    <div className="shrink-0 w-10 h-10 flex items-center justify-center">
                      <div className="rounded-sm"
                        style={{
                          width: Math.min(40, ad.width / (Math.max(ad.width, ad.height) / 40)),
                          height: Math.min(40, ad.height / (Math.max(ad.width, ad.height) / 40)),
                          border: "1px solid var(--color-accent)",
                          backgroundColor: "var(--color-accent-subtle)",
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: "var(--color-text-primary)" }}>{ad.size}</span>
                        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{ad.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium border"
                          style={{
                            backgroundColor: ad.popularity === "높음" ? "rgba(34,197,94,0.1)" : "var(--color-bg-tertiary)",
                            color: ad.popularity === "높음" ? "var(--color-success)" : "var(--color-text-muted)",
                            borderColor: ad.popularity === "높음" ? "rgba(34,197,94,0.2)" : "var(--color-border)",
                          }}>
                          {ad.popularity === "높음" ? "🔥 인기" : ad.popularity}
                        </span>
                      </div>
                      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{ad.usage}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 구분선 */}
        <div className="my-5" style={{ borderTop: "1px solid var(--color-border)" }} />

        {/* ===== 고급 옵션 ===== */}
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>고급 옵션</p>

          {/* 인젝션 모드 선택 */}
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>
              🎯 광고 슬롯 교체 방식
            </p>
            <div className="grid grid-cols-3 gap-2">
              {INJECTION_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, injectionMode: mode.value }))}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all duration-200"
                  style={{
                    borderColor: form.injectionMode === mode.value ? "var(--color-accent)" : "var(--color-border)",
                    backgroundColor: form.injectionMode === mode.value ? "var(--color-accent-subtle)" : "transparent",
                  }}
                >
                  <span className="text-lg">{mode.icon}</span>
                  <span className="text-xs font-semibold"
                    style={{ color: form.injectionMode === mode.value ? "var(--color-accent)" : "var(--color-text-primary)" }}>
                    {mode.label}
                  </span>
                  <span className="text-[10px] leading-tight"
                    style={{ color: "var(--color-text-muted)" }}>
                    {mode.description}
                  </span>
                </button>
              ))}
            </div>

            {/* 직접 지정 슬롯 수 */}
            {form.injectionMode === "custom" && (
              <div className="mt-3 flex items-center gap-3 animate-fade-in">
                <label className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                  교체할 슬롯 수:
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setForm((prev) => ({ ...prev, slotCount: Math.max(1, prev.slotCount - 1) }))}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center text-sm font-bold transition-all"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-bold" style={{ color: "var(--color-accent)" }}>
                    {form.slotCount}
                  </span>
                  <button type="button" onClick={() => setForm((prev) => ({ ...prev, slotCount: Math.min(10, prev.slotCount + 1) }))}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center text-sm font-bold transition-all"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                    +
                  </button>
                </div>
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>개 (1~10)</span>
              </div>
            )}
          </div>

          {/* 랜딩 페이지 캡처 토글 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>랜딩 페이지 캡처</p>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>광고 클릭 후 이동하는 페이지도 함께 캡처</p>
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
                {form.selectedPublishers.length > 1
                  ? `${form.selectedPublishers.length}개 사이트 캡처 시작`
                  : "캡처 요청 시작"}
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
