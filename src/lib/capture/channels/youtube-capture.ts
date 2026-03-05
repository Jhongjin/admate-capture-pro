/**
 * YouTube Capture v1 — YouTube 광고 캡처 모듈
 *
 * 지원 광고 유형:
 * 1. 인스트림 (프리롤) — 영상 플레이어에 프리롤 광고 시뮬레이션
 * 2. 디스플레이 — 사이드바 컴패니언 배너 영역에 인젝션
 * 3. 오버레이 — 영상 플레이어 하단 반투명 오버레이 배너
 */

import type { IPageHandle } from "../engine/browser-engine";
import { BaseChannel, type CaptureRequest } from "./base-channel";

/** YouTube 광고 유형 */
export type YouTubeAdType = "preroll" | "display" | "overlay";

/** YouTube 캡처 진단 정보 */
export interface YouTubeDiagnostics {
  adType: YouTubeAdType;
  playerFound: boolean;
  playerSize: { width: number; height: number };
  sidebarFound: boolean;
  injectionSuccess: boolean;
  creativeDownloaded: boolean;
  creativeBase64Size: number;
}

/**
 * 이미지 URL → base64 data URL 변환 (서버 측)
 */
async function imageUrlToDataUrl(imageUrl: string): Promise<{ dataUrl: string; sizeKB: number; ok: boolean }> {
  try {
    console.log(`[YouTube] 소재 이미지 다운로드 시작: ${imageUrl}`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const sizeKB = Math.round(arrayBuffer.byteLength / 1024);
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;
    console.log(`[YouTube] 소재 이미지 변환 완료 (${contentType}, ${sizeKB}KB)`);
    return { dataUrl, sizeKB, ok: true };
  } catch (err) {
    console.error(`[YouTube] 소재 이미지 다운로드 실패:`, err);
    return { dataUrl: imageUrl, sizeKB: 0, ok: false };
  }
}

/** YouTube URL에서 Video ID 추출 */
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') && u.pathname === '/watch') return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/embed/')[1]?.split('?')[0] || null;
    // 라이브 URL: youtube.com/live/VIDEO_ID
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/live/')[1]?.split('?')[0] || null;
    return null;
  } catch { return null; }
}

/** YouTube 썸네일 URL 생성 (공개 API, 인증 불필요) */
function getThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

export class YouTubeCapture extends BaseChannel {
  private diagnostics: YouTubeDiagnostics | null = null;

  getDiagnostics(): YouTubeDiagnostics | null {
    return this.diagnostics;
  }

  async captureAdPlacement(page: IPageHandle, request: CaptureRequest): Promise<Buffer> {
    const adType = (request.options?.youtubeAdType as YouTubeAdType) || "preroll";
    console.log(`[YouTube] ===== 캡처 시작 =====`);
    console.log(`[YouTube] 영상 URL: ${request.publisherUrl}`);
    console.log(`[YouTube] 광고 유형: ${adType}`);
    console.log(`[YouTube] 소재: ${request.creativeUrl}`);

    // 초기화
    this.diagnostics = {
      adType,
      playerFound: false,
      playerSize: { width: 0, height: 0 },
      sidebarFound: false,
      injectionSuccess: false,
      creativeDownloaded: false,
      creativeBase64Size: 0,
    };

    // 1) 소재 이미지 → base64 data URL 변환
    const { dataUrl: creativeDataUrl, sizeKB, ok } = await imageUrlToDataUrl(request.creativeUrl);
    this.diagnostics.creativeDownloaded = ok;
    this.diagnostics.creativeBase64Size = sizeKB;

    // 1.5) 🖼️ 비디오 ID 추출 + 썸네일 준비
    const videoId = extractVideoId(request.publisherUrl);
    let thumbnailDataUrl: string | null = null;
    if (videoId) {
      const thumbResult = await imageUrlToDataUrl(getThumbnailUrl(videoId));
      if (thumbResult.ok) {
        thumbnailDataUrl = thumbResult.dataUrl;
        console.log(`[YouTube] 🖼️ 썸네일 다운로드 성공 (${thumbResult.sizeKB}KB)`);
      } else {
        // fallback: hqdefault
        const fallback = await imageUrlToDataUrl(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
        if (fallback.ok) {
          thumbnailDataUrl = fallback.dataUrl;
          console.log(`[YouTube] 🖼️ 썸네일 폴백(hqdefault) 성공`);
        }
      }
    }

    // 2) 🍪 쿠키 동의 사전 처리 — CONSENT 쿠키 설정
    console.log(`[YouTube] 🍪 쿠키 동의 사전 처리 시작`);
    try {
      // YouTube 도메인에 CONSENT 쿠키 설정 (동의 완료 상태)
      await page.setCookie({
        name: "CONSENT",
        value: "PENDING+987",
        domain: ".youtube.com",
        path: "/",
      });
      await page.setCookie({
        name: "CONSENT",
        value: "YES+cb.20210328-17-p0.en+FX+987",
        domain: ".youtube.com",
        path: "/",
      });
      // SOCS 쿠키도 설정 (Google 통합 동의)
      await page.setCookie({
        name: "SOCS",
        value: "CAISHAgBEhJnd3NfMjAyMzA4MTUtMF9SQzIaAmVuIAEaBgiA_LyaBg",
        domain: ".youtube.com",
        path: "/",
      });
      console.log(`[YouTube] 🍪 CONSENT 쿠키 설정 완료`);
    } catch (cookieErr) {
      console.warn(`[YouTube] 🍪 쿠키 설정 실패 (진행 계속):`, cookieErr);
    }

    // 3) YouTube 페이지 로드
    const targetUrl = request.publisherUrl;
    await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });

    // 3.3) 🔤 한글 폰트 주입 (Vercel 서버리스 Chromium에는 CJK 폰트가 없음)
    await this.injectKoreanFonts(page);

    // 3.5) 쿠키 동의 팝업 강제 처리 (여전히 나타나는 경우)
    await this.dismissYouTubeConsent(page);

    // 4) YouTube 페이지 안정화 대기
    await new Promise((r) => setTimeout(r, 3000));

    // 4.5) 쿠키 동의 팝업이 여전히 있으면 재시도
    const hasConsent = await page.evaluate<boolean>(`
      (() => {
        const consentDialog = document.querySelector(
          'ytd-consent-bump-v2-lightbox, tp-yt-iron-overlay-backdrop, ' +
          '[action*="consent"], #consent-bump, .consent-bump-v2-lightbox, ' +
          'ytd-enforcement-message-view-model'
        );
        return !!consentDialog;
      })()
    `);

    if (hasConsent) {
      console.log(`[YouTube] 🍪 쿠키 동의 팝업 여전히 존재 — 강제 제거 + 페이지 리로드`);
      await page.evaluate<void>(`
        (() => {
          // 모든 동의 관련 요소 강제 제거
          const selectors = [
            'ytd-consent-bump-v2-lightbox',
            'tp-yt-iron-overlay-backdrop',
            '#consent-bump',
            '.consent-bump-v2-lightbox',
            'ytd-enforcement-message-view-model',
            'tp-yt-paper-dialog',
            'ytd-popup-container',
          ];
          selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => el.remove());
          });

          // body overflow 복원
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';
        })()
      `);
      
      // 강제 리로드
      await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 3000));
    }

    // 🔑 4.7) 봇 감지 메시지 확인 + 썸네일 폴백
    const botDetected = await this.checkBotDetection(page);

    if (botDetected && thumbnailDataUrl) {
      console.log(`[YouTube] 🤖 봇 감지 탐지됨 — 썸네일 이미지로 비디오 영역 교체`);
      await this.replacePlayerWithThumbnail(page, thumbnailDataUrl);
      await new Promise((r) => setTimeout(r, 1000));
    } else if (botDetected) {
      console.warn(`[YouTube] 🤖 봇 감지 + 썸네일 없음 — 봇 메시지만 숨김 처리`);
    }

    // 5) 영상 일시정지 (깨끗한 스크린샷을 위해)
    await this.pauseVideo(page);
    await new Promise((r) => setTimeout(r, 1000));

    // 6) 플레이어 정보 수집 (확장된 셀렉터)
    const playerInfo = await page.evaluate<{ found: boolean; width: number; height: number; top: number; left: number; sidebarFound: boolean }>(`
      (() => {
        // 다양한 셀렉터로 플레이어 탐색 (우선순위 순)
        const playerSelectors = [
          '#movie_player',
          '#player-container-inner',
          '#player-container-outer',
          'ytd-player#ytd-player',
          'ytd-player',
          '.html5-video-player',
          '#player',
          '#ytd-player',
          'div.ytd-watch-flexy#player',
        ];

        let player = null;
        for (const sel of playerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            // 실제 크기가 있는 요소만 사용
            if (rect.width > 100 && rect.height > 100) {
              player = el;
              break;
            }
          }
        }

        const sidebar = document.querySelector('#secondary, #related, ytd-watch-next-secondary-results-renderer');
        
        if (!player) return { found: false, width: 0, height: 0, top: 0, left: 0, sidebarFound: !!sidebar };
        
        const rect = player.getBoundingClientRect();
        return {
          found: true,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          sidebarFound: !!sidebar
        };
      })()
    `);

    this.diagnostics.playerFound = playerInfo.found;
    this.diagnostics.playerSize = { width: playerInfo.width, height: playerInfo.height };
    this.diagnostics.sidebarFound = playerInfo.sidebarFound;
    console.log(`[YouTube] 플레이어: ${playerInfo.found ? `✅ ${playerInfo.width}x${playerInfo.height}` : "❌ 미감지"}`);
    console.log(`[YouTube] 사이드바: ${playerInfo.sidebarFound ? "✅" : "❌"}`);

    // 6.5) 🧹 인젝션 전 방해 요소 제거 (구독 팝업, 봇 감지, 동의 팝업 등)
    await page.evaluate<void>(`
      (() => {
        // 1) "채널을 구독하시겠습니까?" 팝업 완전 제거
        const popupSelectors = [
          'ytd-popup-container',
          'tp-yt-paper-dialog',
          'yt-confirm-dialog-renderer',
          'ytd-modal-with-title-and-button-renderer',
          'ytd-mealbar-promo-renderer',
          '#dialog',
        ];
        popupSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });

        // 2) "로그인하여 봇이 아님을 확인하세요" 메시지 숨김
        //    플레이어 내부의 에러/확인 오버레이를 숨김
        const playerErrorSelectors = [
          '.ytp-error',
          '.ytp-error-content',
          '.ytp-error-content-wrap',
          '.ytp-error-content-wrap-reason',
          '.ytp-offline-slate',
          '.ytp-offline-slate-bar',
          'ytd-enforcement-message-view-model',
          '.ytp-pause-overlay',
          '#clarify-box',
          '.ytp-suggested-action',
          // 봇 확인 메시지 (로그인 프롬프트)
          '.ytp-error-content-wrap .ytp-error-content-wrap-reason',
        ];
        playerErrorSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            el.style.display = 'none !important';
            el.style.visibility = 'hidden !important';
            el.style.opacity = '0 !important';
          });
        });

        // 3) 쿠키 동의 관련 요소 제거
        const consentSelectors = [
          'ytd-consent-bump-v2-lightbox',
          'tp-yt-iron-overlay-backdrop',
          '#consent-bump',
          '.consent-bump-v2-lightbox',
        ];
        consentSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });

        // 4) 텍스트 기반으로 "봇이 아님" 메시지가 포함된 요소 숨김
        const allTexts = document.querySelectorAll('*');
        allTexts.forEach(el => {
          const text = el.textContent || '';
          if (
            (text.includes('봇이 아님을 확인') || text.includes('confirm you') ||
             text.includes('Confirm your identity') || text.includes('로그인하여')) &&
            el.closest('#movie_player, #player-container-inner, .html5-video-player')
          ) {
            el.style.display = 'none';
          }
        });

        // 5) body/html overflow 복원 (모달이 스크롤 막는 경우)
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.documentElement.style.overflow = '';

        console.log('[YouTube Cleanup] ✅ 방해 요소 제거 완료');
      })()
    `);

    // 7) 광고 유형별 인젝션
    let injectionSuccess = false;

    switch (adType) {
      case "preroll": {
        // 🎬 인스트림 광고 옵션 추출
        const instreamOpts = {
          adTitle: (request.options?.adTitle as string) || '',
          ctaText: (request.options?.ctaText as string) || '',
          landingUrl: (request.options?.landingUrl as string) || request.clickUrl || '',
          companionImageUrl: (request.options?.companionImageUrl as string) || '',
        };
        console.log(`[YouTube] 인스트림 옵션: title="${instreamOpts.adTitle}" cta="${instreamOpts.ctaText}" landing="${instreamOpts.landingUrl}"`);

        injectionSuccess = await this.injectPrerollAd(page, creativeDataUrl, playerInfo, instreamOpts);
        // 🎯 컴패니언 배너 동시 삽입
        if (injectionSuccess) {
          const companionImg = instreamOpts.companionImageUrl || creativeDataUrl;
          const companionResult = await this.injectDisplayAd(page, companionImg);
          console.log(`[YouTube] 컴패니언 배너: ${companionResult ? '✅ 성공' : '⚠️ 실패'}`);
        }
        break;
      }
      case "display":
        injectionSuccess = await this.injectDisplayAd(page, creativeDataUrl);
        break;
      case "overlay":
        injectionSuccess = await this.injectOverlayAd(page, creativeDataUrl, playerInfo);
        break;
    }

    this.diagnostics.injectionSuccess = injectionSuccess;

    if (!injectionSuccess) {
      console.warn(`[YouTube] ⚠️ 기본 인젝션 실패 — 폴백: 프리롤 강제 오버레이`);
      await this.injectPrerollAd(page, creativeDataUrl, playerInfo);
    }

    // 8) 렌더링 안정화
    await new Promise((r) => setTimeout(r, 2000));

    // 9) 스크롤 최상단 복원
    await page.evaluate<void>(`
      (() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));

    // 10) 전체 페이지 스크린샷
    const screenshot = await page.screenshot({
      fullPage: false, // YouTube는 뷰포트 캡처가 더 적합
      type: "png",
    });

    console.log(`[YouTube] ===== 캡처 완료 (${adType}) =====`);
    return screenshot;
  }

  /**
   * 🎬 인스트림 (프리롤) 광고 시뮬레이션
   * 📌 실제 YouTube 인스트림 광고 형태를 정확히 재현:
   *   - 좌상단: 작은 "광고" 라벨
   *   - 좌하단: 카드형 CTA (썸네일 + 상품명 + CTA 버튼 + "스폰서 · URL")
   *   - 우하단: "건너뛰기 ▶|" 버튼
   *   - 하단: 노란색 프로그레스 바
   */
  private async injectPrerollAd(
    page: IPageHandle,
    imgDataUrl: string,
    playerInfo: { found: boolean; width: number; height: number; top: number; left: number },
    instreamOpts: { adTitle: string; ctaText: string; landingUrl: string; companionImageUrl: string } = { adTitle: '', ctaText: '', landingUrl: '', companionImageUrl: '' }
  ): Promise<boolean> {
    console.log(`[YouTube] 🎬 프리롤 광고 인젝션 시작`);

    // 랜딩 URL에서 도메인 추출
    let landingDomain = 'advertiser.com';
    try {
      if (instreamOpts.landingUrl) {
        landingDomain = new URL(instreamOpts.landingUrl).hostname.replace('www.', '');
      }
    } catch { /* ignore */ }

    const adTitle = instreamOpts.adTitle || '광고주 사이트 방문';
    const ctaText = instreamOpts.ctaText || '자세히 알아보기';

    const result = await page.evaluate<boolean>(`
      (() => {
        try {
          const imgUrl = ${JSON.stringify(imgDataUrl)};
          const domainText = ${JSON.stringify(landingDomain)};
          const titleText = ${JSON.stringify(adTitle)};
          const ctaBtnText = ${JSON.stringify(ctaText)};

          // 플레이어 좌표 수집
          const playerSelectors = [
            '#movie_player', '#player-container-inner', '#player-container-outer',
            'ytd-player', '.html5-video-player', '#player',
          ];

          let playerRect = null;
          for (const sel of playerSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const r = el.getBoundingClientRect();
              if (r.width > 100 && r.height > 100) {
                playerRect = r;
                break;
              }
            }
          }

          const px = playerRect ? Math.round(playerRect.left) : 0;
          const py = playerRect ? Math.round(playerRect.top) : 56;
          const pw = playerRect ? Math.round(playerRect.width) : Math.round(window.innerWidth * 0.7);
          const ph = playerRect ? Math.round(playerRect.height) : Math.round(window.innerHeight * 0.6);

          // ═══════════════════════════════════════════════════
          // 메인 오버레이 (플레이어 전체를 덮음 + 라운딩)
          // ═══════════════════════════════════════════════════
          const overlay = document.createElement('div');
          overlay.id = 'admate-preroll-overlay';
          overlay.setAttribute('data-injected', 'admate-youtube-preroll');
          overlay.style.cssText = [
            'position: fixed',
            'top: ' + py + 'px',
            'left: ' + px + 'px',
            'width: ' + pw + 'px',
            'height: ' + ph + 'px',
            'z-index: 2147483647',
            'background: #000',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'overflow: hidden',
            'border-radius: 12px',
          ].join(' !important;') + ' !important';

          // ─── 광고 소재 이미지 (화면 꽉 채움, 실제 YouTube처럼) ───
          const img = document.createElement('img');
          img.src = imgUrl;
          img.setAttribute('data-injected', 'admate');
          img.style.cssText = 'width:100% !important;height:100% !important;object-fit:cover !important;display:block !important;position:absolute !important;top:0 !important;left:0 !important';
          overlay.appendChild(img);

          // ─── 좌상단: "광고" 라벨 (실제 YouTube처럼 극히 미세하게) ───
          const adLabel = document.createElement('div');
          adLabel.style.cssText = "position:absolute;top:10px;left:10px;color:rgba(255,255,255,0.5);font-size:10px;font-family:'Roboto',Arial,sans-serif;font-weight:400;letter-spacing:0.2px;z-index:10";
          adLabel.textContent = '광고';
          overlay.appendChild(adLabel);

          // ═══ 좌하단: CTA 카드 (실제 YouTube 동일) ═══
          // [원형 아이콘] 광고제목    [흰색 CTA 버튼]
          //              도메인
          const ctaCard = document.createElement('div');
          ctaCard.style.cssText = [
            'position: absolute',
            'bottom: 48px',
            'left: 12px',
            'display: flex',
            'align-items: center',
            'gap: 12px',
            'background: rgba(0,0,0,0.75)',
            'border-radius: 8px',
            'padding: 10px 14px',
            'max-width: 460px',
            'z-index: 10',
            'backdrop-filter: blur(4px)',
          ].join(' !important;') + ' !important';

          // 원형 아이콘
          const ctaIcon = document.createElement('img');
          ctaIcon.src = imgUrl;
          ctaIcon.style.cssText = 'width:40px !important;height:40px !important;border-radius:50% !important;object-fit:cover !important;flex-shrink:0 !important';
          ctaCard.appendChild(ctaIcon);

          // 텍스트 영역 (광고제목 + 도메인)
          const ctaTextDiv = document.createElement('div');
          ctaTextDiv.style.cssText = 'flex:1;min-width:0';
          ctaTextDiv.innerHTML = [
            '<div style="font-size:14px;font-weight:600;color:#fff;font-family:Noto Sans KR,Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3">' + titleText + '</div>',
            '<div style="font-size:12px;color:rgba(255,255,255,0.6);font-family:Noto Sans KR,Roboto,Arial,sans-serif;margin-top:2px;line-height:1.2">' + domainText + '</div>',
          ].join('');
          ctaCard.appendChild(ctaTextDiv);

          // ✅ CTA 버튼 (흰색 배경 + 검정 텍스트 + 라운드)
          const ctaBtn = document.createElement('div');
          ctaBtn.style.cssText = "background:#fff;color:#0f0f0f;font-size:14px;font-weight:600;font-family:Noto Sans KR,Roboto,Arial,sans-serif;padding:8px 16px;border-radius:20px;white-space:nowrap;cursor:pointer;flex-shrink:0;letter-spacing:0.2px";
          ctaBtn.textContent = ctaBtnText;
          ctaCard.appendChild(ctaBtn);

          overlay.appendChild(ctaCard);

          // ─── 좌하단 하위: "스폰서 ⓘ 도메인" ───
          const sponsorText = document.createElement('div');
          sponsorText.style.cssText = "position:absolute;bottom:28px;left:12px;font-size:11px;color:rgba(255,255,255,0.55);font-family:Noto Sans KR,Roboto,Arial,sans-serif;z-index:10;display:flex;align-items:center;gap:6px";
          sponsorText.innerHTML = '<span>스폰서</span><span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid rgba(255,255,255,0.4);border-radius:50%;font-size:9px">\u24d8</span><span>' + domainText + '</span>';
          overlay.appendChild(sponsorText);

          // ─── 하단: 노란색 프로그레스 바 ───
          const timerBg = document.createElement('div');
          timerBg.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:3px;background:rgba(255,255,255,0.15);z-index:10;border-radius:0 0 12px 12px';
          overlay.appendChild(timerBg);

          const timerBar = document.createElement('div');
          timerBar.style.cssText = 'position:absolute;bottom:0;left:0;width:33%;height:3px;background:#f2bc42;z-index:11;border-radius:0 0 0 12px';
          overlay.appendChild(timerBar);

          // body에 오버레이 추가
          document.body.appendChild(overlay);

          // ═══════════════════════════════════════════════════
          // 🔑 "건너뛰기" 버튼 — 실제 YouTube 둥근 알약형 (pill shape)
          //    body에 fixed로 배치 (오버레이 overflow:hidden 회피)
          // ═══════════════════════════════════════════════════
          const skipBtn = document.createElement('div');
          skipBtn.id = 'admate-skip-btn';
          skipBtn.setAttribute('data-injected', 'admate-youtube-preroll');
          skipBtn.style.cssText = [
            'position: fixed',
            'top: ' + (py + ph - 90) + 'px',
            'left: ' + (px + pw - 24) + 'px',
            'transform: translateX(-100%)',
            'background: rgba(28,28,28,0.8)',
            'color: #fff',
            'font-size: 15px',
            "font-family: 'Noto Sans KR','Roboto',Arial,sans-serif",
            'font-weight: 500',
            'padding: 10px 20px',
            'border-radius: 24px',
            'cursor: pointer',
            'display: flex',
            'align-items: center',
            'gap: 10px',
            'z-index: 2147483647',
            'letter-spacing: 0.3px',
            'backdrop-filter: blur(4px)',
          ].join(' !important;') + ' !important';
          // 텍스트를 span으로 감싸서 폰트 렌더링 보장
          skipBtn.innerHTML = '<span style="font-family:Noto Sans KR,Roboto,Arial,sans-serif !important;color:#fff !important;font-size:15px !important;font-weight:500 !important">건너뛰기</span> <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><path d="M5 18l10-6L5 6v12zm12-12v12h2V6h-2z"/></svg>';
          document.body.appendChild(skipBtn);

          console.log('[YouTube Inject] ✅ 프리롤 인젝션 성공 (실제 YouTube 형태, ' + pw + 'x' + ph + ')');
          return true;
        } catch (err) {
          console.error('[YouTube Inject] ❌ 프리롤 인젝션 에러:', err);
          return false;
        }
      })()
    `);

    console.log(`[YouTube] 프리롤 인젝션: ${result ? "✅ 성공" : "❌ 실패"}`);
    return result;
  }

  /**
   * 📺 디스플레이 (사이드바 컴패니언) 광고 인젝션
   * 실제 YouTube 디스플레이 광고 형태를 정확히 재현:
   *   - "스폰서 광고" 헤더 + ⓘ 아이콘 + X 닫기 버튼
   *   - 300x250 배너 이미지 (사이드바 전체 너비)
   *   - [파비콘] "광고주 사이트 방문" + "Ad · Sponsored" 푸터
   *   - 카테고리 칩 아래, 추천 영상 리스트 위에 배치
   */
  private async injectDisplayAd(page: IPageHandle, imgDataUrl: string): Promise<boolean> {
    console.log(`[YouTube] 📺 디스플레이 광고 인젝션 시작 (실제 YouTube 광고 형태)`);

    const result = await page.evaluate<boolean>(`
      (() => {
        const imgUrl = ${JSON.stringify(imgDataUrl)};

        // 사이드바 영역 찾기 (다양한 셀렉터)
        const sidebarSelectors = [
          '#secondary-inner',
          '#secondary',
          'ytd-watch-next-secondary-results-renderer',
          '#related',
        ];

        let sidebar = null;
        for (const sel of sidebarSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 50) {
              sidebar = el;
              console.log('[YouTube Inject] 사이드바 발견:', sel, Math.round(r.width) + 'px');
              break;
            }
          }
        }

        if (!sidebar) {
          console.warn('[YouTube Inject] 사이드바를 찾을 수 없습니다');
          return false;
        }

        // 사이드바 실제 너비 측정 (보통 402px @1920 / 336px @1440 등)
        const sidebarWidth = Math.round(sidebar.getBoundingClientRect().width);
        const adWidth = Math.min(sidebarWidth, 336); // YouTube 디스플레이 광고 최대 336px

        // ═══════════════════════════════════════════════════
        // 전체 광고 컨테이너 (실제 YouTube 스타일)
        // ═══════════════════════════════════════════════════
        const container = document.createElement('div');
        container.setAttribute('data-injected', 'admate-youtube-display');
        container.style.cssText = [
          'width: ' + adWidth + 'px !important',
          'margin: 0 0 16px 0 !important',
          'border-radius: 12px !important',
          'overflow: hidden !important',
          'box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important',
          'background: #fff !important',
          'border: 1px solid #e5e5e5 !important',
          'position: relative !important',
        ].join(';');

        // ─── "스폰서 광고" 헤더 + X 닫기 버튼 ───
        const header = document.createElement('div');
        header.style.cssText = [
          'display: flex !important',
          'align-items: center !important',
          'justify-content: space-between !important',
          'padding: 8px 12px !important',
          'background: #fff !important',
        ].join(';');

        // 좌측: "스폰서 광고" 텍스트
        const headerLeft = document.createElement('span');
        headerLeft.style.cssText = "font-size:12px;color:#606060;font-family:'Noto Sans KR','Roboto',Arial,sans-serif;font-weight:400;letter-spacing:0.3px";
        headerLeft.textContent = '스폰서 광고';

        // 우측: ⓘ 아이콘 + X 닫기 버튼
        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex;align-items:center;gap:8px';

        // ⓘ 아이콘
        const infoIcon = document.createElement('div');
        infoIcon.style.cssText = 'width:16px;height:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
        infoIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#909090"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

        // X 닫기 버튼
        const closeBtn = document.createElement('div');
        closeBtn.style.cssText = 'width:16px;height:16px;cursor:pointer;display:flex;align-items:center;justify-content:center';
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#909090"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

        headerRight.appendChild(infoIcon);
        headerRight.appendChild(closeBtn);
        header.appendChild(headerLeft);
        header.appendChild(headerRight);
        container.appendChild(header);

        // ─── 배너 이미지 (300x250 비율) ───
        const imgEl = document.createElement('img');
        imgEl.src = imgUrl;
        imgEl.setAttribute('data-injected', 'admate');
        imgEl.style.cssText = [
          'display: block !important',
          'width: 100% !important',
          'height: auto !important',
          'aspect-ratio: 300/250 !important',
          'object-fit: cover !important',
        ].join(';');
        container.appendChild(imgEl);

        // ─── 하단 푸터: [파비콘] "광고주 사이트 방문" + "Ad · Sponsored" ───
        const footer = document.createElement('div');
        footer.style.cssText = [
          'padding: 10px 12px !important',
          'display: flex !important',
          'align-items: center !important',
          'gap: 10px !important',
          'background: #fff !important',
          'border-top: 1px solid #e5e5e5 !important',
        ].join(';');

        // 파비콘 (파란색 원형 아이콘)
        const favicon = document.createElement('div');
        favicon.style.cssText = 'width:32px;height:32px;border-radius:50%;background:#065fd4;display:flex;align-items:center;justify-content:center;flex-shrink:0';
        favicon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';

        // 텍스트 영역
        const textArea = document.createElement('div');
        textArea.style.cssText = 'flex:1;min-width:0';
        textArea.innerHTML = [
          "<div style=\\"font-size:13px;font-weight:500;color:#0f0f0f;font-family:'Noto Sans KR','Roboto',Arial,sans-serif;\\">광고주 사이트 방문</div>",
          "<div style=\\"font-size:12px;color:#606060;font-family:'Roboto',Arial,sans-serif;margin-top:2px;\\">Ad · Sponsored</div>",
        ].join('');

        footer.appendChild(favicon);
        footer.appendChild(textArea);
        container.appendChild(footer);

        // ═══════════════════════════════════════════════════
        // 삽입 위치: 카테고리 칩 아래, 추천 영상 리스트 위
        // ═══════════════════════════════════════════════════

        // 카테고리 칩 컨테이너 찾기
        const chipContainer = sidebar.querySelector(
          'ytd-feed-filter-chip-bar-renderer, ' +
          'yt-chip-cloud-renderer, ' +
          '#chip-bar, ' +
          'iron-selector#chips'
        );

        if (chipContainer) {
          // 칩 컨테이너 바로 다음에 삽입
          chipContainer.parentNode.insertBefore(container, chipContainer.nextSibling);
          console.log('[YouTube Inject] ✅ 디스플레이 광고 (칩 아래) 삽입 성공');
        } else {
          // 칩이 없으면 사이드바 최상단에 삽입
          sidebar.insertBefore(container, sidebar.firstChild);
          console.log('[YouTube Inject] ✅ 디스플레이 광고 (최상단) 삽입 성공');
        }

        return true;
      })()
    `);

    console.log(`[YouTube] 디스플레이 인젝션: ${result ? "✅ 성공" : "❌ 실패"}`);
    return result;
  }

  /**
   * 🎭 오버레이 광고 인젝션
   * 📌 실제 YouTube 오버레이 광고 형태:
   *   - 플레이어 하단에 배치 (컨트롤바 바로 위)
   *   - 468×60 사이즈, 플레이어 중앙 정렬
   *   - 반투명 어두운 배경
   *   - 우상단에 X 닫기 버튼
   */
  private async injectOverlayAd(
    page: IPageHandle,
    imgDataUrl: string,
    playerInfo: { found: boolean; width: number; height: number; top: number; left: number }
  ): Promise<boolean> {
    console.log(`[YouTube] 🎭 오버레이 광고 인젝션 시작 (실제 YouTube 형태)`);

    const result = await page.evaluate<boolean>(`
      (() => {
        try {
          const imgUrl = ${JSON.stringify(imgDataUrl)};

          // 플레이어 좌표 수집
          const playerSelectors = [
            '#movie_player', '#player-container-inner', '#player-container-outer',
            'ytd-player', '.html5-video-player', '#player',
          ];

          let playerRect = null;
          for (const sel of playerSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const r = el.getBoundingClientRect();
              if (r.width > 100 && r.height > 100) {
                playerRect = r;
                break;
              }
            }
          }

          // 플레이어 기준 좌표 계산
          const px = playerRect ? Math.round(playerRect.left) : 0;
          const py = playerRect ? Math.round(playerRect.top) : 56;
          const pw = playerRect ? Math.round(playerRect.width) : Math.round(window.innerWidth * 0.7);
          const ph = playerRect ? Math.round(playerRect.height) : Math.round(window.innerHeight * 0.6);

          // 오버레이 배너 크기 (실제 YouTube: 468x60, 플레이어 너비에 따라 조정)
          const bannerW = Math.min(468, Math.round(pw * 0.55));
          const bannerH = 60;
          // 플레이어 하단에서 컨트롤바(약 48px) 바로 위에 배치
          const bannerTop = py + ph - bannerH - 48;
          const bannerLeft = px + Math.round((pw - bannerW) / 2);

          console.log('[YouTube Inject] 오버레이 위치:', bannerLeft, bannerTop, bannerW, bannerH);

          // 📌 document.body에 fixed 오버레이 생성
          const overlay = document.createElement('div');
          overlay.id = 'admate-overlay-ad';
          overlay.setAttribute('data-injected', 'admate-youtube-overlay');
          overlay.style.cssText = [
            'position: fixed',
            'top: ' + bannerTop + 'px',
            'left: ' + bannerLeft + 'px',
            'width: ' + bannerW + 'px',
            'height: ' + bannerH + 'px',
            'z-index: 2147483647',
            'background: rgba(0,0,0,0.85)',
            'overflow: hidden',
            'display: flex',
            'align-items: stretch',
            'box-shadow: 0 2px 8px rgba(0,0,0,0.3)',
          ].join(' !important;') + ' !important';

          // 광고 이미지 (468x60 크기에 맞게)
          const img = document.createElement('img');
          img.src = imgUrl;
          img.setAttribute('data-injected', 'admate');
          img.style.cssText = 'width:100% !important;height:100% !important;object-fit:cover !important;display:block !important';
          overlay.appendChild(img);

          // 우상단 X 닫기 버튼 (실제 YouTube 스타일)
          const closeBtn = document.createElement('div');
          closeBtn.style.cssText = [
            'position: absolute',
            'top: 0',
            'right: -24px',
            'width: 24px',
            'height: 24px',
            'background: rgba(0,0,0,0.75)',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'cursor: pointer',
            'z-index: 2147483647',
          ].join(' !important;') + ' !important';
          closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
          overlay.appendChild(closeBtn);

          // 좌하단 "광고" 라벨
          const adLabel = document.createElement('div');
          adLabel.style.cssText = 'position:absolute;bottom:2px;left:4px;font-size:10px;color:rgba(255,255,255,0.7);font-family:Roboto,Arial,sans-serif;letter-spacing:0.3px';
          adLabel.textContent = 'Ad';
          overlay.appendChild(adLabel);

          document.body.appendChild(overlay);

          console.log('[YouTube Inject] ✅ 오버레이 광고 인젝션 성공 (실제 YouTube 형태, ' + bannerW + 'x' + bannerH + ')');
          return true;
        } catch (err) {
          console.error('[YouTube Inject] ❌ 오버레이 인젝션 에러:', err);
          return false;
        }
      })()
    `);

    console.log(`[YouTube] 오버레이 인젝션: ${result ? "✅ 성공" : "❌ 실패"}`);
    return result;
  }

  /** YouTube 동영상 일시정지 */
  private async pauseVideo(page: IPageHandle): Promise<void> {
    await page.evaluate<void>(`
      (() => {
        // 방법 1: video 요소 직접 제어
        const video = document.querySelector('video');
        if (video) {
          video.pause();
          // 첫 프레임 표시를 위해 currentTime 설정
          if (video.currentTime === 0) video.currentTime = 2;
        }

        // 방법 2: YouTube Player API
        const player = document.querySelector('#movie_player');
        if (player && typeof player.pauseVideo === 'function') {
          player.pauseVideo();
        }

        // 방법 3: 키보드 이벤트 (스페이스바)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK' }));
      })()
    `);
    console.log(`[YouTube] ⏸️ 영상 일시정지`);
  }

  /** YouTube 쿠키 동의 팝업 제거 */
  private async dismissYouTubeConsent(page: IPageHandle): Promise<void> {
    const dismissed = await page.evaluate<boolean>(`
      (() => {
        // YouTube 동의 다이얼로그 제거
        const consentBtn = document.querySelector(
          'button[aria-label*="Accept"], button[aria-label*="동의"], ' +
          'tp-yt-paper-button.style-scope.ytd-consent-bump-v2-lightbox, ' +
          'button.yt-spec-button-shape-next--filled, ' +
          '[aria-label="Accept the use of cookies and other data for the purposes described"]'
        );
        if (consentBtn) {
          consentBtn.click();
          return true;
        }

        // 동의 오버레이 직접 제거
        const consentOverlays = document.querySelectorAll(
          'ytd-consent-bump-v2-lightbox, tp-yt-iron-overlay-backdrop, #consent-bump'
        );
        consentOverlays.forEach(el => el.remove());

        return consentOverlays.length > 0;
      })()
    `);

    if (dismissed) {
      console.log(`[YouTube] 🍪 쿠키 동의 팝업 제거 완료`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** 🔤 한글 폰트 주입 — Vercel 서버리스 Chromium에 CJK 폰트 없는 문제 해결 (강화 v2) */
  private async injectKoreanFonts(page: IPageHandle): Promise<void> {
    try {
      await page.evaluate<void>(`
        (() => {
          // 이미 주입됐으면 스킵
          if (document.querySelector('#admate-korean-fonts')) return;

          // 1) Google Fonts preconnect (속도 향상)
          const preconnect = document.createElement('link');
          preconnect.rel = 'preconnect';
          preconnect.href = 'https://fonts.gstatic.com';
          preconnect.crossOrigin = 'anonymous';
          document.head.appendChild(preconnect);

          // 2) Google Fonts CSS 로드 (Noto Sans KR + Roboto)
          const link = document.createElement('link');
          link.id = 'admate-korean-fonts';
          link.rel = 'stylesheet';
          link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Roboto:wght@300;400;500;700&display=swap';
          document.head.appendChild(link);

          // 3) 전체 페이지에 폰트 강제 적용 (더 공격적인 셀렉터)
          const style = document.createElement('style');
          style.id = 'admate-korean-fonts-style';
          style.textContent = [
            '*, *::before, *::after {',
            "  font-family: 'Noto Sans KR', 'Roboto', 'YouTube Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif !important;",
            '}',
            '/* YouTube 모든 텍스트 요소 */',
            'ytd-watch-flexy, ytd-watch-flexy *, ytd-compact-video-renderer, ytd-compact-video-renderer *,',
            '#title, #video-title, #description, #info-contents, #info, #meta,',
            '.ytd-video-primary-info-renderer, .ytd-video-secondary-info-renderer,',
            '#content-text, yt-formatted-string, span.yt-core-attributed-string,',
            '#owner-name, #channel-name, #subscriber-count, .ytd-channel-name,',
            '#count .ytd-video-primary-info-renderer, #date,',
            'ytd-comment-renderer, #content-text.ytd-comment-renderer,',
            'h1.ytd-watch-metadata, h1 yt-formatted-string,',
            '#secondary *, ytd-compact-video-renderer .details *,',
            'ytd-video-renderer *, ytd-grid-video-renderer *,',
            '.ytp-videowall-still-info-content *, .ytp-ce-element *,',
            '#chat-messages *, yt-live-chat-text-message-renderer * {',
            "  font-family: 'Noto Sans KR', 'Roboto', sans-serif !important;",
            '}',
          ].join('\\n');
          document.head.appendChild(style);

          console.log('[YouTube Inject] 🔤 한글 폰트 CSS 주입 완료');
        })()
      `);

      // 4) document.fonts.ready로 확실히 폰트 로드 대기 (최대 5초)
      const fontLoaded = await page.evaluate<boolean>(`
        (() => {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5000);
            document.fonts.ready.then(() => {
              clearTimeout(timeout);
              // 추가로 Noto Sans KR이 로드됐는지 확인
              const loaded = document.fonts.check('16px Noto Sans KR');
              resolve(loaded);
            }).catch(() => resolve(false));
          });
        })()
      `);

      if (fontLoaded) {
        console.log(`[YouTube] 🔤 한글 폰트 로드 확인 완료 ✅`);
      } else {
        console.warn(`[YouTube] 🔤 한글 폰트 로드 대기 타임아웃 — 추가 대기 3초`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      console.warn(`[YouTube] 🔤 한글 폰트 인젝션 실패 (진행 계속):`, err);
    }
  }

  /**
   * 🤖 봇 감지 메시지 존재 여부 확인
   * "로그인하여 봇이 아님을 확인하세요" 등의 메시지가 있으면 true 반환
   */
  private async checkBotDetection(page: IPageHandle): Promise<boolean> {
    const result = await page.evaluate<{ detected: boolean; message: string }>(`
      (() => {
        // 1) YouTube 봇 감지 전용 요소 확인
        const enforcementMsg = document.querySelector('ytd-enforcement-message-view-model');
        if (enforcementMsg) {
          return { detected: true, message: 'ytd-enforcement-message-view-model 발견' };
        }

        // 2) 플레이어 에러 화면 확인 (봇 감지 시 표시됨)
        const playerError = document.querySelector('.ytp-error');
        if (playerError) {
          const errorText = playerError.textContent || '';
          if (errorText.includes('봇') || errorText.includes('로그인') ||
              errorText.includes('confirm') || errorText.includes('Sign in') ||
              errorText.includes('bot')) {
            return { detected: true, message: '플레이어 에러 (봇 감지): ' + errorText.substring(0, 100) };
          }
        }

        // 3) 텍스트 기반 봇 감지 메시지 검색
        const body = document.body?.innerText || '';
        const botKeywords = [
          '봇이 아님을 확인',
          '로그인하여 봇이 아님',
          'Confirm you\\'re not a bot',
          'confirm your identity',
          'Sign in to confirm you',
          'confirm that you\\'re not a bot',
        ];

        for (const keyword of botKeywords) {
          if (body.includes(keyword)) {
            return { detected: true, message: '텍스트 감지: ' + keyword };
          }
        }

        // 4) video 요소가 있지만 재생 불가 상태인지 확인
        const video = document.querySelector('video');
        if (video) {
          const hasError = video.error !== null;
          const noSrc = !video.src && !video.currentSrc;
          if (hasError || noSrc) {
            // video가 있지만 소스가 없으면 봇 감지 가능성
            const errorOverlay = document.querySelector(
              '.ytp-error-content, .ytp-error-content-wrap, .ytp-offline-slate'
            );
            if (errorOverlay) {
              return { detected: true, message: '비디오 소스 없음 + 에러 오버레이 감지' };
            }
          }
        }

        return { detected: false, message: 'OK' };
      })()
    `);

    if (result.detected) {
      console.log(`[YouTube] 🤖 봇 감지 확인: ${result.message}`);
    } else {
      console.log(`[YouTube] ✅ 봇 감지 없음 — 정상 상태`);
    }

    return result.detected;
  }

  /**
   * 🔄 YouTube watch URL → embed URL 변환
   * embed URL은 봇 감지가 훨씬 느슨함
   */
  private convertToEmbedUrl(watchUrl: string): string | null {
    try {
      const url = new URL(watchUrl);
      let videoId: string | null = null;

      // youtube.com/watch?v=VIDEO_ID
      if (url.hostname.includes('youtube.com') && url.pathname === '/watch') {
        videoId = url.searchParams.get('v');
      }
      // youtu.be/VIDEO_ID
      else if (url.hostname === 'youtu.be') {
        videoId = url.pathname.slice(1);
      }
      // youtube.com/embed/VIDEO_ID (이미 embed)
      else if (url.pathname.startsWith('/embed/')) {
        return watchUrl; // 이미 embed URL
      }

      if (!videoId) return null;

      // autoplay=1&mute=1 → 자동 재생 (봇 감지 없이)
      return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&showinfo=0&controls=1`;
    } catch {
      return null;
    }
  }

  /**
   * 🖼️ YouTube 비디오 플레이어를 썸네일 이미지로 교체
   * 봇 감지로 영상이 재생 불가할 때, 썸네일로 대체하여
   * 실제 영상이 보이는 것처럼 표시
   */
  private async replacePlayerWithThumbnail(page: IPageHandle, thumbnailDataUrl: string): Promise<void> {
    console.log(`[YouTube] 🖼️ 플레이어를 썸네일 이미지로 교체 중...`);

    await page.evaluate<void>(`
      ((thumbSrc) => {
        // 플레이어 컨테이너 찾기
        const playerSelectors = [
          '#movie_player',
          '#player-container-inner',
          'ytd-player',
          '.html5-video-player',
        ];

        let playerEl = null;
        for (const sel of playerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 100 && r.height > 100) {
              playerEl = el;
              break;
            }
          }
        }

        if (!playerEl) {
          console.warn('[YouTube Thumbnail] 플레이어를 찾을 수 없음');
          return;
        }

        const rect = playerEl.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);

        // 기존 플레이어 내용물 모두 제거
        playerEl.innerHTML = '';

        // 썸네일 이미지로 교체
        playerEl.style.cssText = [
          'position: relative !important',
          'overflow: hidden !important',
          'background: #000 !important',
          'width: ' + w + 'px !important',
          'height: ' + h + 'px !important',
        ].join(';');

        // 썸네일 이미지 삽입
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.style.cssText = [
          'width: 100% !important',
          'height: 100% !important',
          'object-fit: cover !important',
          'display: block !important',
          'position: absolute !important',
          'top: 0 !important',
          'left: 0 !important',
        ].join(';');
        playerEl.appendChild(img);

        // 영상 재생 중인 것처럼 보이는 UI 추가 (하단 진행바)
        const progressBar = document.createElement('div');
        progressBar.style.cssText = [
          'position: absolute !important',
          'bottom: 0 !important',
          'left: 0 !important',
          'width: 100% !important',
          'height: 4px !important',
          'background: rgba(255,255,255,0.3) !important',
          'z-index: 100 !important',
        ].join(';');

        const progressFill = document.createElement('div');
        progressFill.style.cssText = [
          'width: 15% !important',
          'height: 100% !important',
          'background: #ff0000 !important',
          'border-radius: 0 2px 2px 0 !important',
        ].join(';');
        progressBar.appendChild(progressFill);
        playerEl.appendChild(progressBar);

        // 봇 감지 관련 오버레이 모두 제거
        const removeSelectors = [
          '.ytp-error',
          '.ytp-error-content',
          '.ytp-error-content-wrap',
          'ytd-enforcement-message-view-model',
          '.ytp-offline-slate',
          '.ytp-offline-slate-bar',
          '.ytp-error-content-wrap-reason',
        ];
        removeSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });

        // body 전체에서도 봇 관련 텍스트 요소 숨김
        document.querySelectorAll('*').forEach(el => {
          const text = el.textContent || '';
          if (
            (text.includes('봇이 아님을 확인') || text.includes('로그인하여 봇이 아님') ||
             text.includes('Confirm you') || text.includes('Sign in to confirm'))
          ) {
            const inPlayer = el.closest('#movie_player, #player-container-inner, .html5-video-player, ytd-player');
            if (inPlayer) {
              el.style.display = 'none';
              el.style.visibility = 'hidden';
            }
          }
        });

        console.log('[YouTube Thumbnail] ✅ 플레이어 썸네일 교체 완료 (' + w + 'x' + h + ')');
      })(${JSON.stringify(thumbnailDataUrl)})
    `);

    console.log(`[YouTube] 🖼️ 썸네일 교체 완료`);
  }

  /**
   * 📺 YouTube 플레이어 영역을 embed iframe으로 교체
   * 봇 감지가 뜬 원본 페이지에서 player 영역만 embed로 대체
   * → YouTube 레이아웃(제목, 댓글, 사이드바)은 유지하면서 영상만 정상 표시
   */
  private async replacePlayerWithEmbed(page: IPageHandle, embedUrl: string): Promise<void> {
    console.log(`[YouTube] 📺 플레이어를 embed iframe으로 교체 중...`);

    await page.evaluate<void>(`
      (() => {
        const embedSrc = ${JSON.stringify(embedUrl)};

        // 플레이어 컨테이너 찾기
        const playerSelectors = [
          '#movie_player',
          '#player-container-inner',
          'ytd-player',
          '.html5-video-player',
        ];

        let playerEl = null;
        for (const sel of playerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 100 && r.height > 100) {
              playerEl = el;
              break;
            }
          }
        }

        if (!playerEl) {
          console.warn('[YouTube Embed] 플레이어를 찾을 수 없음');
          return;
        }

        const rect = playerEl.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);

        // 기존 플레이어 내용 제거
        playerEl.innerHTML = '';

        // embed iframe 삽입
        const iframe = document.createElement('iframe');
        iframe.src = embedSrc;
        iframe.width = String(w);
        iframe.height = String(h);
        iframe.frameBorder = '0';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.style.cssText = [
          'width: 100% !important',
          'height: 100% !important',
          'border: none !important',
          'display: block !important',
        ].join(';');

        playerEl.appendChild(iframe);
        playerEl.style.overflow = 'hidden';
        playerEl.style.position = 'relative';

        // 봇 감지 관련 오버레이 모두 제거
        const removeSelectors = [
          '.ytp-error',
          '.ytp-error-content',
          '.ytp-error-content-wrap',
          'ytd-enforcement-message-view-model',
          '.ytp-offline-slate',
        ];
        removeSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });

        console.log('[YouTube Embed] ✅ 플레이어 embed 교체 완료 (' + w + 'x' + h + ')');
      })()
    `);

    // iframe 로드 대기
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`[YouTube] 📺 embed iframe 로드 완료`);
  }
}

