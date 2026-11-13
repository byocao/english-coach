import { Hono } from "hono";
import type { Context } from "hono";
import { AiError, runJson, transcribe, wordMatchRatio } from "./ai";
import { authRoutes, requireAdmin, requireUser } from "./auth";
import { budgetUsd, claudeJson, monthSpend, overBudget } from "./claude";
import { learn } from "./learn";
import { limits, quota, refund, reserve, type Allowance, usedNow, vipLimits, weekResetsAt } from "./quota";
import type { AppEnv, Env, Role, User } from "./env";
import {
  EXPLAIN_SYSTEM,
  GRADE_SYSTEM,
  LENGTHS,
  LESSON_SYSTEM,
  LEVELS,
  explainPrompt,
  explainSchema,
  gradePrompt,
  gradeSchema,
  lessonPrompt,
  lessonSchema,
  type Explain,
  type Grade,
  type LengthKey,
  type Lesson,
  type Level,
} from "./prompts";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof AiError) return c.json({ error: err.message }, err.status as 422 | 429 | 502 | 503);
  console.error(err);
  return c.json({ error: "Lỗi máy chủ, hãy thử lại." }, 500);
});

app.route("/auth", authRoutes);

// ---- Everything below needs a signed-in user ---------------------------------

const api = new Hono<AppEnv>();
api.use("*", requireUser);

/** Stops blocked users. */
function gate(c: Context<AppEnv>) {
  if (c.get("user").role === "blocked") {
    return c.json({ error: "Tài khoản đã bị khoá.", code: "blocked", contact: c.env.CONTACT_URL }, 403);
  }
  return null;
}

const LIMIT_TEXT: Record<Allowance, string> = {
  lessons: "Bạn đã dùng hết lượt tạo bài học riêng",
  grades: "Bạn đã dùng hết lượt chấm điểm phát âm",
};

/**
 * For the Claude-backed features: blocked users, the monthly budget (maintenance for everyone),
 * then takes one use of the user's allowance. Returns a response to send, or null to go ahead.
 */
async function claudeGate(c: Context<AppEnv>, what: Allowance) {
  const blocked = gate(c);
  if (blocked) return blocked;
  if (await overBudget(c.env)) {
    return c.json(
      { error: "Chức năng tạo bài và chấm điểm đang bảo trì. Bạn vẫn học được các bài có sẵn.", code: "maintenance" },
      503,
    );
  }
  const user = c.get("user");
  if (!(await reserve(c.env, user, what))) {
    const weekly = user.role === "vip";
    return c.json(
      {
        error: LIMIT_TEXT[what] + (weekly ? " của tuần này." : "."),
        code: what === "lessons" ? "lesson_limit" : "grade_limit",
        contact: c.env.CONTACT_URL,
        resetsAt: weekly ? weekResetsAt() : undefined,
      },
      402,
    );
  }
  return null;
}

async function recordAi(env: Env, user: User, kind: string, provider: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET ai_used = ai_used + 1, last_seen_at = datetime('now') WHERE id = ?1").bind(user.id),
    env.DB.prepare("INSERT INTO ai_events (user_id, kind, provider) VALUES (?1, ?2, ?3)").bind(user.id, kind, provider),
  ]);
  user.ai_used += 1;
}

const CATEGORIES = ["daily", "food", "travel", "work", "study", "tech", "health", "fun", "nature", "people"];

// ---- Lessons -----------------------------------------------------------------

api.post("/lessons", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ topic?: string; level?: string; length?: string; category?: string }>().catch(() => ({}) as never);
  const category = CATEGORIES.includes(body.category ?? "") ? body.category! : null;
  const topic = (body.topic ?? "").trim().slice(0, 200);
  const level = (LEVELS as readonly string[]).includes(body.level ?? "") ? (body.level as Level) : "B1";
  const length: LengthKey = body.length && body.length in LENGTHS ? (body.length as LengthKey) : "medium";
  if (!topic) return c.json({ error: "Hãy nhập chủ đề." }, 400);

  const stop = await claudeGate(c, "lessons");
  if (stop) return stop;

  let lesson: Lesson;
  try {
    lesson = cleanLesson(
      await claudeJson<Lesson>(c.env, {
        kind: "lesson",
        userId: user.id,
        model: c.env.LESSON_MODEL,
        system: LESSON_SYSTEM,
        prompt: lessonPrompt(topic, level, length),
        schema: lessonSchema,
        maxTokens: 16000,
        effort: "medium",
      }),
    );
    if (lesson.sentences.length === 0) throw new AiError("AI không tạo được bài, hãy thử lại.");
  } catch (err) {
    await refund(c.env, user, "lessons");
    throw err;
  }
  const result = { provider: "claude" };

  const row = await c.env.DB.prepare(
    "INSERT INTO lessons (user_id, title, topic, level, content, provider, is_public, category) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7) RETURNING id",
  )
    .bind(user.id, lesson.title || topic, topic, level, JSON.stringify(lesson), result.provider, category)
    .first<{ id: number }>();
  await recordAi(c.env, user, "lesson", result.provider);
  return c.json({ id: row!.id, provider: result.provider, quota: quota(c.env, user) });
});

// ---- Speaking: Whisper + grader ------------------------------------------------

const MAX_AUDIO_B64 = 2_800_000; // ~2 MB of WAV, about 60 s at 16 kHz mono

api.post("/speak", async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ target?: string; audio?: string; lessonId?: number; sentenceIndex?: number }>()
    .catch(() => ({}) as never);
  const target = (body.target ?? "").trim().slice(0, 400);
  const audio = body.audio ?? "";
  if (!target || !audio) return c.json({ error: "Thiếu câu mẫu hoặc bản ghi âm." }, 400);
  if (audio.length > MAX_AUDIO_B64) return c.json({ error: "Bản ghi quá dài (tối đa khoảng 60 giây)." }, 413);

  const stop = await claudeGate(c, "grades");
  if (stop) return stop;

  let transcript: string, ratio: number, grade: Grade;
  const result = { provider: "claude" };
  const t0 = Date.now();
  let whisperMs = 0;
  try {
    transcript = await transcribe(c.env, audio);
    whisperMs = Date.now() - t0;
    ratio = wordMatchRatio(target, transcript);
    if (ratio >= 1) {
      // Whisper heard every word exactly: nothing for Claude to explain, answer at once.
      grade = perfectGrade(target);
      result.provider = "whisper";
    } else {
      grade = cleanGrade(
        await claudeJson<Grade>(c.env, {
          kind: "grade",
          userId: user.id,
          model: c.env.GRADE_MODEL,
          system: GRADE_SYSTEM,
          prompt: gradePrompt(target, transcript, ratio),
          schema: gradeSchema,
          maxTokens: 4000,
          effort: "low",
          noThinking: true,
        }),
        ratio,
      );
    }
  } catch (err) {
    await refund(c.env, user, "grades");
    throw err;
  }
  const gradeMs = Date.now() - t0 - whisperMs;
  console.log(JSON.stringify({ speak: { whisperMs, gradeMs, provider: result.provider, words: target.split(/\s+/).length } }));
  c.header("Server-Timing", `whisper;dur=${whisperMs}, grade;dur=${gradeMs}`);

  await c.env.DB.prepare(
    `INSERT INTO attempts (user_id, lesson_id, sentence_index, target, transcript, score, feedback, provider)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      user.id,
      Number.isInteger(body.lessonId) ? body.lessonId : null,
      Number.isInteger(body.sentenceIndex) ? body.sentenceIndex : null,
      target,
      transcript,
      grade.score,
      JSON.stringify(grade),
      result.provider,
    )
    .run();
  await recordAi(c.env, user, "grade", result.provider);
  return c.json({ transcript, ratio, grade, provider: result.provider, quota: quota(c.env, user) });
});

// ---- Reading: explain a sentence ------------------------------------------------

api.post("/explain", async (c) => {
  const blocked = gate(c);
  if (blocked) return blocked;
  const user = c.get("user");
  const body = await c.req.json<{ sentence?: string; context?: string }>().catch(() => ({}) as never);
  const sentence = (body.sentence ?? "").trim().slice(0, 400);
  if (!sentence) return c.json({ error: "Thiếu câu cần giải thích." }, 400);
  const result = await runJson<Explain>(c.env, {
    system: EXPLAIN_SYSTEM,
    prompt: explainPrompt(sentence, (body.context ?? "").slice(0, 3000)),
    schema: explainSchema,
    maxTokens: 1200,
  });
  await recordAi(c.env, user, "explain", result.provider);
  return c.json({ explain: result.data, provider: result.provider, note: result.note, quota: quota(c.env, user) });
});

// ---- Admin ------------------------------------------------------------------------

api.get("/admin/users", requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.login, u.role, u.ai_used, u.lessons_used, u.grades_used, u.quota_week, u.xp, u.streak, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts
       FROM users u ORDER BY u.last_seen_at DESC NULLS LAST LIMIT 500`,
  ).all();
  const { results: byModel } = await c.env.DB.prepare(
    `SELECT kind, model, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS usd
       FROM ai_spend WHERE created_at >= strftime('%Y-%m-01 00:00:00', 'now') GROUP BY kind, model ORDER BY usd DESC`,
  ).all();
  return c.json({
    // A VIP's counters from an earlier week no longer count, so show them as zero.
    users: (results as unknown as User[]).map((u) => ({
      ...u,
      lessons_used: usedNow(u, "lessons"),
      grades_used: usedNow(u, "grades"),
    })),
    limits: limits(c.env),
    vipLimits: vipLimits(c.env),
    spend: { usd: await monthSpend(c.env), budget: budgetUsd(c.env), byModel },
  });
});

api.patch("/admin/users/:id", requireAdmin, async (c) => {
  const body = await c.req.json<{ role?: Role; resetUsage?: boolean }>().catch(() => ({}) as never);
  const id = Number(c.req.param("id"));
  if (id === c.get("user").id) return c.json({ error: "Không đổi quyền của chính mình." }, 400);
  if (body.role && ["vip", "member", "trial", "blocked"].includes(body.role)) {
    // An account that becomes VIP starts a fresh week at its next use (quota_week NULL counts as "another week").
    await c.env.DB.prepare(
      `UPDATE users SET quota_week = CASE WHEN ?1 = 'vip' AND role != 'vip' THEN NULL ELSE quota_week END, role = ?1
        WHERE id = ?2`,
    )
      .bind(body.role, id)
      .run();
  }
  if (body.resetUsage) {
    await c.env.DB.prepare("UPDATE users SET ai_used = 0, lessons_used = 0, grades_used = 0 WHERE id = ?1").bind(id).run();
  }
  return c.json({ ok: true });
});

api.route("/", learn);
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// ---- helpers ----------------------------------------------------------------------

/** Sentences and their translations, kept aligned; translations are dropped if the model's counts differ. */
function sentencePairs(l: Lesson): { sentences: string[]; sentences_vi: string[] } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const en = Array.isArray(l?.sentences) ? l.sentences.map(str) : [];
  const vi = Array.isArray(l?.sentences_vi) ? l.sentences_vi.map(str) : [];
  const aligned = vi.length === en.length;
  const pairs = en.map((s, i) => [s, aligned ? vi[i] : ""] as const).filter(([s]) => s).slice(0, 30);
  return { sentences: pairs.map(([s]) => s), sentences_vi: aligned ? pairs.map(([, v]) => v) : [] };
}

function cleanLesson(l: Lesson): Lesson {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    title: str(l?.title),
    summary_vi: str(l?.summary_vi),
    ...sentencePairs(l),
    vocabulary: (Array.isArray(l?.vocabulary) ? l.vocabulary : []).slice(0, 15).map((v) => ({
      word: str(v?.word),
      ipa: str(v?.ipa),
      pos: str(v?.pos),
      meaning_vi: str(v?.meaning_vi),
      example: str(v?.example),
      example_vi: str(v?.example_vi),
    })),
    questions: (Array.isArray(l?.questions) ? l.questions : [])
      .filter((q) => Array.isArray(q?.options) && q.options.length >= 2)
      .slice(0, 8)
      .map((q) => ({
        question: str(q.question),
        options: q.options.map(str),
        answer_index: Math.min(Math.max(0, Math.trunc(Number(q.answer_index) || 0)), q.options.length - 1),
        explanation_vi: str(q.explanation_vi),
      })),
  };
}

/** Grade for a reading Whisper heard word for word. */
function perfectGrade(target: string): Grade {
  return {
    score: 100,
    words: target.split(/\s+/).filter(Boolean).map((word) => ({ word, status: "ok" as const, tip_vi: "" })),
    feedback_vi: "Tuyệt vời! Máy nghe rõ từng từ bạn đọc.",
    next_step_vi: "Thử đọc trôi chảy hơn: nối âm giữa các từ và nhấn đúng trọng âm của từ quan trọng.",
  };
}

function cleanGrade(g: Grade, ratio: number): Grade {
  const score = Number.isFinite(Number(g?.score)) ? Math.round(Number(g.score)) : Math.round(ratio * 100);
  return {
    score: Math.min(100, Math.max(0, score)),
    words: (Array.isArray(g?.words) ? g.words : []).slice(0, 80).map((w) => ({
      word: String(w?.word ?? ""),
      status: ["ok", "unclear", "missing", "extra"].includes(w?.status) ? w.status : "ok",
      tip_vi: String(w?.tip_vi ?? ""),
    })),
    feedback_vi: String(g?.feedback_vi ?? ""),
    next_step_vi: String(g?.next_step_vi ?? ""),
  };
}

export default app;
