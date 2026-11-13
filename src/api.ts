export type Role = "admin" | "vip" | "member" | "trial" | "blocked";

export interface Game {
  xp: number;
  streak: number;
  practicedToday: boolean;
  todayXp: number;
  dailyGoal: number;
  todaySteps: number;
  bestSpeakToday: number;
}

export interface Me {
  user: {
    id: number;
    login: string;
    role: Role;
    ai_used: number;
    level: string | null;
    mascot: string | null;
    placed_at: string | null;
    placement_score: number | null;
  };
  quota: Quota;
  contact: string;
  /** Lesson creation and grading are paused: the month's Claude API budget is used up. */
  maintenance: boolean;
  /** Admin only: Claude API spend this month. */
  spend: { usd: number; budget: number } | null;
  game: Game;
}

export interface Allowance {
  used: number;
  limit: number;
  left: number;
}

/** Per-account allowances for the Claude features; limited is false for the admin. */
export interface Quota {
  limited: boolean;
  /** "week" for VIP accounts, whose allowances come back every Monday (Vietnam time). */
  period: "account" | "week";
  /** When a weekly allowance comes back (ISO timestamp); null for per-account allowances. */
  resetsAt: string | null;
  lessons: Allowance;
  grades: Allowance;
}

export interface LessonContent {
  title: string;
  summary_vi: string;
  sentences: string[];
  /** Vietnamese translation of each sentence (built-in course; newer AI lessons). */
  sentences_vi?: string[];
  vocabulary: { word: string; ipa: string; pos: string; meaning_vi: string; example: string; example_vi?: string }[];
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
  sentences: number;
  learners: number;
  my_steps: number;
  my_last: string | null;
  my_progress: string | null; // JSON {step: best}
  category: string | null;
  course_order: number | null;
  summary: string | null;
}

export interface LessonDetail {
  lesson: {
    id: number;
    user_id: number;
    title: string;
    topic: string;
    level: string;
    is_public: number;
    category: string | null;
    course_order: number | null;
    provider: string;
    author: string;
    created_at: string;
    content: LessonContent;
  };
  progress: { step: Step; best: number; times: number }[];
  sentences: { sentence_index: number; best: number; tries: number }[];
}

export type Step = "words" | "listen" | "dictation" | "speak" | "read" | "quiz";

export interface Grade {
  score: number;
  words: { word: string; status: "ok" | "unclear" | "missing" | "extra"; tip_vi: string }[];
  feedback_vi: string;
  next_step_vi: string;
}

export interface ProgressResult {
  xpGained: number;
  newBest: boolean;
  streakUp: boolean;
  goalReached: boolean;
  game: Game;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly contact?: string,
    /** For a weekly allowance that ran out: when it comes back. */
    readonly resetsAt?: string,
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
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; contact?: string; resetsAt?: string };
  if (!res.ok) {
    const err = new ApiError(data.error || `Lỗi ${res.status}`, res.status, data.code, data.contact, data.resetsAt);
    listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data as T;
}
