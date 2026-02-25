/**
 * POST /api/captures/execute — 캡처 실행 엔드포인트
 *
 * ⭐ Vercel Function 설정: maxDuration=300s, memory=3009MB (vercel.json)
 * table: vision_da_captures
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/client";
import { createChannel } from "@/lib/capture";
import { GdnCapture } from "@/lib/capture/channels/gdn-capture";
import type { VisionDaCaptureRow, ChannelType } from "@/lib/supabase/types";

export const maxDuration = 300; // 5분
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { captureId } = (await request.json()) as { captureId: string };

    if (!captureId) {
      return NextResponse.json({ error: "captureId는 필수입니다." }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1) 캡처 요청 조회 (vision_da_captures)
    const { data, error: fetchError } = await supabase
      .from("vision_da_captures")
      .select("*")
      .eq("id", captureId)
      .single();

    if (fetchError || !data) {
      return NextResponse.json(
        { error: `캡처 요청을 찾을 수 없습니다: ${captureId}` },
        { status: 404 }
      );
    }

    // 명시적 타입 캐스팅 (VisionDaCaptureRow)
    const capture = data as unknown as VisionDaCaptureRow;

    // 이미 처리 중이거나 완료된 경우
    if (capture.status !== "pending") {
      return NextResponse.json(
        { error: `이미 처리된 요청입니다 (status: ${capture.status})` },
        { status: 409 }
      );
    }

    // 2) 상태 업데이트 → processing
    await supabase
      .from("vision_da_captures")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", captureId);

    try {
      // 3) 매체별 캡처 채널 생성
      const channel = createChannel(capture.channel as ChannelType);

      // 4) 캡처 실행
      // source_url(기존 컬럼)을 publisherUrl로 사용
      const result = await channel.execute({
        publisherUrl: capture.source_url ?? "", // source_url -> publisherUrl
        creativeUrl: capture.creative_url,
        captureLanding: capture.capture_landing,
        clickUrl: capture.click_url ?? undefined,
      });

      // 5) Supabase Storage에 업로드
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

      // 6) DB 업데이트 → completed (vision_da_captures)
      const durationMs = Date.now() - startTime;

      // 진단 정보 수집 (GdnCapture인 경우)
      const diagnostics = (channel as any).getDiagnostics?.() ?? null;

      await supabase
        .from("vision_da_captures")
        .update({
          status: "completed",
          placement_image_url: placementUrlData.publicUrl,
          screenshot_storage_path: placementPath, // 기존 컬럼 호환
          landing_image_url: landingPublicUrl,
          landing_final_url: result.landingUrl ?? null,
          metadata: {
            capturedAt: result.capturedAt,
            durationMs,
            diagnostics, // 슬롯 탐지/인젝션 진단 정보
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", captureId);

      console.log(`[Execute] ✅ 캡처 완료: ${captureId} (${durationMs}ms)`);

      return NextResponse.json({
        success: true,
        captureId,
        durationMs,
        placementUrl: placementUrlData.publicUrl,
        landingUrl: landingPublicUrl,
      });
    } catch (captureError) {
      // 캡처 실패 → DB 상태 업데이트
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

      return NextResponse.json(
        { error: errorMessage, captureId },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[Execute] 요청 처리 오류:", err);
    return NextResponse.json(
      { error: "서버 내부 오류" },
      { status: 500 }
    );
  }
}
