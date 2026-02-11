/**
 * Base Channel — 모든 매체 캡처 채널의 공통 베이스
 *
 * 공통 로직: 브라우저 초기화, 랜딩 캡처, 워터마크 적용
 * 매체별 채널은 이 클래스를 상속하여 captureAdPlacement()만 구현
 */

import type { IBrowserEngine, IPageHandle } from "../engine/browser-engine";
import { PuppeteerEngine } from "../engine/puppeteer-engine";

export interface CaptureResult {
  /** 광고 게재면 스크린샷 */
  placementScreenshot: Buffer;
  /** 랜딩 페이지 스크린샷 (있는 경우) */
  landingScreenshot?: Buffer;
  /** 캡처 시각 */
  capturedAt: string;
  /** 캡처된 URL */
  pageUrl: string;
  /** 랜딩 페이지 URL (리다이렉트 최종 URL) */
  landingUrl?: string;
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

export interface CaptureRequest {
  /** 퍼블리셔 URL (광고가 게재된 페이지) */
  publisherUrl: string;
  /** 소재 이미지 URL */
  creativeUrl: string;
  /** 랜딩 페이지 캡처 여부 */
  captureLanding?: boolean;
  /** 클릭 URL (랜딩 페이지) */
  clickUrl?: string;
  /** 추가 옵션 */
  options?: Record<string, unknown>;
}

export abstract class BaseChannel {
  protected engine: IBrowserEngine;

  constructor(engine?: IBrowserEngine) {
    this.engine = engine ?? new PuppeteerEngine();
  }

  /** 매체별 캡처 실행 — 서브클래스에서 구현 */
  abstract captureAdPlacement(page: IPageHandle, request: CaptureRequest): Promise<Buffer>;

  /** 전체 캡처 파이프라인 실행 */
  async execute(request: CaptureRequest): Promise<CaptureResult> {
    await this.engine.launch();

    try {
      const page = await this.engine.newPage();

      // 1) 광고 게재면 캡처
      const placementScreenshot = await this.captureAdPlacement(page, request);

      // 2) 랜딩 페이지 캡처 (옵션)
      let landingScreenshot: Buffer | undefined;
      let landingUrl: string | undefined;

      if (request.captureLanding && request.clickUrl) {
        const landingResult = await this.captureLanding(page, request.clickUrl);
        landingScreenshot = landingResult.screenshot;
        landingUrl = landingResult.finalUrl;
      }

      return {
        placementScreenshot,
        landingScreenshot,
        capturedAt: new Date().toISOString(),
        pageUrl: request.publisherUrl,
        landingUrl,
      };
    } finally {
      await this.engine.close();
    }
  }

  /** 랜딩 페이지 캡처 (공통) */
  protected async captureLanding(
    page: IPageHandle,
    clickUrl: string
  ): Promise<{ screenshot: Buffer; finalUrl: string }> {
    // 랜딩 페이지로 이동
    await page.goto(clickUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // 쿠키 배너/팝업 제거
    const { removePageObstructions } = await import("../injection/creative-injector");
    await removePageObstructions(page);

    // 잠시 대기 (동적 컨텐츠 로드)
    await new Promise((r) => setTimeout(r, 2000));

    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    const finalUrl = page.url();

    return { screenshot, finalUrl };
  }
}
