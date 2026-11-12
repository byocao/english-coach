export type Role = "admin" | "member" | "trial" | "blocked";

export interface Me {
  user: { id: number; login: string; name: string | null; avatar_url: string | null; role: Role; ai_used: number };
  quota: { limited: boolean; used: number; limit: number | null; left: number | null };
  contact: string;
  bridgeOnline: boolean | null;
}

export interface LessonContent {
  title: string;
  summary_vi: string;
  sentences: string[];
  vocabulary: { word: string; ipa: string; pos: string; meaning_vi: string; example: string }[];
  questions: { question: string; options: string[]; answer_index: number; explanation_vi: string }[];
}

export interface LessonRow {
  id: number;
  title: string;
  topic: string;
  level: string;
  is_public: number;
  created_at: string;
  user_id: number;
  author: string;
  attempts: number;
  avg_score: number | null;
}

export interface Grade {
  score: number;
  words: { word: string; status: "ok" | "unclear" | "missing" | "extra"; tip_vi: string }[];
  feedback_vi: string;
  next_step_vi: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly contact?: string,
  ) {
    super(message);
  }
}

type Listener = (err: ApiError) => void;
const listeners = new Set<Listener>();
/** Lets the app shell react to "trial exhausted" / "signed out" from any call. */
export function onApiError(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; contact?: string };
  if (!res.ok) {
    const err = new ApiError(data.error || `Lỗi ${res.status}`, res.status, data.code, data.contact);
    listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data as T;
}
