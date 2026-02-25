/**
 * GDN Capture v2 — Google Display Network 게재면 캡처 모듈
 *
 * 파이프라인:
 * 1. 퍼블리셔 페이지 로드
 * 2. 광고 슬롯 탐지 (4가지 전략: GDN태그, iframe, 컨테이너, IAB사이즈)
 * 3. 소재 이미지 강제 인젝션 (상위 confidence 슬롯부터 시도)
 * 4. 방해요소 제거 + CSS 정리
 * 5. 뷰포트 스크린샷 캡처
 */

import type { IPageHandle } from "../engine/browser-engine";
import { BaseChannel, type CaptureRequest } from "./base-channel";
import { detectAdSlots } from "../injection/ad-slot-detector";
import { injectCreative } from "../injection/creative-injector";

export class GdnCapture extends BaseChannel {
  async captureAdPlacement(page: IPageHandle, request: CaptureRequest): Promise<Buffer> {
    console.log(`[GDN] 캡처 시작: ${request.publisherUrl}`);
    console.log(`[GDN] 소재 URL: ${request.creativeUrl}`);

    // 1) 퍼블리셔 페이지 로드
    await page.goto(request.publisherUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 2) 페이지 안정화 대기 (광고 로드 포함)
    await new Promise((r) => setTimeout(r, 4000));

    // 3) 광고 슬롯 탐지
    const slots = await detectAdSlots(page);
    console.log(`[GDN] 탐지된 슬롯: ${slots.length}개`);

    if (slots.length === 0) {
      console.warn(`[GDN] 광고 슬롯을 찾을 수 없음: ${request.publisherUrl}`);
      // 슬롯이 없어도 페이지 전체 캡처 수행
    }

    // 4) 소재 인젝션 — 상위 3개 슬롯에 시도, 최소 1개 성공 목표
    let injectedCount = 0;
    const maxInjections = Math.min(slots.length, 3); // 최대 3개 슬롯

    for (let i = 0; i < maxInjections; i++) {
      const slot = slots[i];
      try {
        const success = await injectCreative(page, slot, {
          creativeUrl: request.creativeUrl,
          fitToSlot: true,
          removeObstructions: i === 0, // 방해요소 제거는 첫 번째에만
        });

        if (success) {
          console.log(`[GDN] ✅ 인젝션 성공 [${i + 1}/${maxInjections}]: ${slot.type}(${slot.width}x${slot.height}) conf:${slot.confidence}`);
          injectedCount++;
          break; // 첫 번째 성공 시 중단
        } else {
          console.warn(`[GDN] ⚠️ 인젝션 실패 [${i + 1}/${maxInjections}]: ${slot.selector}`);
        }
      } catch (err) {
        console.error(`[GDN] ❌ 인젝션 에러 [${i + 1}/${maxInjections}]:`, err);
      }
    }

    if (injectedCount === 0 && slots.length > 0) {
      console.warn("[GDN] 모든 슬롯에 인젝션 실패, 원본 페이지 캡처 진행");
    }

    // 5) 인젝션 후 렌더링 안정화
    await new Promise((r) => setTimeout(r, 2000));

    // 6) 스크린샷 캡처
    const screenshot = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    console.log(`[GDN] 캡처 완료 (인젝션: ${injectedCount}/${slots.length}개 슬롯)`);

    return screenshot;
  }
}
