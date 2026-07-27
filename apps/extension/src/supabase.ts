import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await chrome.storage.local.get(key);
    return typeof stored[key] === "string" ? stored[key] : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

let client: SupabaseClient | undefined;
let signInPromise: Promise<string> | undefined;

export function getExtensionSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("확장 프로그램의 Supabase 연결 정보가 없습니다.");
  }

  client = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage: authStorage,
    },
  });
  return client;
}

export async function ensureExtensionSession(): Promise<string> {
  if (signInPromise) {
    return signInPromise;
  }

  signInPromise = (async () => {
    const supabase = getExtensionSupabaseClient();
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
      throw error ?? new Error("확장 프로그램 익명 세션을 만들지 못했습니다.");
    }
    return data.session.access_token;
  })();

  try {
    return await signInPromise;
  } finally {
    signInPromise = undefined;
  }
}
