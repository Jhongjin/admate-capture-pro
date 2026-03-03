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
      timeout: 45000,
    });

    // 2.1) 🛡️ Cloudflare / 봇 감지 챌린지 대기
    const isBlocked = await this.waitForCloudflareClearance(page);
    if (isBlocked) {
      console.warn(`[GDN] ⚠️ Cloudflare 챌린지 통과 실패 — 그래도 진행 시도`);
    }

    // 2.5) 🔑 Lazy Loading 이미지 강제 로드
    // — 콘텐츠 영역만 제한적 스크롤 (뷰포트 5배까지)
    // — loading="lazy" 속성을 eager로 변경
    // — data-src, data-lazy-src 등을 src로 복원
    console.log("[GDN] 🔄 Lazy Loading 이미지 강제 로드 시작...");
    await page.evaluate<void>(`
      (async () => {
        // 1) loading="lazy" → "eager" 강제 전환
        document.querySelectorAll('img[loading="lazy"]').forEach(img => {
          img.setAttribute('loading', 'eager');
        });

        // 2) data-src, data-lazy-src 등 → src 복원
        document.querySelectorAll('img').forEach(img => {
          for (const attr of ${JSON.stringify(['data-src', 'data-lazy-src', 'data-original', 'data-lazy'])}) {
            const val = img.getAttribute(attr);
            if (val && !img.src.startsWith('data:') && (!img.src || img.src.includes('placeholder') || img.src.includes('blank') || img.naturalWidth === 0)) {
              img.src = val;
              img.removeAttribute(attr);
              break;
            }
          }
          // data-srcset → srcset
          const lazySrcset = img.getAttribute('data-srcset');
          if (lazySrcset && !img.srcset) {
            img.srcset = lazySrcset;
          }
        });

        // 3) <source> 태그의 data-srcset도 처리 (picture 요소)
        document.querySelectorAll('source[data-srcset]').forEach(source => {
          const val = source.getAttribute('data-srcset');
          if (val) {
            source.setAttribute('srcset', val);
            source.removeAttribute('data-srcset');
          }
        });

        // 4) 제한적 스크롤 — 뷰포트 5배 높이까지만 (상단 콘텐츠 보존)
        const viewportH = window.innerHeight || 900;
        const scrollStep = Math.max(viewportH * 0.7, 500);
        const maxScrollTarget = viewportH * 5; // 뷰포트 5배까지만
        const actualMax = Math.min(
          maxScrollTarget,
          Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        );
        
        for (let y = 0; y < actualMax; y += scrollStep) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise(r => setTimeout(r, 200));
        }

        // 5) 맨 위로 복원 + 확실한 렌더링 대기
        window.scrollTo({ top: 0, behavior: 'instant' });
        await new Promise(r => setTimeout(r, 300));
        // 이중 복원: 일부 사이트에서 scrollTo가 무시될 수 있음
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      })()
    `);
    console.log("[GDN] ✅ Lazy Loading 이미지 강제 로드 완료");

    // 3) 광고 로드 + 이미지 렌더링 대기
    await new Promise((r) => setTimeout(r, 3000));

    // 4) 광고 슬롯 탐지
    const slots = await detectAdSlots(page);
    this.diagnostics.slotsDetected = slots.length;
    console.log(`[GDN] 탐지된 슬롯: ${slots.length}개`);
    
    // 📐 광고 사이즈 매칭
    const creativeDims = request.options?.creativeDimensions as { width: number; height: number } | undefined;
    const adSizeMode = (request.options?.adSizeMode as string) || "auto";
    const targetAdSizes = (request.options?.targetAdSizes as string[]) || [];

    if (adSizeMode === "manual" && targetAdSizes.length > 0) {
      // 🎯 수동 모드: 사용자가 선택한 사이즈의 슬롯만 타겟팅
      console.log(`[GDN] 🎯 수동 사이즈 선택 모드: ${targetAdSizes.join(", ")}`);

      // 선택된 사이즈를 파싱 (예: "300x250" → {w:300, h:250})
      const parsedSizes = targetAdSizes.map((s) => {
        const [w, h] = s.split("x").map(Number);
        return { w, h };
      }).filter((s) => s.w > 0 && s.h > 0);

      // 각 슬롯에 대해 선택된 사이즈와의 매칭 점수 계산
      const TOLERANCE = 50; // ±50px 허용 오차
      const scoredSlots = slots.map((slot) => {
        let bestMatch = 0;
        for (const target of parsedSizes) {
          const wDiff = Math.abs(slot.width - target.w);
          const hDiff = Math.abs(slot.height - target.h);
          if (wDiff <= TOLERANCE && hDiff <= TOLERANCE) {
            // 정확할수록 높은 점수 (100이 완벽 매치)
            const score = 100 - (wDiff + hDiff);
            bestMatch = Math.max(bestMatch, score);
          }
        }
        return { slot, matchScore: bestMatch };
      });

      // 매칭 슬롯을 우선 정렬 (매칭 점수 > confidence 순)
      scoredSlots.sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return b.slot.confidence - a.slot.confidence;
      });

      // 정렬된 슬롯으로 교체
      slots.length = 0;
      scoredSlots.forEach((s) => slots.push(s.slot));

      const matchedCount = scoredSlots.filter((s) => s.matchScore > 0).length;
      console.log(`[GDN] 🎯 사이즈 매칭 결과: ${matchedCount}/${slots.length}개 슬롯 매칭`);

      slots.slice(0, 5).forEach((s, i) => {
        const scored = scoredSlots[i];
        console.log(`[GDN]   [${i}] ${s.width}x${s.height} matchScore:${scored.matchScore} conf:${s.confidence}`);
      });

    } else if (creativeDims && creativeDims.width > 0 && creativeDims.height > 0) {
      // ✨ 자동 모드: 업로드된 배너와 유사한 슬롯을 우선 정렬
      console.log(`[GDN] ✨ 자동 사이즈 매칭: ${creativeDims.width}x${creativeDims.height}`);
      const creativeAspect = creativeDims.width / creativeDims.height;

      // 각 슬롯에 사이즈 매칭 점수 부여
      slots.sort((a, b) => {
        const scoreA = this.calcSizeMatchScore(a, creativeDims, creativeAspect);
        const scoreB = this.calcSizeMatchScore(b, creativeDims, creativeAspect);
        // 높은 점수 우선 (동점이면 기존 confidence 우선)
        if (scoreB !== scoreA) return scoreB - scoreA;
        return b.confidence - a.confidence;
      });

      console.log(`[GDN] ✨ 매칭 후 슬롯 순서:`);
      slots.slice(0, 5).forEach((s, i) => {
        const score = this.calcSizeMatchScore(s, creativeDims, creativeAspect);
        console.log(`[GDN]   [${i}] ${s.width}x${s.height} matchScore:${score.toFixed(1)} conf:${s.confidence}`);
      });
    }
    
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

    // 5) 소재 인젝션 — injectionMode에 따라 동작
    const injectionMode = (request.options?.injectionMode as string) || "single";
    const targetSlotCount = (request.options?.slotCount as number) || 1;
    
    let injectedCount = 0;
    const maxAttempts = Math.min(slots.length, injectionMode === "all" ? 10 : 5);
    const maxSuccessSlots = injectionMode === "single" ? 1
      : injectionMode === "all" ? 999
      : targetSlotCount;
    
    this.diagnostics.slotsAttempted = maxAttempts;
    console.log(`[GDN] 인젝션 모드: ${injectionMode} (목표: ${maxSuccessSlots}개 슬롯)`);

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
          // 목표 슬롯 수 도달 시 중단
          if (injectedCount >= maxSuccessSlots) {
            console.log(`[GDN] 목표 슬롯 수 ${maxSuccessSlots}개 달성, 중단`);
            break;
          }
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

    // 7) 인젝션 결과 확인 + 스크롤 최상단 복원
    const injectedCheck = await page.evaluate<{ found: boolean; count: number }>(`
      (() => {
        const injected = document.querySelectorAll('[data-injected="admate"], [data-injected="admate-wrapper"]');
        // 🔑 페이지 최상단으로 확실하게 복원 (3중 방어)
        window.scrollTo({ top: 0, behavior: 'instant' });
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        return { found: injected.length > 0, count: injected.length };
      })()
    `);
    console.log(`[GDN] 인젝션 검증: ${injectedCheck.found ? '✅' : '❌'} (${injectedCheck.count}개 요소)`);

    // 🔑 스크롤 복원 후 충분한 렌더링 안정화 (블로터 등 동적 사이트 대응)
    await new Promise((r) => setTimeout(r, 2000));

    // 최종 스크롤 위치 확인
    const scrollCheck = await page.evaluate<{ scrollY: number; bodyH: number }>(`
      (() => ({
        scrollY: window.scrollY || window.pageYOffset || 0,
        bodyH: document.body.scrollHeight
      }))()
    `);
    console.log(`[GDN] 스크롤 위치 확인: scrollY=${scrollCheck.scrollY}, bodyH=${scrollCheck.bodyH}`);

    // 8) 전체 페이지 스크린샷 캡처
    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
    });

    console.log(`[GDN] ===== 캡처 완료 (전체 페이지, ${injectedCount}/${slots.length}개 슬롯 인젝션) =====`);

    return screenshot;
  }

  /**
   * 📐 배너 사이즈 매칭 점수 계산
   * 
   * 점수 구성 (0~100):
   * - 종횡비 일치도: 40점 (가로형↔가로형 매칭이 핵심)
   * - 크기 근접도: 60점 (픽셀 단위 유사도)
   * 
   * 예시: 728x90 배너
   *   - 728x90 슬롯 → 100점 (완벽 매칭)
   *   - 970x90 슬롯 → ~85점 (같은 가로형, 너비만 다름)
   *   - 300x250 슬롯 → ~20점 (종횡비 완전히 다름)
   */
  private calcSizeMatchScore(
    slot: DetectedSlot,
    creativeDims: { width: number; height: number },
    creativeAspect: number
  ): number {
    if (slot.width <= 0 || slot.height <= 0) return 0;

    const slotAspect = slot.width / slot.height;
    
    // 1) 종횡비 유사도 (0~40점)
    // log 비율 차이로 계산: 같으면 0, 크게 다르면 큰 값
    const aspectDiff = Math.abs(Math.log(creativeAspect) - Math.log(slotAspect));
    const aspectScore = Math.max(0, 40 - aspectDiff * 30);

    // 2) 크기 근접도 (0~60점)
    // 너비와 높이 각각의 차이 비율
    const widthRatio = Math.min(slot.width, creativeDims.width) / Math.max(slot.width, creativeDims.width);
    const heightRatio = Math.min(slot.height, creativeDims.height) / Math.max(slot.height, creativeDims.height);
    const sizeScore = ((widthRatio + heightRatio) / 2) * 60;

    return Math.round((aspectScore + sizeScore) * 10) / 10;
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

  /**
   * 🛡️ Cloudflare / 봇 감지 챌린지 대기
   * Cloudflare JS Challenge 또는 Turnstile이 감지되면 최대 20초 대기
   * @returns true = 여전히 차단 중, false = 통과됨
   */
  private async waitForCloudflareClearance(page: IPageHandle): Promise<boolean> {
    const MAX_WAIT_MS = 20000;
    const CHECK_INTERVAL_MS = 2000;
    let elapsed = 0;

    while (elapsed < MAX_WAIT_MS) {
      const checkResult = await page.evaluate<{ isChallenge: boolean; title: string; hasContent: boolean }>(`
        (() => {
          const title = document.title || '';
          const bodyText = (document.body?.innerText || '').substring(0, 2000);
          
          // Cloudflare 챌린지 페이지 감지 패턴
          const cfPatterns = [
            /just a moment/i,
            /checking your browser/i,
            /please wait/i,
            /attention required/i,
            /cloudflare/i,
            /enable javascript/i,
            /verify you are human/i,
            /ray id/i,
          ];
          
          const isTitleChallenge = cfPatterns.some(p => p.test(title));
          const isBodyChallenge = cfPatterns.some(p => p.test(bodyText));
          
          // Cloudflare 전용 요소 감지
          const hasCfElements = !!(document.querySelector('#cf-wrapper') ||
            document.querySelector('.cf-browser-verification') ||
            document.querySelector('#challenge-form') ||
            document.querySelector('#challenge-running') ||
            document.querySelector('[class*="challenge"]') ||
            document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
          
          // 실제 콘텐츠가 있는지 (기사, 광고 등)
          const hasContent = document.querySelectorAll('article, [class*="article"], [class*="content"], main, .news, #content, ins.adsbygoogle, iframe[id*="google_ads"]').length > 0;
          
          const isChallenge = (isTitleChallenge || isBodyChallenge || hasCfElements) && !hasContent;
          
          return { isChallenge, title, hasContent };
        })()
      `);

      if (!checkResult.isChallenge) {
        if (elapsed > 0) {
          console.log(`[GDN] ✅ Cloudflare 챌린지 통과 (${elapsed}ms 대기, title: "${checkResult.title}")`);
        }
        return false; // 통과
      }

      console.log(`[GDN] 🛡️ Cloudflare 챌린지 감지 — 대기 중... (${elapsed}ms/${MAX_WAIT_MS}ms, title: "${checkResult.title}")`);
      await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
      elapsed += CHECK_INTERVAL_MS;
    }

    console.warn(`[GDN] ❌ Cloudflare 챌린지 타임아웃 (${MAX_WAIT_MS}ms)`);
    return true; // 여전히 차단 중
  }
}
