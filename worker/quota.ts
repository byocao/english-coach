import type { Env, User } from "./env";

export type Allowance = "lessons" | "grades";

/** Per-account allowances for everyone except the admin. */
export function limits(env: Env): Record<Allowance, number> {
  return { lessons: Number(env.LESSON_LIMIT) || 1, grades: Number(env.GRADE_LIMIT) || 10 };
}

export function quota(env: Env, user: User) {
  const lim = limits(env);
  const one = (used: number, limit: number) => ({ used, limit, left: Math.max(0, limit - used) });
  return {
    limited: user.role !== "admin",
    lessons: one(user.lessons_used, lim.lessons),
    grades: one(user.grades_used, lim.grades),
  };
}

const COLUMN: Record<Allowance, string> = { lessons: "lessons_used", grades: "grades_used" };

/** Takes one use of an allowance up front (so parallel requests cannot overshoot). False when none are left. */
export async function reserve(env: Env, user: User, what: Allowance): Promise<boolean> {
  const col = COLUMN[what];
  const row = await env.DB.prepare(
    `UPDATE users SET ${col} = ${col} + 1 WHERE id = ?1 AND (role = 'admin' OR ${col} < ?2) RETURNING ${col} AS used`,
  )
    .bind(user.id, limits(env)[what])
    .first<{ used: number }>();
  if (!row) return false;
  user[COLUMN[what] as "lessons_used" | "grades_used"] = row.used;
  return true;
}

/** Gives a reserved use back when the AI call failed. */
export async function refund(env: Env, user: User, what: Allowance) {
  const col = COLUMN[what];
  await env.DB.prepare(`UPDATE users SET ${col} = MAX(0, ${col} - 1) WHERE id = ?1`).bind(user.id).run();
  user[COLUMN[what] as "lessons_used" | "grades_used"] = Math.max(0, user[COLUMN[what] as "lessons_used" | "grades_used"] - 1);
}
