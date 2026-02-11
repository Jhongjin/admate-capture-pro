/**
 * GDN Capture — Google Display Network 게재면 캡처 모듈
 *
 * 파이프라인:
 * 1. 퍼블리셔 페이지 로드
 * 2. 광고 슬롯 탐지 (ins.adsbygoogle, iframe)
 * 3. 소재 이미지 강제 인젝션
 * 4. 방해요소 제거 + CSS 정리
 * 5. 뷰포트 스크린샷 캡처
 */

import type { IPageHandle } from "../engine/browser-engine";
import { BaseChannel, type CaptureRequest } from "./base-channel";
import { detectAdSlots } from "../injection/ad-slot-detector";
import { injectCreative } from "../injection/creative-injector";

export class GdnCapture extends BaseChannel {
  async captureAdPlacement(page: IPageHandle, request: CaptureRequest): Promise<Buffer> {
    // 1) 퍼블리셔 페이지 로드
    await page.goto(request.publisherUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 2) 페이지 안정화 대기
    await new Promise((r) => setTimeout(r, 3000));

    // 3) 광고 슬롯 탐지
    const slots = await detectAdSlots(page);

    if (slots.length === 0) {
      console.warn(`[GDN] 광고 슬롯을 찾을 수 없음: ${request.publisherUrl}`);
      // 슬롯이 없어도 페이지 전체 캡처는 수행
    }

    // 4) 소재 인젝션 — 첫 번째 적합한 슬롯에 삽입
    let injected = false;
    for (const slot of slots) {
      const success = await injectCreative(page, slot, {
        creativeUrl: request.creativeUrl,
        fitToSlot: true,
        removeObstructions: true,
      });

      if (success) {
        console.log(`[GDN] 소재 인젝션 성공: ${slot.selector} (${slot.width}x${slot.height})`);
        injected = true;
        break; // 첫 번째 성공 슬롯에만 인젝션
      }
    }

    if (!injected && slots.length > 0) {
      console.warn("[GDN] 모든 슬롯에 인젝션 실패");
    }

    // 5) 인젝션 후 렌더링 안정화
    await new Promise((r) => setTimeout(r, 1000));

    // 6) 스크린샷 캡처
    const screenshot = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    return screenshot;
  }
}
