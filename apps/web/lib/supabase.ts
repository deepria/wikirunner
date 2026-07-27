"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;
let signInPromise: Promise<string> | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase 연결 정보가 없습니다. apps/web/.env.local 파일을 설정해 주세요.");
  }

  browserClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
  return browserClient;
}

export async function ensureAnonymousSession(): Promise<string> {
  if (signInPromise) {
    return signInPromise;
  }

  signInPromise = (async () => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }
    if (session) {
      return session.access_token;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      throw error ?? new Error("익명 로그인 세션을 만들지 못했습니다.");
    }
    return data.session.access_token;
  })();

  try {
    return await signInPromise;
  } finally {
    signInPromise = undefined;
  }
}
