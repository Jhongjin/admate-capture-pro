/**
 * Capture Module — 최상위 팩토리 + 타입 통합 익스포트
 *
 * 사용 예시:
 *   import { createChannel } from "@/lib/capture";
 *   const channel = createChannel("gdn");
 *   const result = await channel.execute(request);
 */

import type { BaseChannel } from "./channels/base-channel";
import type { IBrowserEngine } from "./engine/browser-engine";
import { GdnCapture } from "./channels/gdn-capture";

export type ChannelType = "gdn" | "youtube" | "meta" | "naver";

/**
 * 매체 타입에 따른 캡처 채널 팩토리
 * @param engine 공유 브라우저 엔진 (배치 실행 시 전달)
 */
export function createChannel(type: ChannelType, engine?: IBrowserEngine): BaseChannel {
  switch (type) {
    case "gdn":
      return new GdnCapture(engine);
    // 향후 확장
    // case "youtube":
    //   return new YouTubeCapture(engine);
    // case "meta":
    //   return new MetaCapture(engine);
    // case "naver":
    //   return new NaverCapture(engine);
    default:
      throw new Error(`지원하지 않는 매체 타입: ${type}`);
  }
}

// 타입 재익스포트
export type { CaptureResult, CaptureRequest } from "./channels/base-channel";
export type { IBrowserEngine, IPageHandle } from "./engine/browser-engine";
export type { DetectedSlot } from "./injection/ad-slot-detector";
