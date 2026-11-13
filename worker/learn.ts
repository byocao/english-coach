// Shared lesson library, per-step progress, XP, streaks and the leaderboard.
import { Hono } from "hono";
import type { AppEnv, Env, User } from "./env";
import { budgetUsd, monthSpend } from "./claude";
import { canTeach, quota } from "./quota";
import { unreadCount } from "./classes";
import { IN_MY_CLASS, LESSON_COLUMNS, WEEK_START, canSee } from "./visibility";

export const STEPS = ["words", "listen", "dictation", "speak", "read", "quiz"] as const;
export type Step = (typeof STEPS)[number];

/** XP for finishing a step with a 0-100 score; first completion of a step earns a bonus. */
const STEP_XP: Record<Step, number> = { words: 10, listen: 10, dictation: 15, speak: 20, read: 10, quiz: 15 };
const FIRST_TIME_BONUS = 5;
const DAILY_GOALS = [10, 20, 30, 50, 80];

// Days are counted in Vietnam time (UTC+7).
const VN_TODAY = "date('now', '+7 hours')";

export const learn = new Hono<AppEnv>();

interface Gamer {
  xp: number;
  streak: number;
  last_active_day: string | null;
  daily_goal: number;
  today: string;
  yesterday: string;
  today_xp: number;
  today_steps: number;
  best_speak_today: number;
}

async function gamer(env: Env, userId: number): Promise<Gamer> {
  const row = await env.DB.prepare(
    `SELECT xp, streak, last_active_day, daily_goal,
            ${VN_TODAY} AS today, date('now', '+7 hours', '-1 day') AS yesterday,
            (SELECT COALESCE(SUM(amount), 0) FROM xp_events
              WHERE user_id = ?1 AND date(created_at, '+7 hours') = ${VN_TODAY}) AS today_xp,
            (SELECT COUNT(*) FROM xp_events
              WHERE user_id = ?1 AND date(created_at, '+7 hours') = ${VN_TODAY}) AS today_steps,
            (SELECT COALESCE(MAX(score), 0) FROM attempts
              WHERE user_id = ?1 AND date(created_at, '+7 hours') = ${VN_TODAY}) AS best_speak_today
       FROM users WHERE id = ?1`,
  )
    .bind(userId)
    .first<Gamer>();
  return row!;
}

/** The streak as the user sees it: it lapses once a whole day passes without practice. */
function liveStreak(g: Gamer): number {
  return g.last_active_day === g.today || g.last_active_day === g.yesterday ? g.streak : 0;
}

function gameView(g: Gamer) {
  return {
    xp: g.xp,
    streak: liveStreak(g),
    practicedToday: g.last_active_day === g.today,
    todayXp: g.today_xp,
    dailyGoal: g.daily_goal,
    todaySteps: g.today_steps,
    bestSpeakToday: g.best_speak_today,
  };
}

learn.get("/me", async (c) => {
  const user = c.get("user");
  const [g, spent, unread, classes] = await Promise.all([
    gamer(c.env, user.id),
    monthSpend(c.env),
    unreadCount(c.env, user.id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM class_members WHERE user_id = ?1 AND status = 'active'").bind(user.id).first<{ n: number }>(),
  ]);
  const budget = budgetUsd(c.env);
  return c.json({
    user,
    quota: quota(c.env, user),
    contact: c.env.CONTACT_URL,
    // Lesson creation and grading pause for everyone once the month's Claude spend reaches the budget.
    maintenance: spent >= budget,
    spend: user.role === "admin" ? { usd: spent, budget } : null,
    game: gameView(g),
    canTeach: canTeach(user),
    classes: classes?.n ?? 0,
    unread,
  });
});

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const MASCOTS = ["wanko", "tororo", "hijiki", "fox"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Daily goal, starting level (placement=true when it comes from the placement test), companion. */
learn.patch("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ dailyGoal?: number; level?: string; placement?: boolean; score?: number; mascot?: string; email?: string | null }>()
    .catch(() => ({}) as never);
  const stmts: D1PreparedStatement[] = [];
  if (body.dailyGoal !== undefined) {
    if (!DAILY_GOALS.includes(Number(body.dailyGoal))) return c.json({ error: "Mục tiêu không hợp lệ." }, 400);
    stmts.push(c.env.DB.prepare("UPDATE users SET daily_goal = ?1 WHERE id = ?2").bind(Number(body.dailyGoal), user.id));
  }
  if (body.level !== undefined) {
    if (!LEVELS.includes(body.level)) return c.json({ error: "Trình độ không hợp lệ." }, 400);
    stmts.push(
      body.placement
        ? c.env.DB.prepare("UPDATE users SET level = ?1, placed_at = datetime('now'), placement_score = ?2 WHERE id = ?3").bind(
            body.level,
            Math.max(0, Math.min(100, Math.round(Number(body.score) || 0))),
            user.id,
          )
        : c.env.DB.prepare("UPDATE users SET level = ?1 WHERE id = ?2").bind(body.level, user.id),
    );
  }
  if (body.mascot !== undefined) {
    if (!MASCOTS.includes(body.mascot)) return c.json({ error: "Nhân vật không hợp lệ." }, 400);
    stmts.push(c.env.DB.prepare("UPDATE users SET mascot = ?1 WHERE id = ?2").bind(body.mascot, user.id));
  }
  if (body.email !== undefined) {
    // One email per account, unique across accounts; empty or null removes it.
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) return c.json({ error: "Email không hợp lệ." }, 400);
    if (email) {
      const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?1 AND id != ?2").bind(email, user.id).first();
      if (taken) return c.json({ error: "Email này đã có tài khoản khác dùng." }, 409);
    }
    stmts.push(c.env.DB.prepare("UPDATE users SET email = ?1 WHERE id = ?2").bind(email || null, user.id));
  }
  if (stmts.length === 0) return c.json({ error: "Không có gì để cập nhật." }, 400);
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (String(err).includes("UNIQUE")) return c.json({ error: "Email này đã có tài khoản khác dùng." }, 409);
    throw err;
  }
  return c.json({ ok: true });
});

// ---- Library ---------------------------------------------------------------------

/**
 * scope=mine    lessons I started or wrote, most recently practised first (my learning path);
 * scope=library every visible lesson, filterable by level and search text;
 *               cat=mine lessons I wrote, cat=class lessons of my classes, cat=community lessons written by people.
 */
learn.get("/lessons", async (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") === "mine" ? "mine" : "library";
  const level = c.req.query("level") ?? "";
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const cat = (c.req.query("cat") ?? "").slice(0, 20);
  const visible = canSee(user);

  if (scope === "mine") {
    const { results } = await c.env.DB.prepare(
      `SELECT ${LESSON_COLUMNS} FROM lessons l JOIN users u ON u.id = l.user_id
        WHERE ${visible} AND (l.user_id = ?1 OR EXISTS (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = ?1))
        ORDER BY COALESCE(my_last, l.created_at) DESC LIMIT 100`,
    )
      .bind(user.id)
      .all();
    return c.json({ lessons: results });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${LESSON_COLUMNS} FROM lessons l JOIN users u ON u.id = l.user_id
      WHERE ${visible}
        AND (?2 = '' OR l.level = ?2)
        AND (?3 = '' OR l.title LIKE '%' || ?3 || '%' OR l.topic LIKE '%' || ?3 || '%')
        AND (?4 = '' OR (?4 = 'community' AND l.course_order IS NULL) OR (?4 = 'mine' AND l.user_id = ?1)
             OR (?4 = 'class' AND ${IN_MY_CLASS}) OR l.category = ?4)
      ORDER BY (l.course_order IS NULL), l.course_order, learners DESC, l.created_at DESC LIMIT 200`,
  )
    .bind(user.id, level, q, cat)
    .all();
  return c.json({ lessons: results });
});

/** The built-in course, in order: levels A1 to C1, each a run of lessons. */
learn.get("/course", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${LESSON_COLUMNS} FROM lessons l JOIN users u ON u.id = l.user_id
      WHERE l.course_order IS NOT NULL AND l.is_public = 1 ORDER BY l.course_order`,
  )
    .bind(c.get("user").id)
    .all();
  return c.json({ lessons: results });
});

/** Existing lessons close to a topic, offered before spending an AI call on a new one. */
learn.get("/lessons/similar", async (c) => {
  const user = c.get("user");
  const level = c.req.query("level") ?? "";
  const words = (c.req.query("topic") ?? "")
    .toLowerCase()
    .split(/[^a-z0-9à-ỹ]+/i)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "about", "your"].includes(w))
    .slice(0, 5);
  if (words.length === 0) return c.json({ lessons: [] });
  const score = words.map((_, i) => `(CASE WHEN lower(l.title || ' ' || l.topic) LIKE '%' || ?${i + 3} || '%' THEN 1 ELSE 0 END)`).join(" + ");
  const { results } = await c.env.DB.prepare(
    `SELECT ${LESSON_COLUMNS}, (${score}) AS hits FROM lessons l JOIN users u ON u.id = l.user_id
      WHERE (l.is_public = 1 OR l.user_id = ?1) AND (?2 = '' OR l.level = ?2) AND (${score}) > 0
      ORDER BY hits DESC, learners DESC LIMIT 4`,
  )
    .bind(user.id, level, ...words)
    .all();
  return c.json({ lessons: results });
});

learn.get("/lessons/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `SELECT l.*, u.login AS author FROM lessons l JOIN users u ON u.id = l.user_id
      WHERE l.id = ?2 AND ${canSee(user)}`,
  )
    .bind(user.id, id)
    .first<Record<string, unknown> & { content: string }>();
  if (!row) return c.json({ error: "Không tìm thấy bài học." }, 404);
  const [progress, sentences] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT step, best, times FROM lesson_progress WHERE lesson_id = ?1 AND user_id = ?2").bind(id, user.id),
    c.env.DB.prepare(
      `SELECT sentence_index, MAX(score) AS best, COUNT(*) AS tries FROM attempts
        WHERE lesson_id = ?1 AND user_id = ?2 GROUP BY sentence_index`,
    ).bind(id, user.id),
  ]);
  return c.json({ lesson: { ...row, content: JSON.parse(row.content) }, progress: progress.results, sentences: sentences.results });
});

/** Public or private: the author of a lesson they wrote, or the admin for any lesson. */
learn.patch("/lessons/:id", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ is_public?: boolean }>().catch(() => ({}) as never);
  const row = await c.env.DB.prepare(
    "UPDATE lessons SET is_public = ?1 WHERE id = ?2 AND (?4 OR (user_id = ?3 AND course_order IS NULL)) RETURNING id",
  )
    .bind(body.is_public ? 1 : 0, Number(c.req.param("id")), user.id, user.role === "admin" ? 1 : 0)
    .first();
  if (!row) return c.json({ error: "Chỉ tác giả của bài mới ẩn/hiện được bài." }, 403);
  return c.json({ ok: true });
});

learn.delete("/lessons/:id", async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare("DELETE FROM lessons WHERE id = ?1 AND (user_id = ?2 OR ?3)")
    .bind(Number(c.req.param("id")), user.id, user.role === "admin" ? 1 : 0)
    .run();
  return c.json({ ok: true });
});

// ---- Progress and XP ------------------------------------------------------------

learn.post("/progress", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ lessonId?: number; step?: string; score?: number }>().catch(() => ({}) as never);
  const step = body.step as Step;
  const lessonId = Number(body.lessonId);
  if (!STEPS.includes(step) || !Number.isInteger(lessonId)) return c.json({ error: "Dữ liệu không hợp lệ." }, 400);
  const score = Math.max(0, Math.min(100, Math.round(Number(body.score) || 0)));

  const exists = await c.env.DB.prepare(`SELECT 1 FROM lessons l WHERE l.id = ?2 AND ${canSee(user)}`).bind(user.id, lessonId).first();
  if (!exists) return c.json({ error: "Không tìm thấy bài học." }, 404);
  const prev = await c.env.DB.prepare("SELECT best FROM lesson_progress WHERE user_id = ?1 AND lesson_id = ?2 AND step = ?3")
    .bind(user.id, lessonId, step)
    .first<{ best: number }>();

  const xp = Math.max(3, Math.round((STEP_XP[step] * Math.max(score, 30)) / 100)) + (prev ? 0 : FIRST_TIME_BONUS);
  const before = await gamer(c.env, user.id);
  const streak =
    before.last_active_day === before.today ? before.streak : before.last_active_day === before.yesterday ? before.streak + 1 : 1;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO lesson_progress (user_id, lesson_id, step, best, times) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(user_id, lesson_id, step) DO UPDATE SET best = MAX(best, excluded.best), times = times + 1, updated_at = datetime('now')`,
    ).bind(user.id, lessonId, step, score),
    c.env.DB.prepare("INSERT INTO xp_events (user_id, amount, reason) VALUES (?1, ?2, ?3)").bind(user.id, xp, `${step}:${lessonId}`),
    c.env.DB.prepare(`UPDATE users SET xp = xp + ?1, streak = ?2, last_active_day = ${VN_TODAY}, last_seen_at = datetime('now') WHERE id = ?3`).bind(
      xp,
      streak,
      user.id,
    ),
  ]);
  const after = await gamer(c.env, user.id);
  return c.json({
    xpGained: xp,
    newBest: !prev || score > prev.best,
    streakUp: before.last_active_day !== before.today,
    game: gameView(after),
    goalReached: before.today_xp < before.daily_goal && after.today_xp >= after.daily_goal,
  });
});

/** XP earned since Monday 00:00 Vietnam time. */
learn.get("/leaderboard", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.streak, u.last_active_day, SUM(x.amount) AS week_xp
       FROM xp_events x JOIN users u ON u.id = x.user_id
      WHERE x.created_at >= ${WEEK_START} AND u.role != 'blocked'
      GROUP BY u.id ORDER BY week_xp DESC LIMIT 30`,
  ).all<{ id: number; login: string; streak: number; last_active_day: string; week_xp: number }>();
  const mine = results.findIndex((r) => r.id === user.id);
  return c.json({ rows: results.map(({ last_active_day: _, ...r }) => r), myRank: mine >= 0 ? mine + 1 : null });
});

learn.get("/stats", async (c) => {
  const user: User = c.get("user");
  const [totals, xpDaily, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM attempts WHERE user_id = ?1) AS attempts,
              (SELECT ROUND(AVG(score)) FROM attempts WHERE user_id = ?1) AS avg_score,
              (SELECT COUNT(DISTINCT lesson_id) FROM lesson_progress WHERE user_id = ?1) AS lessons,
              (SELECT COUNT(*) FROM lesson_progress WHERE user_id = ?1) AS steps`,
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT date(created_at, '+7 hours') AS day, SUM(amount) AS xp FROM xp_events
        WHERE user_id = ?1 AND created_at > datetime('now', '-14 days') GROUP BY day ORDER BY day`,
    ).bind(user.id),
    c.env.DB.prepare(`SELECT target, transcript, score, created_at FROM attempts WHERE user_id = ?1 ORDER BY id DESC LIMIT 10`).bind(
      user.id,
    ),
  ]);
  const g = await gamer(c.env, user.id);
  return c.json({ totals: totals.results[0], xpDaily: xpDaily.results, recent: recent.results, game: gameView(g) });
});
