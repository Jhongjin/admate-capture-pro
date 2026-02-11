/**
 * Ad Slot Detector — DOM에서 Google Ad 슬롯 탐지
 *
 * GDN, YouTube 등 매체별 광고 슬롯을 식별하고
 * 위치/크기 정보를 반환합니다.
 */

import type { IPageHandle } from "../engine/browser-engine";

export interface DetectedSlot {
  selector: string;
  tagName: string;
  width: number;
  height: number;
  x: number;
  y: number;
  type: "gdn-ins" | "gdn-iframe" | "custom";
}

/**
 * 페이지에서 Google Ad 슬롯을 탐지합니다.
 * @param page - 브라우저 페이지 핸들
 * @returns 탐지된 광고 슬롯 배열
 */
export async function detectAdSlots(page: IPageHandle): Promise<DetectedSlot[]> {
  const slots = await page.evaluate<DetectedSlot[]>(`
    (() => {
      const results = [];

      // 1) ins.adsbygoogle 태그
      document.querySelectorAll('ins.adsbygoogle').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({
            selector: buildSelector(el),
            tagName: el.tagName.toLowerCase(),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            type: 'gdn-ins'
          });
        }
      });

      // 2) Google Ads iframe
      document.querySelectorAll('iframe[id*="google_ads"], iframe[id*="aswift_"], iframe[src*="doubleclick.net"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({
            selector: buildSelector(el),
            tagName: el.tagName.toLowerCase(),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            type: 'gdn-iframe'
          });
        }
      });

      function buildSelector(el) {
        if (el.id) return '#' + el.id;
        let path = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
          path += '.' + el.className.trim().split(/\\s+/).join('.');
        }
        return path;
      }

      return results;
    })()
  `);

  return slots;
}
