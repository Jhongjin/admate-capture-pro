-- vision_da_captures 테이블 스키마 업데이트
-- (기존에 id, screenshot_storage_path, source_url, captured_at 등이 존재함을 가정)

-- 1. 필수 컬럼 추가
ALTER TABLE "public"."vision_da_captures"
ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS "channel" text,
ADD COLUMN IF NOT EXISTS "creative_url" text,
ADD COLUMN IF NOT EXISTS "click_url" text,
ADD COLUMN IF NOT EXISTS "capture_landing" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "placement_image_url" text,
ADD COLUMN IF NOT EXISTS "landing_image_url" text,
ADD COLUMN IF NOT EXISTS "landing_final_url" text,
ADD COLUMN IF NOT EXISTS "error_message" text,
ADD COLUMN IF NOT EXISTS "metadata" jsonb,
ADD COLUMN IF NOT EXISTS "user_id" uuid,
ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();

-- 2. Storage 버킷 생성 (자동 실행 안 되면 대시보드에서 생성 필요)
INSERT INTO storage.buckets (id, name, public)
VALUES ('capture-images', 'capture-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage 정책 (익명 읽기 허용)
CREATE POLICY "Public Read"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'capture-images' );

-- 4. Storage 정책 (인증된 사용자 쓰기 허용)
CREATE POLICY "Authenticated Upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'capture-images' );
