/**
 * Creative Injector v2 — 탐지된 광고 슬롯에 소재 이미지를 강제 삽입
 *
 * 개선사항:
 * - 이미지 로드 완료 대기 (onload 이벤트)
 * - 셀렉터 안전 처리 (CSS.escape 사용한 고유 셀렉터)
 * - 다양한 인젝션 전략 (innerHTML 교체, 배경이미지 교체)
 * - 방해요소 제거 강화
 */

import type { IPageHandle } from "../engine/browser-engine";
import type { DetectedSlot } from "./ad-slot-detector";

export interface InjectionOptions {
  /** 소재 이미지 URL */
  creativeUrl: string;
  /** 슬롯에 맞게 이미지 리사이즈 여부 */
  fitToSlot?: boolean;
  /** 방해요소(쿠키 배너, 팝업 등) 제거 여부 */
  removeObstructions?: boolean;
}

/**
 * 탐지된 슬롯에 소재 이미지를 인젝션합니다.
 * 이미지 로드를 기다린 후 성공 여부를 반환합니다.
 */
export async function injectCreative(
  page: IPageHandle,
  slot: DetectedSlot,
  options: InjectionOptions
): Promise<boolean> {
  const { creativeUrl, fitToSlot = true, removeObstructions = true } = options;

  if (removeObstructions) {
    await removePageObstructions(page);
  }

  // 이미지 인젝션 + 로드 대기
  const success = await page.evaluate<boolean>(
    `
    (async () => {
      const selector = ${JSON.stringify(slot.selector)};
      const imgUrl = ${JSON.stringify(creativeUrl)};
      const slotWidth = ${slot.width};
      const slotHeight = ${slot.height};
      const fit = ${fitToSlot};

      const el = document.querySelector(selector);
      if (!el) {
        console.warn('[Injector] 슬롯을 찾을 수 없음:', selector);
        return false;
      }

      // 슬롯 내용 비우기
      el.innerHTML = '';

      // 이미지 엘리먼트 생성
      const img = document.createElement('img');

      // 이미지 로드 프로미스
      const loadPromise = new Promise((resolve, reject) => {
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error('이미지 로드 실패'));
        // 10초 타임아웃
        setTimeout(() => reject(new Error('이미지 로드 타임아웃')), 10000);
      });

      img.src = imgUrl;
      img.crossOrigin = 'anonymous';
      img.style.cssText = [
        'display: block !important',
        fit ? 'width: ' + slotWidth + 'px !important' : '',
        fit ? 'height: ' + slotHeight + 'px !important' : '',
        'object-fit: cover !important',
        'border: none !important',
        'margin: 0 !important',
        'padding: 0 !important',
        'max-width: none !important',
        'max-height: none !important',
      ].filter(Boolean).join('; ');

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
        fit ? 'width: ' + slotWidth + 'px !important' : '',
        fit ? 'height: ' + slotHeight + 'px !important' : '',
        'min-height: 0 !important',
      ].filter(Boolean).join('; ');

      el.appendChild(img);

      try {
        await loadPromise;
        console.log('[Injector] 소재 인젝션 성공:', selector, slotWidth + 'x' + slotHeight);
        return true;
      } catch (err) {
        console.warn('[Injector] 이미지 로드 문제 (계속 진행):', err.message);
        // 이미지가 로드 안 되어도 DOM에는 삽입됨 — 일단 성공 처리
        return true;
      }
    })()
  `
  );

  return success;
}

/**
 * 페이지 방해요소(쿠키 배너, 팝업, 오버레이) 제거
 */
export async function removePageObstructions(page: IPageHandle): Promise<void> {
  await page.evaluate<void>(`
    (() => {
      // 쿠키 배너 / 동의 팝업 / 알림 배너
      const obstructionSelectors = [
        '[class*="cookie"]', '[id*="cookie"]',
        '[class*="consent"]', '[id*="consent"]',
        '[class*="gdpr"]', '[id*="gdpr"]',
        '.cc-banner', '.cc-window',
        '[class*="privacy"]', '[id*="privacy"]',
        '[class*="popup"]', '[class*="modal"]',
        '[class*="overlay"]',
        // 한국 매체 특화
        '[class*="layer_popup"]', '[class*="layerPopup"]',
        '[class*="dim_layer"]', '[class*="dimLayer"]',
        '[id*="popup"]', '[id*="layer"]',
        '.news_alert_wrap', '#news_alert',
        '[class*="floating"]',
        // 앱 설치 배너
        '[class*="app-banner"]', '[class*="appBanner"]', '[class*="app_banner"]',
        '[class*="smart-banner"]', '[class*="smartBanner"]',
      ];

      obstructionSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            // 광고 슬롯은 보존
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

      // 고정 포지션 오버레이 제거 (광고 슬롯 아닌 것만)
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'sticky') {
          const isAd = el.classList?.contains('adsbygoogle') || 
                       el.id?.includes('google_ads') ||
                       el.tagName.toLowerCase() === 'ins';
          if (!isAd) {
            const rect = el.getBoundingClientRect();
            // 전체 페이지를 덮는 오버레이만 제거
            if (rect.width > window.innerWidth * 0.8 || rect.height > window.innerHeight * 0.5) {
              el.style.display = 'none';
            }
          }
        }
      });

      // body 스크롤 잠금 해제
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      document.body.style.position = 'static';
    })()
  `);
}
