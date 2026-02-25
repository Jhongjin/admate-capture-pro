/**
 * GDN Capture v4 — Google Display Network 게재면 캡처 모듈
 *
 * 핵심 개선:
 * - 소재 이미지를 base64 data URL로 변환 (CSP 완전 우회)
 * - 슬롯별 인젝션 결과를 메타데이터에 기록 (디버깅)
 * - iframe 대체, 오버레이 등 다중 전략
 */

import type { IPageHandle } from "../engine/browser-engine";
import { BaseChannel, type CaptureRequest } from "./base-channel";
import { detectAdSlots, type DetectedSlot } from "../injection/ad-slot-detector";
import { injectCreative, type InjectionResult } from "../injection/creative-injector";

/** 캡처 진단 정보 */
export interface CaptureDiagnostics {
  slotsDetected: number;
  slotsAttempted: number;
  slotsInjected: number;
  creativeDownloaded: boolean;
  creativeBase64Size: number;
  slots: Array<{
    type: string;
    size: string;
    confidence: number;
    selector: string;
    injectionResult?: InjectionResult;
  }>;
}

/**
 * 이미지 URL → base64 data URL 변환 (서버 측)
 */
async function imageUrlToDataUrl(imageUrl: string): Promise<{ dataUrl: string; sizeKB: number; ok: boolean }> {
  try {
    console.log(`[GDN] 소재 이미지 다운로드 시작: ${imageUrl}`);

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const sizeKB = Math.round(arrayBuffer.byteLength / 1024);
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    console.log(`[GDN] 소재 이미지 변환 완료 (${contentType}, ${sizeKB}KB, base64길이: ${dataUrl.length})`);
    return { dataUrl, sizeKB, ok: true };
  } catch (err) {
    console.error(`[GDN] 소재 이미지 다운로드 실패:`, err);
    return { dataUrl: imageUrl, sizeKB: 0, ok: false };
  }
}

export class GdnCapture extends BaseChannel {
  // 진단 정보 저장용
  private diagnostics: CaptureDiagnostics | null = null;

  getDiagnostics(): CaptureDiagnostics | null {
    return this.diagnostics;
  }

  async captureAdPlacement(page: IPageHandle, request: CaptureRequest): Promise<Buffer> {
    console.log(`[GDN] ===== 캡처 시작 =====`);
    console.log(`[GDN] 게재면: ${request.publisherUrl}`);
    console.log(`[GDN] 소재: ${request.creativeUrl}`);

    // 초기화
    this.diagnostics = {
      slotsDetected: 0,
      slotsAttempted: 0,
      slotsInjected: 0,
      creativeDownloaded: false,
      creativeBase64Size: 0,
      slots: [],
    };

    // 1) 소재 이미지 → base64 data URL 변환
    const { dataUrl: creativeDataUrl, sizeKB, ok } = await imageUrlToDataUrl(request.creativeUrl);
    this.diagnostics.creativeDownloaded = ok;
    this.diagnostics.creativeBase64Size = sizeKB;
    console.log(`[GDN] 소재 다운로드: ${ok ? '성공' : '실패'} (${sizeKB}KB)`);

    // 2) 페이지 로드
    await page.goto(request.publisherUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 3) 광고 로드 대기
    await new Promise((r) => setTimeout(r, 5000));

    // 4) 광고 슬롯 탐지
    const slots = await detectAdSlots(page);
    this.diagnostics.slotsDetected = slots.length;
    console.log(`[GDN] 탐지된 슬롯: ${slots.length}개`);
    
    // 슬롯 상세 로깅
    slots.forEach((s, i) => {
      console.log(`[GDN]   [${i}] ${s.type} ${s.width}x${s.height} conf:${s.confidence} sel:${s.selector.substring(0, 80)}`);
      this.diagnostics!.slots.push({
        type: s.type,
        size: `${s.width}x${s.height}`,
        confidence: s.confidence,
        selector: s.selector.substring(0, 120),
      });
    });

    if (slots.length === 0) {
      console.warn(`[GDN] ⚠️ 광고 슬롯 0개 탐지 — 페이지 DOM 스냅샷:`);
      // DOM 디버깅: 광고 관련 요소 출력
      await this.debugPageDom(page);
    }

    // 5) 소재 인젝션
    let injectedCount = 0;
    const maxAttempts = Math.min(slots.length, 5);
    this.diagnostics.slotsAttempted = maxAttempts;

    for (let i = 0; i < maxAttempts; i++) {
      const slot = slots[i];
      try {
        console.log(`[GDN] 인젝션 시도 [${i + 1}/${maxAttempts}]: ${slot.type}(${slot.width}x${slot.height})`);
        
        const result = await injectCreative(page, slot, {
          creativeUrl: creativeDataUrl,
          fitToSlot: true,
          removeObstructions: i === 0,
        });

        this.diagnostics.slots[i].injectionResult = result;

        if (result.success) {
          console.log(`[GDN] ✅ 인젝션 성공 [${i + 1}]: method=${result.method}`);
          injectedCount++;
          break;
        } else {
          console.warn(`[GDN] ⚠️ 인젝션 실패 [${i + 1}]: ${result.error}`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[GDN] ❌ 인젝션 에러 [${i + 1}]:`, errMsg);
        if (this.diagnostics.slots[i]) {
          this.diagnostics.slots[i].injectionResult = { success: false, method: 'none', error: errMsg };
        }
      }
    }

    this.diagnostics.slotsInjected = injectedCount;

    if (injectedCount === 0) {
      console.warn("[GDN] 모든 인젝션 실패 — 폴백: 페이지 상단에 배너 오버레이");
      // 최종 폴백: 화면에 직접 오버레이
      await this.injectOverlayFallback(page, creativeDataUrl);
    }

    // 6) 렌더링 안정화 대기
    await new Promise((r) => setTimeout(r, 2000));

    // 7) 인젝션 결과 확인 (data-injected 속성 검색)
    const injectedCheck = await page.evaluate<{ found: boolean; count: number }>(`
      (() => {
        const injected = document.querySelectorAll('[data-injected="admate"], [data-injected="admate-wrapper"]');
        return { found: injected.length > 0, count: injected.length };
      })()
    `);
    console.log(`[GDN] 인젝션 검증: ${injectedCheck.found ? '✅' : '❌'} (${injectedCheck.count}개 요소)`);

    // 8) 스크린샷 캡처
    const screenshot = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    console.log(`[GDN] ===== 캡처 완료 (${injectedCount}/${slots.length}개 슬롯 인젝션) =====`);

    return screenshot;
  }

  /** 최종 폴백: 광고가 있을만한 위치에 강제 오버레이 */
  private async injectOverlayFallback(page: IPageHandle, imgDataUrl: string): Promise<void> {
    await page.evaluate<void>(`
      (() => {
        const imgUrl = ${JSON.stringify(imgDataUrl)};
        
        // 아이프레임들을 찾아서 첫 번째로 교체 시도
        const iframes = document.querySelectorAll('iframe');
        let replaced = false;
        
        for (const iframe of iframes) {
          const rect = iframe.getBoundingClientRect();
          // 광고 크기일 가능성이 높은 iframe만 (최소 200x80)
          if (rect.width >= 200 && rect.height >= 80 && rect.width <= 1200) {
            const wrapper = document.createElement('div');
            wrapper.setAttribute('data-injected', 'admate-wrapper');
            wrapper.style.cssText = 'overflow:hidden !important; width:' + Math.round(rect.width) + 'px !important; height:' + Math.round(rect.height) + 'px !important; display:block !important;';
            
            const img = document.createElement('img');
            img.src = imgUrl;
            img.setAttribute('data-injected', 'admate');
            img.style.cssText = 'display:block !important; width:' + Math.round(rect.width) + 'px !important; height:' + Math.round(rect.height) + 'px !important; object-fit:cover !important; border:none !important;';
            
            wrapper.appendChild(img);
            iframe.replaceWith(wrapper);
            replaced = true;
            console.log('[Injector] 폴백: iframe 교체 성공 (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')');
            break;
          }
        }
        
        if (!replaced) {
          // 이미지 태그 중 배너 크기인 것 찾기
          const allImages = document.querySelectorAll('img');
          for (const existingImg of allImages) {
            const rect = existingImg.getBoundingClientRect();
            if (rect.width >= 250 && rect.height >= 50 && rect.width <= 1200 && rect.height <= 400) {
              existingImg.src = imgUrl;
              existingImg.setAttribute('data-injected', 'admate');
              existingImg.style.cssText += ';object-fit:cover !important;';
              console.log('[Injector] 폴백: 배너 크기 이미지 교체 (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')');
              replaced = true;
              break;
            }
          }
        }
        
        if (!replaced) {
          console.warn('[Injector] 폴백: 교체 대상 없음');
        }
      })()
    `);
  }

  /** DOM 디버깅: 광고 관련 요소 조사 */
  private async debugPageDom(page: IPageHandle): Promise<void> {
    const debugInfo = await page.evaluate<string>(`
      (() => {
        const info = [];
        
        // iframe 수
        const iframes = document.querySelectorAll('iframe');
        info.push('iframes: ' + iframes.length);
        iframes.forEach((f, i) => {
          const r = f.getBoundingClientRect();
          info.push('  [' + i + '] ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' src=' + (f.src || '').substring(0, 60) + ' id=' + (f.id || 'N/A'));
        });
        
        // ins.adsbygoogle
        const ins = document.querySelectorAll('ins.adsbygoogle');
        info.push('ins.adsbygoogle: ' + ins.length);
        
        // ad 관련 클래스/id
        const adEls = document.querySelectorAll('[class*="ad"], [id*="ad"], [class*="banner"], [id*="banner"]');
        info.push('ad/banner elements: ' + adEls.length);
        
        // img 중 배너 사이즈
        const bannerImgs = [];
        document.querySelectorAll('img').forEach(img => {
          const r = img.getBoundingClientRect();
          if (r.width >= 200 && r.height >= 50 && r.width <= 1200) {
            bannerImgs.push(Math.round(r.width) + 'x' + Math.round(r.height));
          }
        });
        info.push('banner-sized imgs: ' + bannerImgs.length + ' [' + bannerImgs.slice(0, 5).join(', ') + ']');
        
        return info.join('\\n');
      })()
    `);
    console.log(`[GDN] DOM 디버그:\\n${debugInfo}`);
  }
}
