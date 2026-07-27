// Supabase 클라이언트. 환경변수가 없으면 null을 반환 → data.ts가 localStorage로 분기한다.
// anon key는 공개 가능한 값이므로 NEXT_PUBLIC_ 접두사 허용(디자인 §5.2-4).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const hasSupabase = Boolean(url && anonKey);
