/**
 * POST /api/captures/execute — 캡처 실행 엔드포인트
 *
 * ⭐ Vercel Function 설정: maxDuration=300s, memory=3009MB (vercel.json)
 * table: vision_da_captures
 *
 * v2: 배치 실행 지원 — 여러 captureId를 하나의 브라우저로 순차 처리
 *     (spawn ETXTBSY 방지: Chromium 동시 실행 문제 해결)
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/client";
import { createChannel } from "@/lib/capture";
import type { VisionDaCaptureRow, ChannelType } from "@/lib/supabase/types";
import { PuppeteerEngine } from "@/lib/capture/engine/puppeteer-engine";

export const maxDuration = 300; // 5분
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();

    // 배치 지원: captureIds 배열 또는 단일 captureId
    const captureIds: string[] = body.captureIds
      ? body.captureIds
      : body.captureId
        ? [body.captureId]
        : [];

    if (captureIds.length === 0) {
      return NextResponse.json({ error: "captureId(s)는 필수입니다." }, { status: 400 });
    }

    const supabase = createServerClient();
    const results: Array<{ captureId: string; success: boolean; error?: string; durationMs?: number }> = [];

    // 🔑 핵심: 하나의 브라우저 엔진을 공유하여 순차 실행
    const sharedEngine = new PuppeteerEngine();
    let engineLaunched = false;

    try {
      for (const captureId of captureIds) {
        const captureStart = Date.now();

        try {
          // 1) 캡처 요청 조회
          const { data, error: fetchError } = await supabase
            .from("vision_da_captures")
            .select("*")
            .eq("id", captureId)
            .single();

          if (fetchError || !data) {
            results.push({ captureId, success: false, error: `캡처 요청을 찾을 수 없습니다: ${captureId}` });
            continue;
          }

          const capture = data as unknown as VisionDaCaptureRow;

          // 이미 처리 중이거나 완료된 경우 건너뛰기
          if (capture.status !== "pending") {
            results.push({ captureId, success: false, error: `이미 처리된 요청입니다 (status: ${capture.status})` });
            continue;
          }

          // 2) 상태 업데이트 → processing
          await supabase
            .from("vision_da_captures")
            .update({ status: "processing", updated_at: new Date().toISOString() })
            .eq("id", captureId);

          // 3) 브라우저 엔진 초기화 (최초 1회만)
          if (!engineLaunched) {
            await sharedEngine.launch();
            engineLaunched = true;
            console.log(`[Execute] 🚀 공유 브라우저 엔진 시작 (배치: ${captureIds.length}건)`);
          }

          // 4) 매체별 캡처 채널 생성 (공유 엔진 전달)
          const channel = createChannel(capture.channel as ChannelType, sharedEngine);

          // 5) 캡처 실행
          const captureMetadata = (capture as any).metadata ?? {};
          const result = await channel.execute({
            publisherUrl: capture.source_url ?? "",
            creativeUrl: capture.creative_url,
            captureLanding: capture.capture_landing,
            clickUrl: capture.click_url ?? undefined,
            options: {
              injectionMode: captureMetadata.injectionMode ?? "single",
              slotCount: captureMetadata.slotCount ?? 1,
            },
          });

          // 6) Supabase Storage에 업로드
          const timestamp = Date.now();
          const basePath = `captures/${captureId}`;

          // 게재면 스크린샷 업로드
          const placementPath = `${basePath}/placement_${timestamp}.png`;
          const { error: uploadError } = await supabase.storage
            .from("capture-images")
            .upload(placementPath, result.placementScreenshot, {
              contentType: "image/png",
              upsert: true,
            });

          if (uploadError) {
            throw new Error(`게재면 이미지 업로드 실패: ${uploadError.message}`);
          }

          const { data: placementUrlData } = supabase.storage
            .from("capture-images")
            .getPublicUrl(placementPath);

          // 랜딩 스크린샷 업로드 (있는 경우)
          let landingPublicUrl: string | null = null;
          if (result.landingScreenshot) {
            const landingPath = `${basePath}/landing_${timestamp}.png`;
            await supabase.storage
              .from("capture-images")
              .upload(landingPath, result.landingScreenshot, {
                contentType: "image/png",
                upsert: true,
              });

            const { data: landingUrlData } = supabase.storage
              .from("capture-images")
              .getPublicUrl(landingPath);

            landingPublicUrl = landingUrlData.publicUrl;
          }

          // 7) DB 업데이트 → completed
          const durationMs = Date.now() - captureStart;

          // 진단 정보 수집 (GdnCapture인 경우)
          const diagnostics = (channel as any).getDiagnostics?.() ?? null;

          await supabase
            .from("vision_da_captures")
            .update({
              status: "completed",
              placement_image_url: placementUrlData.publicUrl,
              screenshot_storage_path: placementPath,
              landing_image_url: landingPublicUrl,
              landing_final_url: result.landingUrl ?? null,
              metadata: {
                capturedAt: result.capturedAt,
                durationMs,
                diagnostics,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", captureId);

          console.log(`[Execute] ✅ 캡처 완료: ${captureId} (${durationMs}ms)`);
          results.push({ captureId, success: true, durationMs });

        } catch (captureError) {
          // 개별 캡처 실패 → DB 상태 업데이트 후 다음 캡처 계속
          const errorMessage = captureError instanceof Error ? captureError.message : "알 수 없는 오류";

          await supabase
            .from("vision_da_captures")
            .update({
              status: "failed",
              error_message: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", captureId);

          console.error(`[Execute] ❌ 캡처 실패: ${captureId}`, captureError);
          results.push({ captureId, success: false, error: errorMessage });
        }
      }
    } finally {
      // 🔑 모든 캡처 완료 후 브라우저 종료
      if (engineLaunched) {
        await sharedEngine.close();
        console.log(`[Execute] 🛑 공유 브라우저 엔진 종료`);
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;

    console.log(`[Execute] 📊 배치 완료: ${successCount}/${results.length}건 성공 (${totalDuration}ms)`);

    return NextResponse.json({
      success: successCount > 0,
      results,
      totalDuration,
      batch: captureIds.length > 1,
    });

  } catch (err) {
    console.error("[Execute] 요청 처리 오류:", err);
    return NextResponse.json(
      { error: "서버 내부 오류" },
      { status: 500 }
    );
  }
}
