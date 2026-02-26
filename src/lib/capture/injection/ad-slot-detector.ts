/**
 * Ad Slot Detector v3 — DOM에서 광고 슬롯 탐지 (스마트 필터링)
 *
 * 탐지 전략:
 * 1. Google Ads 태그 (ins.adsbygoogle)
 * 2. Google Ads iframe
 * 3. 일반적인 광고 컨테이너 (class/id에 ad 포함)
 * 4. IAB 표준 사이즈 기반 탐지 (폴백)
 *
 * v3 개선:
 * - 최소 크기 필터 (200x80 미만 제외)
 * - fixed/sticky 포지션 슬롯 감점 (하단 스티키 배너 우선도 낮춤)
 * - 면적 기반 보너스 점수 (큰 슬롯 우선)
 * - 뷰포트 내 가시성 체크
 */

import type { IPageHandle } from "../engine/browser-engine";

export interface DetectedSlot {
  selector: string;
  tagName: string;
  width: number;
  height: number;
  x: number;
  y: number;
  type: "gdn-ins" | "gdn-iframe" | "ad-container" | "size-match" | "custom";
  /** 탐지 신뢰도 + 보너스 (높을수록 우선) */
  confidence: number;
  /** 슬롯이 fixed/sticky인지 */
  isFixed: boolean;
}

/** IAB 표준 광고 사이즈 */
const IAB_STANDARD_SIZES = [
  { w: 300, h: 250, tolerance: 30 },
  { w: 336, h: 280, tolerance: 30 },
  { w: 728, h: 90, tolerance: 30 },
  { w: 970, h: 250, tolerance: 30 },
  { w: 970, h: 90, tolerance: 30 },
  { w: 160, h: 600, tolerance: 30 },
  { w: 120, h: 600, tolerance: 30 },
  { w: 250, h: 250, tolerance: 20 },
];

/** 의미있는 광고 표시를 위한 최소 슬롯 크기 */
const MIN_SLOT_WIDTH = 200;
const MIN_SLOT_HEIGHT = 80;

/**
 * 페이지에서 광고 슬롯을 탐지합니다.
 * 작은 슬롯(320x50 모바일 스티키 등)은 필터링하고
 * 큰 슬롯을 우선 반환합니다.
 */
export async function detectAdSlots(page: IPageHandle): Promise<DetectedSlot[]> {
  const rawSlots = await page.evaluate<DetectedSlot[]>(`
    (() => {
      const results = [];
      const seenElements = new Set();

      function getUniqueSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        let current = el;
        while (current && current !== document.body && current !== document.documentElement) {
          let selector = current.tagName.toLowerCase();
          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            parts.unshift(selector);
            break;
          } else {
            const parent = current.parentElement;
            if (parent) {
              const index = Array.from(parent.children).indexOf(current) + 1;
              selector += ':nth-child(' + index + ')';
            }
          }
          parts.unshift(selector);
          current = current.parentElement;
        }
        return parts.join(' > ');
      }

      function addSlot(el, type, baseConfidence) {
        if (seenElements.has(el)) return;
        seenElements.add(el);
        
        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 20) return;
        
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
        
        const isFixed = style.position === 'fixed' || style.position === 'sticky';
        
        // 면적 기반 보너스 계산
        const area = rect.width * rect.height;
        let areaBonus = 0;
        if (area >= 200 * 200) areaBonus = 30;      // 큰 슬롯 (300x250 이상)
        else if (area >= 600 * 80) areaBonus = 25;   // 리더보드 (728x90 등)
        else if (area >= 200 * 80) areaBonus = 15;   // 중간
        else areaBonus = -20;                         // 작은 슬롯 감점
        
        // fixed/sticky 감점 (하단 스티키 배너는 의미 없음)
        const fixedPenalty = isFixed ? -40 : 0;
        
        // 뷰포트 내 가시성 보너스
        const viewportH = window.innerHeight || 900;
        const isInViewport = rect.top >= 0 && rect.top < viewportH;
        const visibilityBonus = isInViewport ? 10 : -5;
        
        const finalConfidence = baseConfidence + areaBonus + fixedPenalty + visibilityBonus;
        
        results.push({
          selector: getUniqueSelector(el),
          tagName: el.tagName.toLowerCase(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          type: type,
          confidence: finalConfidence,
          isFixed: isFixed,
        });
      }

      // 전략 1: ins.adsbygoogle 태그
      document.querySelectorAll('ins.adsbygoogle').forEach(el => addSlot(el, 'gdn-ins', 100));

      // 전략 2: Google Ads iframe
      document.querySelectorAll('iframe[id*="google_ads"], iframe[id*="aswift_"], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication"]').forEach(el => {
        addSlot(el, 'gdn-iframe', 90);
        if (el.parentElement) addSlot(el.parentElement, 'gdn-iframe', 85);
      });

      // 전략 2.5: 일반 광고 iframe (비-구글, ZDNet/국내 네트워크 등)
      document.querySelectorAll('iframe').forEach(el => {
        if (seenElements.has(el)) return;
        const rect = el.getBoundingClientRect();
        // 배너 크기 iframe만 (200x50 이상, 1200px 이하)
        if (rect.width >= 200 && rect.height >= 50 && rect.width <= 1200 && rect.height <= 700) {
          const src = (el.src || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          const cls = (el.className || '').toLowerCase();
          // 콘텐츠 iframe 제외 (유튜브/비메오/네이버TV 등)
          const isContent = src.includes('youtube.com') || src.includes('vimeo.com') || 
                           src.includes('tv.naver.com') || src.includes('play.naver.com');
          if (!isContent) {
            // 광고 관련 힌트가 있으면 높은 점수
            const hasAdHint = src.includes('ad') || src.includes('banner') || src.includes('mobon') || 
                             src.includes('cauly') || src.includes('dable') || src.includes('criteo') ||
                             id.includes('ad') || cls.includes('ad') || cls.includes('banner');
            addSlot(el, 'ad-container', hasAdHint ? 80 : 60);
            if (el.parentElement && !seenElements.has(el.parentElement)) {
              addSlot(el.parentElement, 'ad-container', hasAdHint ? 75 : 55);
            }
          }
        }
      });

      // 전략 3: 광고 관련 클래스/ID를 가진 컨테이너
      const adSelectors = [
        '[class*="ad-slot"]', '[class*="adSlot"]', '[class*="ad_slot"]',
        '[class*="ad-banner"]', '[class*="adBanner"]', '[class*="ad_banner"]',
        '[class*="ad-container"]', '[class*="adContainer"]', '[class*="ad_container"]',
        '[class*="ad-wrapper"]', '[class*="adWrapper"]', '[class*="ad_wrapper"]',
        '[class*="ad-box"]', '[class*="adBox"]', '[class*="ad_box"]',
        '[class*="advertisement"]', '[class*="google-ad"]',
        '[id*="ad-slot"]', '[id*="ad_slot"]', '[id*="adSlot"]',
        '[id*="ad-banner"]', '[id*="ad_banner"]', '[id*="adBanner"]',
        '[id*="ad-container"]', '[id*="ad_container"]',
        '[id*="advertisement"]',
        '[data-ad]', '[data-ad-slot]', '[data-ad-unit]',
        '[data-google-query-id]',
        '[class*="banner"]', '[id*="banner"]',
        '.ads_area', '.ad_area', '#ad_area',
        '.ads-area', '.ad-area', '#ad-area',
        // Google DFP/GAM 광고
        '[id*="div-gpt-ad"]',
        // 국내 광고 네트워크 (ZDNet, 블로터 등)
        '[class*="zc-banner"]', '[class*="zdk"]',
        '[class*="mobon"]', '[class*="cauly"]', '[class*="dable"]',
        '[class*="ad_content"]', '[class*="adContent"]',
        '[class*="sponsor"]', '[id*="sponsor"]',
        '[class*="commercial"]', '[id*="commercial"]',
      ];
      
      adSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => addSlot(el, 'ad-container', 70));
        } catch(e) {}
      });

      // 전략 4: IAB 표준 사이즈에 가까운 요소
      const standardSizes = ${JSON.stringify(IAB_STANDARD_SIZES)};
      
      document.querySelectorAll('div, section, aside, figure').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 30) return;

        for (const std of standardSizes) {
          const wMatch = Math.abs(rect.width - std.w) <= std.tolerance;
          const hMatch = Math.abs(rect.height - std.h) <= std.tolerance;

          if (wMatch && hMatch) {
            if (seenElements.has(el)) return;
            const images = el.querySelectorAll('img, iframe, canvas');
            const textLength = (el.textContent || '').trim().length;
            if (images.length > 0 && textLength < 200) {
              addSlot(el, 'size-match', 50);
            }
            break;
          }
        }
      });

      // confidence 내림차순 정렬
      results.sort((a, b) => b.confidence - a.confidence);

      return results;
    })()
  `);

  // 서버 측 필터: 최소 크기 미달 슬롯 제거
  const filteredSlots = rawSlots.filter(s => 
    s.width >= MIN_SLOT_WIDTH && s.height >= MIN_SLOT_HEIGHT
  );

  console.log(`[AdSlotDetector] 원본 ${rawSlots.length}개 → 필터 후 ${filteredSlots.length}개 슬롯:`);
  filteredSlots.forEach((s, i) => {
    console.log(`  [${i}] ${s.type} ${s.width}x${s.height} conf:${s.confidence} fixed:${s.isFixed}`);
  });

  // 필터 후 0개인 경우 원본에서 가장 큰 슬롯 최소 1개 반환
  if (filteredSlots.length === 0 && rawSlots.length > 0) {
    const largest = rawSlots.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    console.log(`[AdSlotDetector] 필터 후 0개 → 최대 면적 슬롯 사용: ${largest.width}x${largest.height}`);
    return [largest];
  }

  return filteredSlots;
}
