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

    // 6.5) 🧹 인젝션 전 방해 요소 제거 (동의 팝업, 오버레이 등)
    await page.evaluate<void>(`
      (() => {
        // YouTube 자체 오버레이/팝업/에러 메시지 제거
        const removeSelectors = [
          '.ytp-error', '.ytp-error-content', '.ytp-error-content-wrap',
          'ytd-consent-bump-v2-lightbox', 'tp-yt-iron-overlay-backdrop',
          '.ytp-offline-slate', '#consent-bump', 'ytd-enforcement-message-view-model',
          'tp-yt-paper-dialog', '.consent-bump-v2-lightbox',
          '.ytp-pause-overlay',
        ];
        removeSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
        });
      })()
    `);

    // 7) 광고 유형별 인젝션
    let injectionSuccess = false;

    switch (adType) {
      case "preroll":
        injectionSuccess = await this.injectPrerollAd(page, creativeDataUrl, playerInfo);
        break;
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
   * 📌 전략: document.body에 fixed 포지션으로 플레이어 위치에 정확히 오버레이
   *    → YouTube 내부 z-index에 영향받지 않음
   */
  private async injectPrerollAd(
    page: IPageHandle,
    imgDataUrl: string,
    playerInfo: { found: boolean; width: number; height: number; top: number; left: number }
  ): Promise<boolean> {
    console.log(`[YouTube] 🎬 프리롤 광고 인젝션 시작 (fixed 포지션 방식)`);

    const result = await page.evaluate<boolean>(`
      (() => {
        try {
          const imgUrl = ${JSON.stringify(imgDataUrl)};

          // 플레이어 좌표 수집 — 다양한 셀렉터로 탐색
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
                console.log('[YouTube Inject] 플레이어 발견:', sel, r.width + 'x' + r.height);
                break;
              }
            }
          }

          // 플레이어 미발견 시 기본값 사용 (화면 상단 주요 영역)
          const px = playerRect ? Math.round(playerRect.left) : 0;
          const py = playerRect ? Math.round(playerRect.top) : 56; // YouTube 헤더 높이
          const pw = playerRect ? Math.round(playerRect.width) : Math.round(window.innerWidth * 0.7);
          const ph = playerRect ? Math.round(playerRect.height) : Math.round(window.innerHeight * 0.6);

          console.log('[YouTube Inject] 오버레이 위치:', px, py, pw, ph);

          // 📌 document.body에 fixed 오버레이 생성
          const overlay = document.createElement('div');
          overlay.id = 'admate-preroll-overlay';
          overlay.setAttribute('data-injected', 'admate-youtube-preroll');
          overlay.style.cssText = [
            'position: fixed',
            'top: ' + py + 'px',
            'left: ' + px + 'px',
            'width: ' + pw + 'px',
            'height: ' + ph + 'px',
            'z-index: 2147483647',  // max int — 절대 최상위
            'background: #000',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'overflow: hidden',
            'pointer-events: auto',
          ].join(' !important;') + ' !important';

          // 광고 소재 이미지
          const img = document.createElement('img');
          img.src = imgUrl;
          img.setAttribute('data-injected', 'admate');
          img.style.cssText = [
            'max-width: 100%',
            'max-height: 100%',
            'object-fit: contain',
            'display: block',
          ].join(' !important;') + ' !important';
          overlay.appendChild(img);

          // 📺 "광고" 라벨 (좌상단)
          const adLabel = document.createElement('div');
          adLabel.style.cssText = 'position:absolute;top:12px;left:12px;background:rgba(0,0,0,0.7);color:#fff;font-size:12px;font-family:YouTube Sans,Roboto,Arial,sans-serif;padding:4px 10px;border-radius:3px;font-weight:500;letter-spacing:0.3px;z-index:2147483647';
          adLabel.textContent = '광고';
          overlay.appendChild(adLabel);

          // ⏭ "건너뛰기" 버튼 (우하단) — YouTube 스타일
          const skipBtn = document.createElement('div');
          skipBtn.style.cssText = 'position:absolute;bottom:76px;right:0;background:rgba(0,0,0,0.75);color:#fff;font-size:14px;font-family:YouTube Sans,Roboto,Arial,sans-serif;padding:10px 16px 10px 12px;border-radius:2px 0 0 2px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:3px solid #fff';
          skipBtn.innerHTML = '광고 건너뛰기 <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M5 18l10-6L5 6v12zm12-12v12h2V6h-2z"/></svg>';
          overlay.appendChild(skipBtn);

          // ⏱ 타이머 바 (하단) — 노란색 프로그레스 바
          const timerBg = document.createElement('div');
          timerBg.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:4px;background:rgba(255,255,255,0.2)';
          overlay.appendChild(timerBg);

          const timerBar = document.createElement('div');
          timerBar.style.cssText = 'position:absolute;bottom:0;left:0;width:35%;height:4px;background:#f2bc42;border-radius:0 2px 0 0';
          overlay.appendChild(timerBar);

          // 🕐 광고 카운트다운 (좌하단)
          const countdown = document.createElement('div');
          countdown.style.cssText = 'position:absolute;bottom:46px;left:12px;background:rgba(0,0,0,0.7);color:#ddd;font-size:12px;font-family:YouTube Sans,Roboto,Arial,sans-serif;padding:5px 10px;border-radius:3px';
          countdown.textContent = '0:05 / 0:15';
          overlay.appendChild(countdown);

          // 📍 "광고주 사이트 방문" 버튼
          const visitBtn = document.createElement('div');
          visitBtn.style.cssText = 'position:absolute;bottom:40px;right:0;background:rgba(255,203,0,0.95);color:#000;font-size:13px;font-family:YouTube Sans,Roboto,Arial,sans-serif;padding:8px 16px 8px 12px;font-weight:600;cursor:pointer;border-radius:2px 0 0 2px;display:flex;align-items:center;gap:6px';
          visitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg> 광고주 사이트 방문';
          overlay.appendChild(visitBtn);

          // body에 직접 추가 (YouTube DOM 구조 무시)
          document.body.appendChild(overlay);

          console.log('[YouTube Inject] ✅ 프리롤 광고 인젝션 성공 (fixed 방식, ' + pw + 'x' + ph + ')');
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
   * YouTube 영상 페이지 우측 사이드바 상단에 배너 삽입
   */
  private async injectDisplayAd(page: IPageHandle, imgDataUrl: string): Promise<boolean> {
    console.log(`[YouTube] 📺 디스플레이 광고 인젝션 시작`);

    const result = await page.evaluate<boolean>(`
      (() => {
        const imgUrl = ${JSON.stringify(imgDataUrl)};

        // 사이드바 영역 찾기
        const sidebar = document.querySelector(
          '#secondary-inner, #secondary, ytd-watch-next-secondary-results-renderer, #related'
        );

        if (!sidebar) {
          console.warn('[YouTube Inject] 사이드바를 찾을 수 없습니다');
          return false;
        }

        // 컴패니언 배너 컨테이너
        const container = document.createElement('div');
        container.setAttribute('data-injected', 'admate-youtube-display');
        container.style.cssText = [
          'width: 300px !important',
          'margin: 0 auto 16px auto !important',
          'border-radius: 12px !important',
          'overflow: hidden !important',
          'box-shadow: 0 1px 6px rgba(0,0,0,0.1) !important',
          'border: 1px solid rgba(0,0,0,0.08) !important',
          'background: #fff !important',
        ].join(';');

        // "광고" 라벨 헤더
        const header = document.createElement('div');
        header.style.cssText = [
          'display: flex !important',
          'align-items: center !important',
          'justify-content: space-between !important',
          'padding: 6px 10px !important',
          'background: #f9f9f9 !important',
          'border-bottom: 1px solid rgba(0,0,0,0.06) !important',
        ].join(';');
        header.innerHTML = '<span style="font-size:11px;color:#606060;font-family:Roboto,Arial,sans-serif;font-weight:500;">스폰서 광고</span><svg width="14" height="14" viewBox="0 0 24 24" fill="#909090"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
        container.appendChild(header);

        // 배너 이미지
        const img = document.createElement('img');
        img.src = imgUrl;
        img.setAttribute('data-injected', 'admate');
        img.style.cssText = [
          'display: block !important',
          'width: 300px !important',
          'height: 250px !important',
          'object-fit: cover !important',
        ].join(';');
        container.appendChild(img);

        // CTA 푸터
        const footer = document.createElement('div');
        footer.style.cssText = [
          'padding: 8px 10px !important',
          'display: flex !important',
          'align-items: center !important',
          'gap: 8px !important',
          'background: #f9f9f9 !important',
          'border-top: 1px solid rgba(0,0,0,0.06) !important',
        ].join(';');
        footer.innerHTML = '<div style="width:28px;height:28px;border-radius:50%;background:#065fd4;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg></div><div><div style="font-size:12px;font-weight:500;color:#030303;font-family:Roboto,Arial,sans-serif;">광고주 사이트 방문</div><div style="font-size:11px;color:#606060;font-family:Roboto,Arial,sans-serif;">ad · Sponsored</div></div>';
        container.appendChild(footer);

        // 사이드바 최상단에 삽입
        sidebar.insertBefore(container, sidebar.firstChild);
        console.log('[YouTube Inject] ✅ 디스플레이 광고 인젝션 성공');
        return true;
      })()
    `);

    console.log(`[YouTube] 디스플레이 인젝션: ${result ? "✅ 성공" : "❌ 실패"}`);
    return result;
  }

  /**
   * 🎭 오버레이 광고 인젝션
   * 📌 전략: document.body에 fixed 포지션으로 플레이어 하단 위치에 오버레이
   */
  private async injectOverlayAd(
    page: IPageHandle,
    imgDataUrl: string,
    playerInfo: { found: boolean; width: number; height: number; top: number; left: number }
  ): Promise<boolean> {
    console.log(`[YouTube] 🎭 오버레이 광고 인젝션 시작 (fixed 포지션 방식)`);

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

          // 오버레이 배너 크기 (플레이어 너비의 70%, 높이 70px)
          const bannerW = Math.round(pw * 0.7);
          const bannerH = 70;
          // 플레이어 하단에서 80px 위
          const bannerTop = py + ph - bannerH - 80;
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
            'border-radius: 4px',
            'overflow: hidden',
            'display: flex',
            'align-items: stretch',
            'box-shadow: 0 2px 8px rgba(0,0,0,0.3)',
          ].join(' !important;') + ' !important';

          // 광고 이미지
          const img = document.createElement('img');
          img.src = imgUrl;
          img.setAttribute('data-injected', 'admate');
          img.style.cssText = 'height:100% !important;width:auto !important;object-fit:cover !important;flex-shrink:0 !important';
          overlay.appendChild(img);

          // 텍스트 영역
          const textArea = document.createElement('div');
          textArea.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:center;padding:8px 12px;min-width:0';
          textArea.innerHTML = '<div style="font-size:13px;font-weight:500;color:#fff;font-family:Roboto,Noto Sans KR,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">광고주 배너</div><div style="font-size:11px;color:#aaa;font-family:Roboto,Noto Sans KR,Arial,sans-serif;margin-top:2px;">ad · 자세히 보기</div>';
          overlay.appendChild(textArea);

          // 닫기 버튼
          const closeBtn = document.createElement('div');
          closeBtn.style.cssText = 'position:absolute;top:-8px;right:-8px;width:20px;height:20px;background:rgba(0,0,0,0.8);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483647;border:1px solid rgba(255,255,255,0.3)';
          closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
          overlay.appendChild(closeBtn);

          document.body.appendChild(overlay);

          console.log('[YouTube Inject] ✅ 오버레이 광고 인젝션 성공 (fixed 방식, ' + bannerW + 'x' + bannerH + ')');
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

  /** 🔤 한글 폰트 주입 — Vercel 서버리스 Chromium에 CJK 폰트 없는 문제 해결 */
  private async injectKoreanFonts(page: IPageHandle): Promise<void> {
    try {
      await page.evaluate<void>(`
        (() => {
          // 이미 주입됐으면 스킵
          if (document.querySelector('#admate-korean-fonts')) return;

          // Google Fonts 로드 (Noto Sans KR + Roboto)
          const link = document.createElement('link');
          link.id = 'admate-korean-fonts';
          link.rel = 'stylesheet';
          link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Roboto:wght@300;400;500;700&display=swap';
          document.head.appendChild(link);

          // 전체 페이지에 폰트 강제 적용
          const style = document.createElement('style');
          style.id = 'admate-korean-fonts-style';
          style.textContent = \`
            * {
              font-family: 'Roboto', 'Noto Sans KR', 'YouTube Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif !important;
            }
            /* YouTube 특정 요소에도 적용 */
            ytd-watch-flexy, ytd-compact-video-renderer, #title, #video-title,
            #description, #info, .ytd-video-primary-info-renderer,
            .ytd-video-secondary-info-renderer, #content-text,
            yt-formatted-string, span.yt-core-attributed-string {
              font-family: 'Roboto', 'Noto Sans KR', sans-serif !important;
            }
          \`;
          document.head.appendChild(style);

          console.log('[YouTube Inject] 🔤 한글 폰트 주입 완료');
        })()
      `);

      // 폰트 로드 대기
      await new Promise((r) => setTimeout(r, 1500));
      console.log(`[YouTube] 🔤 한글 폰트 인젝션 완료`);
    } catch (err) {
      console.warn(`[YouTube] 🔤 한글 폰트 인젝션 실패 (진행 계속):`, err);
    }
  }
}

