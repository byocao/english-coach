export interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS: Fetcher;

  ADMIN_LOGIN: string;
  CONTACT_URL: string;
  WORKERS_AI_MODEL: string; // sentence explanations (free)
  LESSON_MODEL: string; // custom lessons
  GRADE_MODEL: string; // speaking grades
  LESSON_LIMIT: string; // custom lessons per account (admin unlimited)
  GRADE_LIMIT: string; // speaking grades per account (admin unlimited)
  MONTHLY_BUDGET_USD: string; // Claude API spend per month before lesson creation and grading pause

  // Secrets (wrangler secret put / .dev.vars)
  ADMIN_PASSWORD: string; // password for the ADMIN_LOGIN account (not stored in D1)
  ANTHROPIC_API_KEY: string;
}

export type Role = "admin" | "member" | "trial" | "blocked";

export interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  ai_used: number;
  lessons_used: number;
  grades_used: number;
  level: string | null;
  mascot: string | null;
  placed_at: string | null;
  placement_score: number | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
