/**
 * Ad Slot Detector — DOM에서 광고 슬롯 탐지 (v2 — 강화된 탐지)
 *
 * GDN 광고 슬롯을 다양한 전략으로 탐지합니다:
 * 1. Google Ads 태그 (ins.adsbygoogle)
 * 2. Google Ads iframe (google_ads_*, aswift_*, doubleclick.net)
 * 3. 일반적인 광고 컨테이너 (class/id에 ad 포함)
 * 4. IAB 표준 사이즈 기반 탐지 (폴백)
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
  /** 탐지 신뢰도 (높을수록 광고 슬롯일 확률 높음) */
  confidence: number;
}

/** IAB 표준 광고 사이즈 (허용 범위 포함) */
const IAB_STANDARD_SIZES = [
  { w: 300, h: 250, tolerance: 30 },
  { w: 336, h: 280, tolerance: 30 },
  { w: 728, h: 90, tolerance: 30 },
  { w: 970, h: 250, tolerance: 30 },
  { w: 970, h: 90, tolerance: 30 },
  { w: 160, h: 600, tolerance: 30 },
  { w: 120, h: 600, tolerance: 30 },
  { w: 320, h: 100, tolerance: 20 },
  { w: 320, h: 50, tolerance: 20 },
  { w: 250, h: 250, tolerance: 20 },
];

/**
 * 페이지에서 광고 슬롯을 탐지합니다.
 * @param page - 브라우저 페이지 핸들
 * @returns 탐지된 광고 슬롯 배열 (confidence 내림차순)
 */
export async function detectAdSlots(page: IPageHandle): Promise<DetectedSlot[]> {
  const slots = await page.evaluate<DetectedSlot[]>(`
    (() => {
      const results = [];
      const seenElements = new Set();

      function getUniqueSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        
        // nth-child 기반 고유 셀렉터 생성
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

      function addSlot(el, type, confidence) {
        if (seenElements.has(el)) return;
        seenElements.add(el);
        
        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 20) return;
        
        // 화면에 보이는 영역만
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
        
        results.push({
          selector: getUniqueSelector(el),
          tagName: el.tagName.toLowerCase(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          type: type,
          confidence: confidence
        });
      }

      // 전략 1: ins.adsbygoogle 태그 (최고 신뢰도)
      document.querySelectorAll('ins.adsbygoogle').forEach(el => addSlot(el, 'gdn-ins', 100));

      // 전략 2: Google Ads iframe
      document.querySelectorAll('iframe[id*="google_ads"], iframe[id*="aswift_"], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication"]').forEach(el => {
        addSlot(el, 'gdn-iframe', 90);
        // iframe의 부모도 후보로 추가
        if (el.parentElement) addSlot(el.parentElement, 'gdn-iframe', 85);
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
        // 한국 매체 특화 셀렉터
        '[class*="banner"]', '[id*="banner"]',
        '.ads_area', '.ad_area', '#ad_area',
        '.ads-area', '.ad-area', '#ad-area',
      ];
      
      adSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => addSlot(el, 'ad-container', 70));
        } catch(e) {}
      });

      // 전략 4: IAB 표준 사이즈에 가까운 요소 찾기 (폴백)
      const standardSizes = ${JSON.stringify(IAB_STANDARD_SIZES)};

      // div, section, aside 중 광고 사이즈에 맞는 것 탐색
      document.querySelectorAll('div, section, aside, figure').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 30) return;

        for (const std of standardSizes) {
          const wMatch = Math.abs(rect.width - std.w) <= std.tolerance;
          const hMatch = Math.abs(rect.height - std.h) <= std.tolerance;

          if (wMatch && hMatch) {
            // 이미 결과에 있으면 건너뛰기
            if (seenElements.has(el)) return;
            
            // 내부에 이미지가 있고 텍스트가 적은 경우 광고일 확률 높음
            const images = el.querySelectorAll('img, iframe, canvas');
            const textLength = (el.textContent || '').trim().length;
            const hasAdIndicator = images.length > 0 && textLength < 200;

            if (hasAdIndicator) {
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

  console.log(`[AdSlotDetector] ${slots.length}개 슬롯 탐지:`, 
    slots.map(s => `${s.type}(${s.width}x${s.height}, conf:${s.confidence})`).join(', ') || '없음'
  );

  return slots;
}
