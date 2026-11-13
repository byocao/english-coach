export interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS: Fetcher;

  CONTACT_URL: string;
  WORKERS_AI_MODEL: string; // sentence explanations (free)
  LESSON_MODEL: string; // custom lessons
  GRADE_MODEL: string; // speaking grades
  GRADE_LIMIT: string; // speaking grades per account (admin unlimited); free accounts cannot write lessons
  VIP_LESSON_LIMIT: string; // custom lessons per week for VIP accounts
  VIP_GRADE_LIMIT: string; // speaking grades per week for VIP accounts
  CLASS_LIMIT: string; // classes a VIP account can own (admin unlimited)
  CLASS_STUDENT_LIMIT: string; // students per class, pending invites included
  CLASS_TEACHER_LIMIT: string; // co-teachers per class
  MONTHLY_BUDGET_USD: string; // Claude API spend per month before lesson creation and grading pause

  // Secrets (wrangler secret put / .dev.vars)
  ADMIN_LOGIN?: string; // username of the admin account; unset = no admin
  ADMIN_PASSWORD: string; // password for the ADMIN_LOGIN account (not stored in D1)
  ANTHROPIC_API_KEY: string;
}

export type Role = "admin" | "vip" | "member" | "trial" | "blocked";

export interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  ai_used: number;
  lessons_used: number;
  grades_used: number;
  quota_week: string | null;
  email: string | null; // VIP only: the week lessons_used / grades_used count from
  level: string | null;
  mascot: string | null;
  placed_at: string | null;
  placement_score: number | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
