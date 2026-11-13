import type { Env, User } from "./env";

export type Allowance = "lessons" | "grades";
export type Period = "account" | "week";

/** Per-account allowances for trial and member accounts (they never reset). Only VIP and admin write lessons. */
export function limits(env: Env): Record<Allowance, number> {
  return { lessons: 0, grades: Number(env.GRADE_LIMIT) || 10 };
}

/** VIP and admin accounts write lessons with AI and run classes. */
export function canTeach(user: Pick<User, "role">): boolean {
  return user.role === "vip" || user.role === "admin";
}

/** Weekly allowances for VIP accounts. */
export function vipLimits(env: Env): Record<Allowance, number> {
  return { lessons: Number(env.VIP_LESSON_LIMIT) || 10, grades: Number(env.VIP_GRADE_LIMIT) || 100 };
}

const VN_OFFSET_MS = 7 * 3600_000;

/** The current quota week: the date of its Monday in Vietnam time (UTC+7), as YYYY-MM-DD. */
export function currentWeek(now = Date.now()): string {
  const vn = new Date(now + VN_OFFSET_MS);
  vn.setUTCDate(vn.getUTCDate() - ((vn.getUTCDay() + 6) % 7));
  return vn.toISOString().slice(0, 10);
}

/** When the current quota week ends: next Monday 00:00 in Vietnam, as an ISO timestamp. */
export function weekResetsAt(now = Date.now()): string {
  const monday = Date.parse(currentWeek(now) + "T00:00:00Z") - VN_OFFSET_MS;
  return new Date(monday + 7 * 86400_000).toISOString();
}

/** Uses counted against the allowance right now: a VIP's counters from an earlier week count as zero. */
export function usedNow(user: Pick<User, "role" | "lessons_used" | "grades_used" | "quota_week">, what: Allowance) {
  if (user.role === "vip" && user.quota_week !== currentWeek()) return 0;
  return what === "lessons" ? user.lessons_used : user.grades_used;
}

export function quota(env: Env, user: User) {
  const vip = user.role === "vip";
  const lim = vip ? vipLimits(env) : limits(env);
  const one = (what: Allowance) => {
    const used = usedNow(user, what);
    return { used, limit: lim[what], left: Math.max(0, lim[what] - used) };
  };
  return {
    limited: user.role !== "admin",
    period: (vip ? "week" : "account") as Period,
    resetsAt: vip ? weekResetsAt() : null,
    lessons: one("lessons"),
    grades: one("grades"),
  };
}

const COLUMN: Record<Allowance, "lessons_used" | "grades_used"> = { lessons: "lessons_used", grades: "grades_used" };

/** Takes one use of an allowance up front (so parallel requests cannot overshoot). False when none are left. */
export async function reserve(env: Env, user: User, what: Allowance): Promise<boolean> {
  const col = COLUMN[what];
  if (user.role === "vip") {
    // A new week starts both counters from zero; the reset and the increment happen in one statement.
    const week = currentWeek();
    const row = await env.DB.prepare(
      `UPDATE users SET
              lessons_used = (CASE WHEN quota_week = ?3 THEN lessons_used ELSE 0 END) + ?4,
              grades_used = (CASE WHEN quota_week = ?3 THEN grades_used ELSE 0 END) + ?5,
              quota_week = ?3
        WHERE id = ?1 AND role = 'vip' AND (CASE WHEN quota_week = ?3 THEN ${col} ELSE 0 END) < ?2
        RETURNING lessons_used, grades_used, quota_week`,
    )
      .bind(user.id, vipLimits(env)[what], week, what === "lessons" ? 1 : 0, what === "grades" ? 1 : 0)
      .first<{ lessons_used: number; grades_used: number; quota_week: string }>();
    if (!row) return false;
    Object.assign(user, row);
    return true;
  }
  const row = await env.DB.prepare(
    `UPDATE users SET ${col} = ${col} + 1 WHERE id = ?1 AND (role = 'admin' OR ${col} < ?2) RETURNING ${col} AS used`,
  )
    .bind(user.id, limits(env)[what])
    .first<{ used: number }>();
  if (!row) return false;
  user[col] = row.used;
  return true;
}

/** Gives a reserved use back when the AI call failed. */
export async function refund(env: Env, user: User, what: Allowance) {
  const col = COLUMN[what];
  await env.DB.prepare(`UPDATE users SET ${col} = MAX(0, ${col} - 1) WHERE id = ?1`).bind(user.id).run();
  user[col] = Math.max(0, user[col] - 1);
}
