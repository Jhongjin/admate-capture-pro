/**
 * POST /api/captures — 캡처 요청 생성
 * GET  /api/captures — 캡처 목록 조회
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/client";
import type { ChannelType } from "@/lib/supabase/types";

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
    } = body as {
      channel: ChannelType;
      publisherUrl?: string;
      publisherUrls?: string[];
      creativeUrl: string;
      clickUrl?: string;
      captureLanding?: boolean;
      injectionMode?: "single" | "all" | "custom";
      slotCount?: number;
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
    const createdCaptures = [];

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
          metadata: { injectionMode, slotCount },
        })
        .select()
        .single();

      if (error) {
        console.error("[API] captures insert error:", error);
        continue;
      }

      createdCaptures.push(data);

      // 캡처 실행 트리거 (백그라운드)
      const executeUrl = new URL("/api/captures/execute", request.url);
      fetch(executeUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId: data.id }),
      }).catch((err) => console.error("[API] execute trigger failed:", err));
    }

    if (createdCaptures.length === 0) {
      return NextResponse.json({ error: "캡처 요청 생성에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json(
      {
        data: createdCaptures.length === 1 ? createdCaptures[0] : createdCaptures[0],
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
