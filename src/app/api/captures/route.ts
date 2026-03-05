/**
 * POST /api/captures — 캡처 요청 생성 + 배치 실행
 * GET  /api/captures — 캡처 목록 조회
 *
 * v3: Next.js `after()` 사용 — 응답 반환 후 백그라운드에서 배치 캡처 실행
 *     (fire-and-forget fetch 대신 after()로 Vercel 컨테이너 유지 보장)
 */

import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { createServerClient } from "@/lib/supabase/client";
import { createChannel } from "@/lib/capture";
import { PuppeteerEngine } from "@/lib/capture/engine/puppeteer-engine";
import type { ChannelType, VisionDaCaptureRow } from "@/lib/supabase/types";

export const maxDuration = 300; // 5분
export const dynamic = "force-dynamic";

/** POST: 새 캡처 요청 생성 (멀티 사이트 지원) */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 입력 검증
    const {
      channel,
      publisherUrl,      // 단일 (하위 호환)
      publisherUrls,     // 멀티 사이트 (배열)
      creativeUrl,
      clickUrl,
      captureLanding,
      injectionMode = "single",  // "single" | "all" | "custom"
      slotCount = 1,             // custom 모드일 때 슬롯 수
      creativeDimensions,        // 📐 배너 사이즈 {width, height}
      adSizeMode = "auto",       // 📐 "auto" | "manual"
      targetAdSizes = [],        // 📐 수동 선택한 사이즈 배열
      youtubeAdType,             // 🎬 YouTube 광고 유형
      instreamOpts,              // 🎬 인스트림 광고 옵션
    } = body as {
      channel: ChannelType;
      publisherUrl?: string;
      publisherUrls?: string[];
      creativeUrl: string;
      clickUrl?: string;
      captureLanding?: boolean;
      injectionMode?: "single" | "all" | "custom";
      slotCount?: number;
      creativeDimensions?: { width: number; height: number };
      adSizeMode?: "auto" | "manual";
      targetAdSizes?: string[];
      youtubeAdType?: "preroll" | "display" | "overlay";
      instreamOpts?: {
        adTitle?: string;
        ctaText?: string;
        landingUrl?: string;
        companionImageUrl?: string;
      };
    };

    // URL 배열 통합
    const urls: string[] = publisherUrls?.length
      ? publisherUrls
      : publisherUrl
        ? [publisherUrl]
        : [];

    if (!channel || urls.length === 0 || !creativeUrl) {
      return NextResponse.json(
        { error: "channel, publisherUrl(s), creativeUrl는 필수입니다." },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const createdCaptures: any[] = [];

    // 각 URL마다 캡처 요청 생성
    for (const url of urls) {
      const { data, error } = await supabase
        .from("vision_da_captures")
        .insert({
          channel,
          source_url: url,
          creative_url: creativeUrl,
          click_url: clickUrl ?? null,
          capture_landing: captureLanding ?? false,
          status: "pending",
          metadata: { injectionMode, slotCount, creativeDimensions, adSizeMode, targetAdSizes, youtubeAdType, instreamOpts },
        })
        .select()
        .single();

      if (error) {
        console.error("[API] captures insert error:", error);
        continue;
      }

      createdCaptures.push(data);
    }

    if (createdCaptures.length === 0) {
      return NextResponse.json({ error: "캡처 요청 생성에 실패했습니다." }, { status: 500 });
    }

    // 🔑 after() — 응답 반환 후 백그라운드에서 배치 캡처 실행
    // Vercel이 이 콜백 완료까지 컨테이너를 유지합니다
    const captureIds = createdCaptures.map((c: any) => c.id);
    after(async () => {
      await executeBatchCaptures(captureIds);
    });

    return NextResponse.json(
      {
        data: createdCaptures[0],
        captures: createdCaptures,
        count: createdCaptures.length,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[API] POST /captures error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 배치 캡처 실행 — 하나의 Chromium 브라우저에서 순차 처리
 * (after() 콜백 또는 /api/captures/execute에서 호출)
 */
async function executeBatchCaptures(captureIds: string[]): Promise<void> {
  const startTime = Date.now();
  const supabase = createServerClient();
  const sharedEngine = new PuppeteerEngine();
  let engineLaunched = false;

  console.log(`[BatchCapture] 🎬 배치 시작: ${captureIds.length}건`);

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
          console.error(`[BatchCapture] ❌ 요청 조회 실패: ${captureId}`);
          continue;
        }

        const capture = data as unknown as VisionDaCaptureRow;

        if (capture.status !== "pending") {
          console.log(`[BatchCapture] ⏭️ 건너뜀 (status: ${capture.status}): ${captureId}`);
          continue;
        }

        // 2) 상태 → processing
        await supabase
          .from("vision_da_captures")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", captureId);

        // 3) 브라우저 엔진 초기화 (최초 1회만)
        if (!engineLaunched) {
          await sharedEngine.launch();
          engineLaunched = true;
          console.log(`[BatchCapture] 🚀 Chromium 시작 (배치: ${captureIds.length}건)`);
        }

        // 4) 채널 생성 (공유 엔진)
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
            creativeDimensions: captureMetadata.creativeDimensions ?? undefined,
            adSizeMode: captureMetadata.adSizeMode ?? "auto",
            targetAdSizes: captureMetadata.targetAdSizes ?? [],
            youtubeAdType: captureMetadata.youtubeAdType ?? "preroll",
            ...(captureMetadata.instreamOpts ?? {}),
          },
        });

        // 6) Storage 업로드
        const timestamp = Date.now();
        const basePath = `captures/${captureId}`;

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

        // 7) DB → completed
        const durationMs = Date.now() - captureStart;
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

        console.log(`[BatchCapture] ✅ 완료: ${captureId} (${durationMs}ms)`);

      } catch (captureError) {
        const errorMessage = captureError instanceof Error ? captureError.message : "알 수 없는 오류";

        await supabase
          .from("vision_da_captures")
          .update({
            status: "failed",
            error_message: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", captureId);

        console.error(`[BatchCapture] ❌ 실패: ${captureId}`, captureError);
      }
    }
  } finally {
    if (engineLaunched) {
      await sharedEngine.close();
      console.log(`[BatchCapture] 🛑 Chromium 종료`);
    }
  }

  const totalMs = Date.now() - startTime;
  console.log(`[BatchCapture] 📊 배치 완료 (${totalMs}ms)`);
}

/** GET: 캡처 목록 조회 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);

    let query = supabase
      .from("vision_da_captures")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, total: count });
  } catch (err) {
    console.error("[API] GET /captures error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/** DELETE: 캡처 이력 삭제 (단일/다중/전체) */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ids, all } = body as {
      id?: string;       // 단일 삭제
      ids?: string[];    // 다중 삭제
      all?: boolean;     // 전체 삭제
    };

    const supabase = createServerClient();

    // 삭제 대상 ID 목록 확정
    let targetIds: string[] = [];

    if (all) {
      // 전체 삭제 — 모든 캡처 ID 조회
      const { data } = await supabase
        .from("vision_da_captures")
        .select("id");
      targetIds = (data ?? []).map((d: any) => d.id);
    } else if (ids && ids.length > 0) {
      targetIds = ids;
    } else if (id) {
      targetIds = [id];
    } else {
      return NextResponse.json({ error: "삭제할 대상(id, ids, 또는 all)을 지정하세요." }, { status: 400 });
    }

    if (targetIds.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    // 1) Storage 이미지 삭제
    for (const captureId of targetIds) {
      try {
        const { data: files } = await supabase.storage
          .from("capture-images")
          .list(`captures/${captureId}`);

        if (files && files.length > 0) {
          const paths = files.map((f: any) => `captures/${captureId}/${f.name}`);
          await supabase.storage
            .from("capture-images")
            .remove(paths);
        }
      } catch (storageErr) {
        // Storage 삭제 실패해도 DB 삭제는 진행
        console.warn(`[API] Storage 삭제 실패 (${captureId}):`, storageErr);
      }
    }

    // 2) DB 레코드 삭제
    const { error, count } = await supabase
      .from("vision_da_captures")
      .delete({ count: "exact" })
      .in("id", targetIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`[API] 캡처 삭제 완료: ${count}건`);
    return NextResponse.json({ deleted: count });
  } catch (err) {
    console.error("[API] DELETE /captures error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
