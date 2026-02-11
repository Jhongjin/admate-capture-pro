/**
 * Supabase Client — 서버/클라이언트 인스턴스
 *
 * MVP 단계에서는 제네릭 없이 기본 클라이언트 사용,
 * 향후 `supabase gen types`로 정확한 타입 생성 후 적용
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** 클라이언트 사이드 Supabase (Anon Key) */
export function createBrowserClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

/** 서버 사이드 Supabase (Service Role Key — RLS 바이패스) */
export function createServerClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}
