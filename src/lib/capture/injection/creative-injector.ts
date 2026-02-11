/**
 * Creative Injector — 탐지된 광고 슬롯에 소재 이미지를 강제 삽입
 *
 * 광고 슬롯에 실제 소재 이미지를 인젝션하고
 * 주변 방해요소를 제거하여 깔끔한 캡처를 가능하게 합니다.
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

  const success = await page.evaluate<boolean>(
    `
    ((selector, imgUrl, slotWidth, slotHeight, fit) => {
      const el = document.querySelector(selector);
      if (!el) return false;

      // 슬롯 내용 비우기
      el.innerHTML = '';

      // 이미지 엘리먼트 생성
      const img = document.createElement('img');
      img.src = imgUrl;
      img.style.cssText = [
        'display: block',
        fit ? 'width: ' + slotWidth + 'px' : '',
        fit ? 'height: ' + slotHeight + 'px' : '',
        'object-fit: cover',
        'border: none',
        'margin: 0',
        'padding: 0'
      ].filter(Boolean).join('; ');

      // 슬롯 스타일 강제 오버라이드
      el.style.cssText += [
        'overflow: hidden !important',
        'background: transparent !important',
        'border: none !important',
        'display: block !important',
        'visibility: visible !important',
        'opacity: 1 !important',
        'position: relative !important'
      ].join('; ');

      el.appendChild(img);
      return true;
    })("${slot.selector}", "${creativeUrl}", ${slot.width}, ${slot.height}, ${fitToSlot})
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
      // 쿠키 배너 / 동의 팝업
      const cookieSelectors = [
        '[class*="cookie"]', '[id*="cookie"]',
        '[class*="consent"]', '[id*="consent"]',
        '[class*="gdpr"]', '[id*="gdpr"]',
        '.cc-banner', '.cc-window',
        '[class*="privacy"]',
      ];

      cookieSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          el.style.display = 'none';
          el.style.visibility = 'hidden';
        });
      });

      // 고정 포지션 오버레이 제거 (광고 슬롯 아닌 것만)
      document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]').forEach(el => {
        if (!el.classList.contains('adsbygoogle') && !el.id?.includes('google_ads')) {
          el.style.display = 'none';
        }
      });

      // body 스크롤 잠금 해제
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    })()
  `);
}
