/**
 * GDN Capture v3 — Google Display Network 게재면 캡처 모듈
 *
 * 파이프라인:
 * 1. 소재 이미지 서버 측 다운로드 → base64 data URL 변환 (CSP 우회)
 * 2. 퍼블리셔 페이지 로드
 * 3. 광고 슬롯 탐지 (4가지 전략)
 * 4. 소재 이미지 강제 인젝션 (data URL 사용)
 * 5. 방해요소 제거 + CSS 정리
 * 6. 뷰포트 스크린샷 캡처
 */

import type { IPageHandle } from "../engine/browser-engine";
import { BaseChannel, type CaptureRequest } from "./base-channel";
import { detectAdSlots } from "../injection/ad-slot-detector";
import { injectCreative } from "../injection/creative-injector";

/**
 * 이미지 URL을 서버 측에서 다운로드하여 base64 data URL로 변환합니다.
 * CSP(Content Security Policy) 완전 우회를 위함.
 */
async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  try {
    console.log(`[GDN] 소재 이미지 다운로드 시작: ${imageUrl}`);

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    console.log(`[GDN] 소재 이미지 변환 완료 (${contentType}, ${Math.round(arrayBuffer.byteLength / 1024)}KB)`);
    return dataUrl;
  } catch (err) {
    console.error(`[GDN] 소재 이미지 다운로드 실패:`, err);
    // 폴백: 원본 URL 그대로 사용
    return imageUrl;
  }
}

export class GdnCapture extends BaseChannel {
  async captureAdPlacement(page: IPageHandle, request: CaptureRequest): Promise<Buffer> {
    console.log(`[GDN] 캡처 시작: ${request.publisherUrl}`);
    console.log(`[GDN] 소재 URL: ${request.creativeUrl}`);

    // 1) 소재 이미지를 서버 측에서 미리 다운로드하여 base64 변환
    // → CSP, CORS 문제 완전 우회
    const creativeDataUrl = await imageUrlToDataUrl(request.creativeUrl);

    // 2) 퍼블리셔 페이지 로드
    await page.goto(request.publisherUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 3) 페이지 안정화 대기 (광고 로드 포함)
    await new Promise((r) => setTimeout(r, 4000));

    // 4) 광고 슬롯 탐지
    const slots = await detectAdSlots(page);
    console.log(`[GDN] 탐지된 슬롯: ${slots.length}개`);

    if (slots.length === 0) {
      console.warn(`[GDN] 광고 슬롯을 찾을 수 없음: ${request.publisherUrl}`);
    }

    // 5) 소재 인젝션 — base64 data URL을 사용하여 인젝션
    let injectedCount = 0;
    const maxAttempts = Math.min(slots.length, 5);

    for (let i = 0; i < maxAttempts; i++) {
      const slot = slots[i];
      try {
        const success = await injectCreative(page, slot, {
          creativeUrl: creativeDataUrl, // ← base64 data URL 사용!
          fitToSlot: true,
          removeObstructions: i === 0,
        });

        if (success) {
          console.log(`[GDN] ✅ 인젝션 성공 [${i + 1}/${maxAttempts}]: ${slot.type}(${slot.width}x${slot.height}) conf:${slot.confidence}`);
          injectedCount++;
          break; // 첫 번째 성공 시 중단
        } else {
          console.warn(`[GDN] ⚠️ 인젝션 실패 [${i + 1}/${maxAttempts}]: ${slot.selector}`);
        }
      } catch (err) {
        console.error(`[GDN] ❌ 인젝션 에러 [${i + 1}/${maxAttempts}]:`, err);
      }
    }

    if (injectedCount === 0 && slots.length > 0) {
      console.warn("[GDN] 모든 슬롯에 인젝션 실패, 원본 페이지 캡처 진행");
    }

    // 6) 인젝션 후 렌더링 안정화
    await new Promise((r) => setTimeout(r, 2000));

    // 7) 스크린샷 캡처
    const screenshot = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    console.log(`[GDN] 캡처 완료 (인젝션: ${injectedCount}/${slots.length}개 슬롯)`);

    return screenshot;
  }
}
