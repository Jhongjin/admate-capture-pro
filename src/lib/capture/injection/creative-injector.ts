/**
 * Creative Injector v3 — 탐지된 광고 슬롯에 소재 이미지를 강제 삽입
 *
 * 전략:
 * - 일반 요소: innerHTML 교체 후 img 삽입
 * - iframe 요소: 부모에서 iframe을 div+img로 완전 대체 (replaceWith)
 * - 폴백: 위치 기반 절대 좌표 오버레이
 * - data: URL 사용으로 CSP 우회
 * - 이미지 로드 완료 대기
 */

import type { IPageHandle } from "../engine/browser-engine";
import type { DetectedSlot } from "./ad-slot-detector";

export interface InjectionOptions {
  /** 소재 이미지 URL (또는 data: URL) */
  creativeUrl: string;
  /** 슬롯에 맞게 이미지 리사이즈 여부 */
  fitToSlot?: boolean;
  /** 방해요소(쿠키 배너, 팝업 등) 제거 여부 */
  removeObstructions?: boolean;
}

/** 인젝션 결과 상세 */
export interface InjectionResult {
  success: boolean;
  method: "replace-content" | "replace-iframe" | "overlay" | "none";
  error?: string;
}

/**
 * 탐지된 슬롯에 소재 이미지를 인젝션합니다.
 * 여러 전략을 순차 시도합니다.
 */
export async function injectCreative(
  page: IPageHandle,
  slot: DetectedSlot,
  options: InjectionOptions
): Promise<InjectionResult> {
  const { creativeUrl, fitToSlot = true, removeObstructions = true } = options;

  if (removeObstructions) {
    await removePageObstructions(page);
  }

  // 인젝션 실행 — 요소 유형에 따라 전략 선택
  const result = await page.evaluate<InjectionResult>(
    `
    (async () => {
      const selector = ${JSON.stringify(slot.selector)};
      const imgUrl = ${JSON.stringify(creativeUrl)};
      const slotW = ${slot.width};
      const slotH = ${slot.height};
      const slotX = ${slot.x};
      const slotY = ${slot.y};
      const fit = ${fitToSlot};
      const tagName = ${JSON.stringify(slot.tagName)};

      console.log('[Injector] 인젝션 시도:', selector, tagName, slotW + 'x' + slotH);

      // 헬퍼: 이미지 엘리먼트 생성
      function createImgElement() {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.crossOrigin = 'anonymous';
        img.setAttribute('data-injected', 'admate');
        img.style.cssText = [
          'display: block !important',
          fit ? 'width: ' + slotW + 'px !important' : '',
          fit ? 'height: ' + slotH + 'px !important' : '',
          'object-fit: cover !important',
          'border: none !important',
          'margin: 0 !important',
          'padding: 0 !important',
          'max-width: none !important',
          'max-height: none !important',
          'opacity: 1 !important',
          'visibility: visible !important',
        ].filter(Boolean).join('; ');
        return img;
      }

      // 헬퍼: 컨테이너 래퍼 생성
      function createWrapper() {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-injected', 'admate-wrapper');
        wrapper.style.cssText = [
          'overflow: hidden !important',
          'background: transparent !important',
          'border: none !important',
          'display: block !important',
          'visibility: visible !important',
          'opacity: 1 !important',
          'position: relative !important',
          'z-index: 10 !important',
          fit ? 'width: ' + slotW + 'px !important' : '',
          fit ? 'height: ' + slotH + 'px !important' : '',
        ].filter(Boolean).join('; ');
        return wrapper;
      }

      // 이미지 로드 대기 함수
      function waitForImageLoad(img, timeoutMs = 8000) {
        return new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve(true);
            return;
          }
          const timer = setTimeout(() => resolve(false), timeoutMs);
          img.onload = () => { clearTimeout(timer); resolve(true); };
          img.onerror = () => { clearTimeout(timer); resolve(false); };
        });
      }

      const el = document.querySelector(selector);
      if (!el) {
        console.warn('[Injector] 슬롯을 찾을 수 없음:', selector);

        // 폴백: 위치 기반 오버레이
        console.log('[Injector] 위치 기반 오버레이 폴백 시도');
        const overlay = createWrapper();
        overlay.style.position = 'absolute !important';
        overlay.style.left = slotX + 'px';
        overlay.style.top = slotY + 'px';
        overlay.style.zIndex = '99999';
        const img = createImgElement();
        overlay.appendChild(img);
        document.body.appendChild(overlay);

        await waitForImageLoad(img);
        return { success: true, method: 'overlay', error: undefined };
      }

      // 전략 1: iframe → replaceWith
      if (tagName === 'iframe') {
        console.log('[Injector] iframe 대체 전략 사용');
        try {
          const wrapper = createWrapper();
          const img = createImgElement();
          wrapper.appendChild(img);

          el.replaceWith(wrapper);
          await waitForImageLoad(img);
          console.log('[Injector] iframe 대체 성공');
          return { success: true, method: 'replace-iframe', error: undefined };
        } catch (err) {
          console.error('[Injector] iframe 대체 실패:', err.message);
          // 폴백: 오버레이
          const overlay = createWrapper();
          overlay.style.position = 'absolute !important';
          overlay.style.left = slotX + 'px';
          overlay.style.top = slotY + 'px';
          overlay.style.zIndex = '99999';
          const img2 = createImgElement();
          overlay.appendChild(img2);
          document.body.appendChild(overlay);
          await waitForImageLoad(img2);
          return { success: true, method: 'overlay', error: err.message };
        }
      }

      // 전략 2: 일반 요소 → 내용 교체
      console.log('[Injector] 내용 교체 전략 사용');
      try {
        // 슬롯 내용 비우기
        el.innerHTML = '';

        // 슬롯 스타일 강제 오버라이드
        el.style.cssText += ';' + [
          'overflow: hidden !important',
          'background: transparent !important',
          'border: none !important',
          'display: block !important',
          'visibility: visible !important',
          'opacity: 1 !important',
          'position: relative !important',
          'z-index: 10 !important',
          fit ? 'width: ' + slotW + 'px !important' : '',
          fit ? 'height: ' + slotH + 'px !important' : '',
          'min-height: 0 !important',
        ].filter(Boolean).join('; ');

        const img = createImgElement();
        el.appendChild(img);

        await waitForImageLoad(img);
        console.log('[Injector] 내용 교체 성공');
        return { success: true, method: 'replace-content', error: undefined };
      } catch (err) {
        console.error('[Injector] 내용 교체 실패:', err.message);
        return { success: false, method: 'none', error: err.message };
      }
    })()
  `
  );

  console.log(`[Injector] 결과: method=${result.method}, success=${result.success}${result.error ? ', error=' + result.error : ''}`);
  return result;
}

/**
 * 페이지 방해요소(쿠키 배너, 팝업, 오버레이) 제거
 */
export async function removePageObstructions(page: IPageHandle): Promise<void> {
  await page.evaluate<void>(`
    (() => {
      const obstructionSelectors = [
        '[class*="cookie"]', '[id*="cookie"]',
        '[class*="consent"]', '[id*="consent"]',
        '[class*="gdpr"]', '[id*="gdpr"]',
        '.cc-banner', '.cc-window',
        '[class*="privacy"]', '[id*="privacy"]',
        '[class*="popup"]', '[class*="modal"]',
        '[class*="overlay"]',
        '[class*="layer_popup"]', '[class*="layerPopup"]',
        '[class*="dim_layer"]', '[class*="dimLayer"]',
        '[id*="popup"]', '[id*="layer"]',
        '.news_alert_wrap', '#news_alert',
        '[class*="floating"]',
        '[class*="app-banner"]', '[class*="appBanner"]', '[class*="app_banner"]',
        '[class*="smart-banner"]', '[class*="smartBanner"]',
      ];

      obstructionSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            const isAd = el.classList?.contains('adsbygoogle') || 
                         el.id?.includes('google_ads') || 
                         el.id?.includes('ad-slot') ||
                         el.getAttribute('data-ad-slot');
            if (!isAd) {
              el.style.display = 'none';
              el.style.visibility = 'hidden';
            }
          });
        } catch(e) {}
      });

      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          const isAd = el.classList?.contains('adsbygoogle') || 
                       el.id?.includes('google_ads') ||
                       el.tagName.toLowerCase() === 'ins';
          if (!isAd) {
            const rect = el.getBoundingClientRect();
            if (rect.width > window.innerWidth * 0.8 || rect.height > window.innerHeight * 0.5) {
              el.style.display = 'none';
            }
          }
        }
      });

      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      document.body.style.position = 'static';
    })()
  `);
}
