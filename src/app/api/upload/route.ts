/**
 * POST /api/upload — 소재 이미지 업로드 API
 *
 * 이미지를 Supabase Storage에 업로드하고 공개 URL을 반환합니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    }

    // 파일 크기 제한 (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "파일 크기는 10MB 이하여야 합니다." }, { status: 400 });
    }

    // 허용 확장자 검증
    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "PNG, JPG, WebP, GIF 형식만 지원합니다." },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // 고유 파일명 생성
    const ext = file.name.split(".").pop() || "png";
    const filename = `creative_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const storagePath = `creatives/${filename}`;

    // ArrayBuffer → Buffer 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Supabase Storage 업로드
    const { error: uploadError } = await supabase.storage
      .from("capture-images")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[Upload] Storage 업로드 실패:", uploadError);
      return NextResponse.json(
        { error: `업로드 실패: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // 공개 URL 생성
    const { data: urlData } = supabase.storage
      .from("capture-images")
      .getPublicUrl(storagePath);

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      filename,
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    console.error("[Upload] 서버 오류:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
