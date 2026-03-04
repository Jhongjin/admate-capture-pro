/**
 * PuppeteerEngine — @sparticuz/chromium + puppeteer-core 구현체
 *
 * ✅ puppeteer-extra-plugin-stealth의 핵심 회피 스크립트를 직접 내장
 *    → 외부 의존성 없이 Vercel 서버리스에서 안정적으로 작동
 *
 * 내장된 stealth 회피 모듈:
 *  1. navigator.webdriver 제거 (CDP + JS)
 *  2. chrome.runtime / chrome.app / chrome.csi / chrome.loadTimes 위장
 *  3. navigator.plugins / mimeTypes 위장
 *  4. WebGL vendor/renderer 위장
 *  5. permissions.query 위장
 *  6. iframe.contentWindow 감지 우회
 *  7. media codecs 위장 (YouTube 봇 감지 핵심)
 *  8. window.outerWidth/Height 위장 (headless 감지 차단)
 *  9. Error stack sourceURL 감지 방지
 * 10. canvas fingerprint 노이즈
 *
 * 로컬 개발: IS_LOCAL=true → 시스템 Chrome 사용
 * Vercel 배포: @sparticuz/chromium 서버리스 바이너리 사용
 */

import type {
  IBrowserEngine,
  IPageHandle,
  IScreenshotOptions,
  IViewport,
} from "./browser-engine";

// puppeteer-core는 동적 import (서버사이드에서만 로드)
type PuppeteerBrowser = import("puppeteer-core").Browser;
type PuppeteerPage = import("puppeteer-core").Page;

const DEFAULT_VIEWPORT: IViewport = {
  width: 2560,
  height: 1440,
  deviceScaleFactor: 2,
  isMobile: false,
};

/** Vercel 서버리스 환경용 뷰포트 (메모리 최적화) */
const VERCEL_VIEWPORT: IViewport = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
};

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-web-security",
  "--disable-features=VizDisplayCompositor",
  "--single-process",
];

/**
 * 🛡️ Stealth 회피 스크립트 (puppeteer-extra-plugin-stealth 핵심 로직 직접 구현)
 *
 * 이 스크립트는 evaluateOnNewDocument로 모든 페이지 로드 전에 실행되어
 * 봇 감지 시스템이 확인하는 모든 브라우저 지문을 위장합니다.
 */
const STEALTH_EVASION_SCRIPT = `
(() => {
  // ═══════════════════════════════════════════════════
  // 1. navigator.webdriver 제거 (다중 방어)
  // ═══════════════════════════════════════════════════
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
  // prototype 에서도 제거
  delete Object.getPrototypeOf(navigator).webdriver;

  // ═══════════════════════════════════════════════════
  // 2. chrome 객체 완벽 위장
  // ═══════════════════════════════════════════════════
  window.chrome = window.chrome || {};

  // chrome.runtime
  window.chrome.runtime = {
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: () => {}, removeListener: () => {} },
    connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
    sendMessage: () => {},
    id: undefined,
    getURL: (path) => '',
    getManifest: () => ({}),
    getPlatformInfo: (cb) => cb && cb({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' }),
  };

  // chrome.app
  window.chrome.app = {
    isInstalled: false,
    InstallState: { INSTALLED: 'installed', NOT_INSTALLED: 'not_installed', DISABLED: 'disabled' },
    RunningState: { RUNNING: 'running', CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run' },
    getDetails: () => null,
    getIsInstalled: () => false,
    installState: (cb) => cb && cb('not_installed'),
  };

  // chrome.csi (성능 정보)
  window.chrome.csi = function() {
    return {
      onloadT: Date.now(),
      startE: Date.now() - Math.floor(Math.random() * 1000),
      pageT: Math.random() * 5000 + 1000,
      tran: 15,
    };
  };

  // chrome.loadTimes (페이지 로드 타이밍)
  window.chrome.loadTimes = function() {
    return {
      commitLoadTime: Date.now() / 1000,
      connectionInfo: 'h2',
      finishDocumentLoadTime: Date.now() / 1000 + 0.1,
      finishLoadTime: Date.now() / 1000 + 0.2,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: Date.now() / 1000 + 0.05,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: Date.now() / 1000 - 0.3,
      startLoadTime: Date.now() / 1000 - 0.3,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  };

  // ═══════════════════════════════════════════════════
  // 3. navigator.languages 설정
  // ═══════════════════════════════════════════════════
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'language', { get: () => 'ko-KR' });

  // ═══════════════════════════════════════════════════
  // 4. navigator.plugins 위장 (빈 배열이면 봇으로 감지)
  // ═══════════════════════════════════════════════════
  const makePluginArray = () => {
    const plugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1,
        item: () => ({ type: 'application/x-google-chrome-pdf' }),
        namedItem: () => ({ type: 'application/x-google-chrome-pdf' })
      },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1,
        item: () => ({ type: 'application/pdf' }),
        namedItem: () => ({ type: 'application/pdf' })
      },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2,
        item: () => null,
        namedItem: () => null
      },
    ];
    plugins.refresh = () => {};
    plugins.item = (i) => plugins[i] || null;
    plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
    Object.setPrototypeOf(plugins, PluginArray.prototype);
    return plugins;
  };

  Object.defineProperty(navigator, 'plugins', { get: makePluginArray });

  // ═══════════════════════════════════════════════════
  // 5. navigator.mimeTypes 위장
  // ═══════════════════════════════════════════════════
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const mimes = [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      ];
      mimes.item = (i) => mimes[i] || null;
      mimes.namedItem = (name) => mimes.find(m => m.type === name) || null;
      mimes.refresh = () => {};
      return mimes;
    },
  });

  // ═══════════════════════════════════════════════════
  // 6. permissions.query 위장
  // ═══════════════════════════════════════════════════
  const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission || 'default', onchange: null });
    }
    return origQuery(parameters).catch(() =>
      Promise.resolve({ state: 'prompt', onchange: null })
    );
  };

  // ═══════════════════════════════════════════════════
  // 7. WebGL 렌더러 위장
  // ═══════════════════════════════════════════════════
  const getParameterProxyHandler = {
    apply: function(target, thisArg, args) {
      const param = args[0];
      // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return 'Intel Inc.';
      // UNMASKED_RENDERER_WEBGL
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return Reflect.apply(target, thisArg, args);
    },
  };
  if (typeof WebGLRenderingContext !== 'undefined') {
    WebGLRenderingContext.prototype.getParameter = new Proxy(
      WebGLRenderingContext.prototype.getParameter, getParameterProxyHandler
    );
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    WebGL2RenderingContext.prototype.getParameter = new Proxy(
      WebGL2RenderingContext.prototype.getParameter, getParameterProxyHandler
    );
  }

  // ═══════════════════════════════════════════════════
  // 8. 🎬 Media Codecs 위장 (YouTube 봇 감지 핵심!)
  //    Headless에서는 미디어 코덱이 없어서 봇으로 판정됨
  // ═══════════════════════════════════════════════════
  const origCanPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function(type) {
    // 실제 Chrome에서 지원하는 코덱들
    const supportedTypes = {
      'video/webm; codecs="vp8"': 'probably',
      'video/webm; codecs="vp9"': 'probably',
      'video/webm; codecs="vp8, vorbis"': 'probably',
      'video/webm; codecs="vp9, opus"': 'probably',
      'video/mp4; codecs="avc1.42E01E"': 'probably',
      'video/mp4; codecs="avc1.42E01E, mp4a.40.2"': 'probably',
      'video/mp4; codecs="avc1.4D401E"': 'probably',
      'video/mp4; codecs="avc1.64001E"': 'probably',
      'video/mp4; codecs="avc1.640028"': 'probably',
      'video/mp4; codecs="avc1.640028, mp4a.40.2"': 'probably',
      'audio/webm; codecs="opus"': 'probably',
      'audio/webm; codecs="vorbis"': 'probably',
      'audio/mp4; codecs="mp4a.40.2"': 'probably',
      'audio/mpeg': 'probably',
      'audio/ogg; codecs="vorbis"': 'probably',
      'audio/ogg; codecs="opus"': 'probably',
      'audio/wav; codecs="1"': 'probably',
      'audio/flac': 'probably',
      'video/ogg; codecs="theora"': 'probably',
    };
    // 정확한 매칭
    if (supportedTypes[type]) return supportedTypes[type];
    // 부분 매칭 (코덱 없이 MIME만 있는 경우)
    if (type && (type.startsWith('video/mp4') || type.startsWith('video/webm'))) return 'maybe';
    if (type && (type.startsWith('audio/mp4') || type.startsWith('audio/webm') || type.startsWith('audio/mpeg'))) return 'maybe';
    // 원래 함수 호출
    return origCanPlayType.call(this, type);
  };

  // MediaRecorder 지원 위장
  if (typeof MediaRecorder !== 'undefined') {
    const origIsTypeSupported = MediaRecorder.isTypeSupported;
    MediaRecorder.isTypeSupported = function(type) {
      if (type && (type.includes('video/webm') || type.includes('audio/webm'))) return true;
      return origIsTypeSupported.call(this, type);
    };
  }

  // MediaSource 지원 위장
  if (typeof MediaSource !== 'undefined') {
    const origMSisTypeSupported = MediaSource.isTypeSupported;
    MediaSource.isTypeSupported = function(type) {
      if (type && (
        type.includes('video/mp4') || type.includes('video/webm') ||
        type.includes('audio/mp4') || type.includes('audio/webm')
      )) return true;
      return origMSisTypeSupported.call(this, type);
    };
  }

  // ═══════════════════════════════════════════════════
  // 9. window.outerWidth/Height 위장 (headless 감지 차단)
  //    Headless에서는 outerWidth/Height가 0이거나 innerWidth와 다름
  // ═══════════════════════════════════════════════════
  Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
  Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 85 }); // 브라우저 UI 높이

  // screenX/screenY도 합리적 값으로
  if (window.screenX === 0 && window.screenY === 0) {
    Object.defineProperty(window, 'screenX', { get: () => 0 });
    Object.defineProperty(window, 'screenY', { get: () => 30 }); // 작업표시줄 높이
  }

  // ═══════════════════════════════════════════════════
  // 10. iframe contentWindow 감지 우회
  //     Headless에서는 cross-origin iframe의 contentWindow 접근 시 차이가 남
  // ═══════════════════════════════════════════════════
  try {
    // iframe 생성 시 자동으로 sandbox 해제하지 않음 (정상 브라우저 동작 모방)
    const origCreateElement = document.createElement.bind(document);
    document.createElement = function(...args) {
      const el = origCreateElement(...args);
      if (args[0] && args[0].toLowerCase() === 'iframe') {
        // contentWindow에 접근 시 정상적인 응답 반환하도록 설정
        Object.defineProperty(el, 'contentWindow', {
          get: function() {
            try {
              return Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.call(this);
            } catch(e) {
              return window;
            }
          },
          configurable: true,
        });
      }
      return el;
    };
  } catch(e) { /* 실패해도 무시 */ }

  // ═══════════════════════════════════════════════════
  // 11. Error stack sourceURL 감지 방지
  //     페이지가 Error.stack을 검사하여 puppeteer의 evaluate 호출을 감지
  // ═══════════════════════════════════════════════════
  const origError = Error;
  Object.defineProperty(Error.prototype, 'stack', {
    configurable: true,
    get: function() {
      const stack = origError.prototype.stack;
      if (typeof stack === 'string') {
        // pptr:// 프로토콜 참조 제거
        return stack.replace(/pptr:\\/\\/[^\\s]+/g, '');
      }
      return stack;
    }
  });

  // ═══════════════════════════════════════════════════
  // 12. canvas fingerprint 노이즈
  // ═══════════════════════════════════════════════════
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type) {
    if (type === 'image/png' || !type) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        const style = ctx.fillStyle;
        ctx.fillStyle = 'rgba(255,255,255,0.003)';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = style;
      }
    }
    return origToDataURL.apply(this, arguments);
  };

  // ═══════════════════════════════════════════════════
  // 13. connection / network 정보 위장
  // ═══════════════════════════════════════════════════
  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
    Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
  }

  // ═══════════════════════════════════════════════════
  // 14. hardwareConcurrency & deviceMemory 위장
  // ═══════════════════════════════════════════════════
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

  // ═══════════════════════════════════════════════════
  // 15. Notification 위장 (headless에서 undefined인 경우)
  // ═══════════════════════════════════════════════════
  if (typeof Notification === 'undefined') {
    window.Notification = { permission: 'default', requestPermission: () => Promise.resolve('default') };
  }

  // ═══════════════════════════════════════════════════
  // 16. 콘솔 함수 toString 위장
  //     봇 감지가 함수를 toString()해서 native code인지 확인
  // ═══════════════════════════════════════════════════
  const nativeToString = Function.prototype.toString;
  const fakeNative = new Map();

  // 위장한 함수들의 toString을 native처럼 보이게
  const patchToString = (fn, name) => {
    fakeNative.set(fn, \`function \${name || fn.name || ''}() { [native code] }\`);
  };

  Function.prototype.toString = function() {
    if (fakeNative.has(this)) return fakeNative.get(this);
    return nativeToString.call(this);
  };

  // 주요 위장 함수들 등록
  patchToString(Function.prototype.toString, 'toString');
  patchToString(navigator.permissions.query, 'query');
  patchToString(HTMLMediaElement.prototype.canPlayType, 'canPlayType');

  console.log('[Stealth] ✅ All evasion modules loaded');
})();
`;

/** Puppeteer Page를 IPageHandle 인터페이스에 맞게 감싸는 어댑터 */
class PuppeteerPageHandle implements IPageHandle {
  constructor(private page: PuppeteerPage) {}

  async goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2"; timeout?: number }
  ): Promise<void> {
    await this.page.goto(url, {
      waitUntil: options?.waitUntil ?? "networkidle2",
      timeout: options?.timeout ?? 30000,
    });
  }

  async screenshot(options?: IScreenshotOptions): Promise<Buffer> {
    const result = await this.page.screenshot({
      fullPage: options?.fullPage ?? false,
      quality: options?.type === "png" ? undefined : (options?.quality ?? 90),
      type: options?.type ?? "png",
      clip: options?.clip,
      encoding: "binary",
    });
    return Buffer.from(result);
  }

  async evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    return await this.page.evaluate(fn as never, ...args);
  }

  async evaluateOnNewDocument(fn: string | ((...args: unknown[]) => void)): Promise<void> {
    await this.page.evaluateOnNewDocument(fn as never);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async waitForSelector(
    selector: string,
    options?: { timeout?: number; visible?: boolean }
  ): Promise<void> {
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 5000,
      visible: options?.visible,
    });
  }

  async waitForNavigation(options?: { waitUntil?: string; timeout?: number }): Promise<void> {
    await this.page.waitForNavigation({
      waitUntil: (options?.waitUntil as "load" | "networkidle2") ?? "networkidle2",
      timeout: options?.timeout ?? 30000,
    });
  }

  async setViewport(viewport: IViewport): Promise<void> {
    await this.page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 2,
      isMobile: viewport.isMobile ?? false,
    });
  }

  async setBypassCSP(enabled: boolean): Promise<void> {
    await this.page.setBypassCSP(enabled);
  }

  async setCookie(cookie: { name: string; value: string; domain?: string; path?: string }): Promise<void> {
    await this.page.setCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path ?? "/",
    });
  }

  url(): string {
    return this.page.url();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

export class PuppeteerEngine implements IBrowserEngine {
  private browser: PuppeteerBrowser | null = null;

  /** /tmp의 기존 Chromium 프로세스를 정리 (ETXTBSY 방지) */
  private async cleanupStaleChromium(): Promise<void> {
    if (process.env.IS_LOCAL === "true") return;
    try {
      const { execSync } = await import("child_process");
      execSync("pkill -9 -f chromium 2>/dev/null || true", { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 500));
      console.log("[PuppeteerEngine] 🧹 기존 Chromium 프로세스 정리 완료");
    } catch {
      // 실패해도 무시
    }
  }

  async launch(): Promise<void> {
    const puppeteer = await import("puppeteer-core");
    const isLocal = process.env.IS_LOCAL === "true";

    if (isLocal) {
      const localPath = await this.findLocalChrome();
      this.browser = await puppeteer.default.launch({
        args: BROWSER_ARGS,
        defaultViewport: DEFAULT_VIEWPORT,
        executablePath: localPath,
        headless: false,
      });
    } else {
      await this.cleanupStaleChromium();

      const chromiumModule = await import("@sparticuz/chromium-min");
      const chromium = (chromiumModule as any).default || chromiumModule;
      const execPath = await chromium.executablePath(
        "https://github.com/Sparticuz/chromium/releases/download/v143.0.0/chromium-v143.0.0-pack.x64.tar"
      );

      const MAX_RETRIES = 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          this.browser = await puppeteer.default.launch({
            args: [...chromium.args, "--hide-scrollbars", "--disable-web-security"],
            defaultViewport: VERCEL_VIEWPORT,
            executablePath: execPath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
          } as any);
          console.log(`[PuppeteerEngine] 🚀 Chromium + Built-in Stealth 시작 성공 (시도 ${attempt}/${MAX_RETRIES})`);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const isETXTBSY = lastError.message.includes("ETXTBSY");

          if (isETXTBSY && attempt < MAX_RETRIES) {
            const delay = attempt * 2000;
            console.warn(`[PuppeteerEngine] ⚠️ ETXTBSY 발생, ${delay}ms 후 재시도 (${attempt}/${MAX_RETRIES})`);
            await this.cleanupStaleChromium();
            try {
              const fs = await import("fs");
              if (fs.existsSync(execPath)) {
                fs.unlinkSync(execPath);
                console.log(`[PuppeteerEngine] 🗑️ 기존 바이너리 삭제: ${execPath}`);
              }
            } catch { /* 무시 */ }
            await new Promise((r) => setTimeout(r, delay));
          } else {
            throw lastError;
          }
        }
      }

      throw lastError || new Error("Chromium launch failed after all retries");
    }
  }

  async newPage(): Promise<IPageHandle> {
    if (!this.browser) throw new Error("Browser not launched. Call launch() first.");
    const page = await this.browser.newPage();

    // 🔑 0) CDP 프로토콜로 webdriver 플래그 근본 제거 + User-Agent Client Hints 설정
    const client = (page as any)._client?.();
    if (client) {
      try {
        await client.send('Page.addScriptToEvaluateOnNewDocument', {
          source: 'Object.defineProperty(navigator, "webdriver", {get: () => undefined})',
        });
        await client.send('Network.setUserAgentOverride', {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          platform: 'Win32',
          userAgentMetadata: {
            brands: [
              { brand: 'Google Chrome', version: '131' },
              { brand: 'Chromium', version: '131' },
              { brand: 'Not_A Brand', version: '24' },
            ],
            fullVersion: '131.0.6778.109',
            platform: 'Windows',
            platformVersion: '15.0.0',
            architecture: 'x86',
            model: '',
            mobile: false,
          },
        });
      } catch (cdpErr) {
        console.warn('[PuppeteerEngine] CDP 설정 실패 (비치명적):', cdpErr);
      }
    }

    // 🔑 1) User-Agent 설정
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // 🔑 2) 통합 Stealth 회피 스크립트 주입 (16개 모듈)
    await page.evaluateOnNewDocument(STEALTH_EVASION_SCRIPT);

    // 3) CSP 우회 — 외부 이미지 인젝션 허용
    await page.setBypassCSP(true);

    // 4) Extra HTTP 헤더 설정
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    });

    // 5) 🔤 한글 폰트 자동 주입 — Vercel 서버리스 Chromium에 CJK 폰트 없는 문제 해결
  //    evaluateOnNewDocument로 페이지 로드 전에 주입 → 폰트가 먼저 로드됨
  await page.evaluateOnNewDocument(`
    (() => {
      // DOM이 준비되면 폰트 주입
      const injectFonts = () => {
        if (document.querySelector('#admate-cjk-fonts')) return;

        // preconnect
        const preconnect = document.createElement('link');
        preconnect.rel = 'preconnect';
        preconnect.href = 'https://fonts.gstatic.com';
        preconnect.crossOrigin = 'anonymous';
        document.head.appendChild(preconnect);

        // Google Fonts CSS
        const link = document.createElement('link');
        link.id = 'admate-cjk-fonts';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Roboto:wght@300;400;500;700&display=swap';
        document.head.appendChild(link);

        // 전체 페이지에 폰트 강제 적용
        const style = document.createElement('style');
        style.id = 'admate-cjk-fonts-style';
        style.textContent = [
          '*, *::before, *::after {',
          "  font-family: 'Noto Sans KR', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif !important;",
          '}',
        ].join('\\n');
        document.head.appendChild(style);
      };

      if (document.head) {
        injectFonts();
      } else {
        document.addEventListener('DOMContentLoaded', injectFonts);
      }
    })()
  `);

  return new PuppeteerPageHandle(page);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /** 로컬 Chrome 실행 경로 자동 탐지 */
  private async findLocalChrome(): Promise<string> {
    const paths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
    ];

    const fs = await import("fs");
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }

    throw new Error(
      "로컬 Chrome을 찾을 수 없습니다. Chrome을 설치하거나 IS_LOCAL 설정을 확인해주세요."
    );
  }
}
