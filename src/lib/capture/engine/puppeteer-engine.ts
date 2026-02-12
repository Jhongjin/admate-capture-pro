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

  url(): string {
    return this.page.url();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

export class PuppeteerEngine implements IBrowserEngine {
  private browser: PuppeteerBrowser | null = null;

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
      // Vercel: @sparticuz/chromium 서버리스 바이너리
      const chromium = (await import("@sparticuz/chromium")) as any;
      this.browser = await puppeteer.default.launch({
        args: [...chromium.default.args, "--hide-scrollbars", "--disable-web-security"],
        defaultViewport: chromium.default.defaultViewport,
        executablePath: await chromium.default.executablePath(),
        headless: chromium.default.headless,
        ignoreHTTPSErrors: true,
      } as any);
    }
  }

  async newPage(): Promise<IPageHandle> {
    if (!this.browser) throw new Error("Browser not launched. Call launch() first.");
    const page = await this.browser.newPage();

    // User-Agent 설정 (봇 감지 우회)
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

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
