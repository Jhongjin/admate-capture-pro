/**
 * PuppeteerEngine — @sparticuz/chromium + puppeteer-core 구현체
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

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-web-security",
  "--disable-features=VizDisplayCompositor",
  "--single-process",
];

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
      // 이전 실행에서 남은 좀비 Chromium 프로세스 kill
      execSync("pkill -9 -f chromium 2>/dev/null || true", { timeout: 3000 });
      // /tmp 의 chromium 바이너리 lock 해제를 위해 잠시 대기
      await new Promise((r) => setTimeout(r, 500));
      console.log("[PuppeteerEngine] 🧹 기존 Chromium 프로세스 정리 완료");
    } catch {
      // 실패해도 무시 — 정상 동작에 영향 없음
    }
  }

  async launch(): Promise<void> {
    const puppeteer = await import("puppeteer-core");
    const isLocal = process.env.IS_LOCAL === "true";

    if (isLocal) {
      // 로컬: 시스템에 설치된 Chrome 사용
      const localPath = await this.findLocalChrome();
      this.browser = await puppeteer.default.launch({
        args: BROWSER_ARGS,
        defaultViewport: DEFAULT_VIEWPORT,
        executablePath: localPath,
        headless: false,
      });
    } else {
      // 🔑 Vercel: 기존 프로세스 정리 후 재시도 로직
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
            defaultViewport: chromium.defaultViewport,
            executablePath: execPath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
          } as any);
          console.log(`[PuppeteerEngine] 🚀 Chromium 시작 성공 (시도 ${attempt}/${MAX_RETRIES})`);
          return; // 성공하면 즉시 반환
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const isETXTBSY = lastError.message.includes("ETXTBSY");

          if (isETXTBSY && attempt < MAX_RETRIES) {
            const delay = attempt * 2000; // 2초, 4초 대기
            console.warn(`[PuppeteerEngine] ⚠️ ETXTBSY 발생, ${delay}ms 후 재시도 (${attempt}/${MAX_RETRIES})`);
            // 다시 정리
            await this.cleanupStaleChromium();
            // /tmp에서 바이너리 파일 삭제하여 재추출 강제
            try {
              const fs = await import("fs");
              if (fs.existsSync(execPath)) {
                fs.unlinkSync(execPath);
                console.log(`[PuppeteerEngine] 🗑️ 기존 바이너리 삭제: ${execPath}`);
              }
            } catch { /* 무시 */ }
            await new Promise((r) => setTimeout(r, delay));
            // executablePath 재추출
            // chromium-min은 내부적으로 파일이 없으면 다시 추출함
          } else {
            throw lastError;
          }
        }
      }

      // 모든 재시도 실패
      throw lastError || new Error("Chromium launch failed after all retries");
    }
  }

  async newPage(): Promise<IPageHandle> {
    if (!this.browser) throw new Error("Browser not launched. Call launch() first.");
    const page = await this.browser.newPage();

    // User-Agent 설정 (봇 감지 우회)
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // CSP 우회 — 외부 이미지 인젝션 허용
    await page.setBypassCSP(true);

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
      // Windows
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      // macOS
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      // Linux
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
