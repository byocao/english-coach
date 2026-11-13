// Classes run by VIP and admin accounts, and the in-app notifications they send.
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Env, User } from "./env";
import { canTeach } from "./quota";
import { LESSON_COLUMNS, WEEK_START } from "./visibility";

export const classes = new Hono<AppEnv>();

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const STEP_COUNT = 6; // a lesson is finished when all six steps have a result
const MAX_CLASS_LESSONS = 200;

export function classLimits(env: Env) {
  return {
    classes: Number(env.CLASS_LIMIT) || 3,
    students: Number(env.CLASS_STUDENT_LIMIT) || 15,
    teachers: Number(env.CLASS_TEACHER_LIMIT) || 1,
  };
}

const vipOnly = (c: Context<AppEnv>) =>
  c.json({ error: "Lớp học dành cho tài khoản VIP.", code: "vip_only", contact: c.env.CONTACT_URL }, 403);

// ---- Notifications ------------------------------------------------------------------------

export type NotificationKind = "invite" | "accepted" | "declined" | "removed" | "left" | "lesson" | "class_deleted";

interface Note {
  userId: number;
  kind: NotificationKind;
  actorId: number;
  classId?: number | null;
  lessonId?: number | null;
  /** Names kept with the notification, so it still reads well once the class or lesson is gone. */
  data: { className?: string; lessonTitle?: string; role?: string };
}

export function notifyStmt(env: Env, n: Note): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO notifications (user_id, kind, actor_id, class_id, lesson_id, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  ).bind(n.userId, n.kind, n.actorId, n.classId ?? null, n.lessonId ?? null, JSON.stringify(n.data));
}

classes.get("/notifications", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.kind, n.class_id, n.lesson_id, n.data, n.read_at, n.created_at, a.login AS actor,
            (SELECT cm.status FROM class_members cm WHERE cm.class_id = n.class_id AND cm.user_id = n.user_id) AS my_status
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ?1 ORDER BY n.id DESC LIMIT 60`,
  )
    .bind(user.id)
    .all<{ data: string }>();
  return c.json({ notifications: results.map((n) => ({ ...n, data: JSON.parse(n.data || "{}") })) });
});

classes.get("/notifications/unread", async (c) => {
  return c.json({ unread: await unreadCount(c.env, c.get("user").id) });
});

export async function unreadCount(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Marks every notification read. */
classes.post("/notifications/read", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ?1 AND read_at IS NULL")
    .bind(c.get("user").id)
    .run();
  return c.json({ ok: true });
});

// ---- Membership --------------------------------------------------------------------------

interface ClassRow {
  id: number;
  name: string;
  description: string;
  level: string | null;
  owner_id: number;
  owner: string;
  created_at: string;
  my_role: "owner" | "teacher" | "student" | null;
  my_status: "invited" | "active" | null;
  invited_by: string | null;
}

interface Access {
  cls: ClassRow;
  /** Admin, or an active owner / co-teacher who is still VIP. */
  manage: boolean;
  /** Admin or the owner: invites co-teachers, deletes the class. */
  own: boolean;
}

/** The class and what the user may do in it; null when the class does not exist. */
export async function access(env: Env, classId: number, user: User): Promise<Access | null> {
  if (!Number.isInteger(classId)) return null;
  const cls = await env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.level, c.owner_id, c.created_at, o.login AS owner,
            m.role AS my_role, m.status AS my_status, ib.login AS invited_by
       FROM classes c JOIN users o ON o.id = c.owner_id
       LEFT JOIN class_members m ON m.class_id = c.id AND m.user_id = ?2
       LEFT JOIN users ib ON ib.id = m.invited_by
      WHERE c.id = ?1`,
  )
    .bind(classId, user.id)
    .first<ClassRow>();
  if (!cls) return null;
  const admin = user.role === "admin";
  const teaching = cls.my_status === "active" && (cls.my_role === "owner" || cls.my_role === "teacher");
  return { cls, manage: admin || (teaching && canTeach(user)), own: admin || (cls.my_role === "owner" && canTeach(user)) };
}

/** Adds a lesson to a class and tells its students. False when it was already there or the class is full. */
export async function addLesson(env: Env, cls: { id: number; name: string }, lesson: { id: number; title: string }, actor: User) {
  const row = await env.DB.prepare(
    `INSERT OR IGNORE INTO class_lessons (class_id, lesson_id, added_by, position)
     SELECT ?1, ?2, ?3, COALESCE(MAX(position), 0) + 1 FROM class_lessons WHERE class_id = ?1 HAVING COUNT(*) < ?4
     RETURNING lesson_id`,
  )
    .bind(cls.id, lesson.id, actor.id, MAX_CLASS_LESSONS)
    .first();
  if (!row) return false;
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, kind, actor_id, class_id, lesson_id, data)
     SELECT user_id, 'lesson', ?2, ?1, ?3, ?4 FROM class_members WHERE class_id = ?1 AND status = 'active' AND role = 'student'`,
  )
    .bind(cls.id, actor.id, lesson.id, JSON.stringify({ className: cls.name, lessonTitle: lesson.title }))
    .run();
  return true;
}

// ---- Classes ----------------------------------------------------------------------------

/** Per class: lessons the given member finished (all steps) and started. */
const MEMBER_PROGRESS = (member: string) => `
  (SELECT COUNT(*) FROM class_lessons cl WHERE cl.class_id = c.id
      AND (SELECT COUNT(*) FROM lesson_progress p WHERE p.lesson_id = cl.lesson_id AND p.user_id = ${member}) >= ${STEP_COUNT}) AS done,
  (SELECT COUNT(*) FROM class_lessons cl WHERE cl.class_id = c.id
      AND EXISTS (SELECT 1 FROM lesson_progress p WHERE p.lesson_id = cl.lesson_id AND p.user_id = ${member})) AS started`;

/** The classes I teach or learn in, and my pending invites. */
classes.get("/classes", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.level, c.owner_id, c.created_at, o.login AS owner,
            m.role AS my_role, m.status AS my_status, ib.login AS invited_by,
            (SELECT COUNT(*) FROM class_members x WHERE x.class_id = c.id AND x.role = 'student' AND x.status = 'active') AS students,
            (SELECT COUNT(*) FROM class_lessons cl WHERE cl.class_id = c.id) AS lessons,
            ${MEMBER_PROGRESS("?1")}
       FROM class_members m JOIN classes c ON c.id = m.class_id JOIN users o ON o.id = c.owner_id
       LEFT JOIN users ib ON ib.id = m.invited_by
      WHERE m.user_id = ?1
      ORDER BY m.status = 'active', c.created_at`,
  )
    .bind(user.id)
    .all<ClassRow>();
  return c.json({
    classes: results,
    canTeach: canTeach(user),
    owned: results.filter((r) => r.my_role === "owner").length,
    limits: classLimits(c.env),
    unlimited: user.role === "admin",
  });
});

function readClassFields(body: { name?: unknown; description?: unknown; level?: unknown }) {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 60) : undefined;
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : undefined;
  const level = body.level === undefined ? undefined : LEVELS.includes(String(body.level)) ? String(body.level) : null;
  return { name, description, level };
}

classes.post("/classes", async (c) => {
  const user = c.get("user");
  if (!canTeach(user)) return vipOnly(c);
  const f = readClassFields(await c.req.json().catch(() => ({})));
  if (!f.name) return c.json({ error: "Hãy đặt tên lớp." }, 400);
  const lim = classLimits(c.env);
  const row = await c.env.DB.prepare(
    `INSERT INTO classes (owner_id, name, description, level)
     SELECT ?1, ?2, ?3, ?4 WHERE ?5 OR (SELECT COUNT(*) FROM classes WHERE owner_id = ?1) < ?6 RETURNING id`,
  )
    .bind(user.id, f.name, f.description ?? "", f.level ?? null, user.role === "admin" ? 1 : 0, lim.classes)
    .first<{ id: number }>();
  if (!row) return c.json({ error: `Bạn đã có đủ ${lim.classes} lớp. Xoá bớt một lớp để mở lớp mới.` }, 409);
  await c.env.DB.prepare(
    "INSERT INTO class_members (class_id, user_id, role, status, joined_at) VALUES (?1, ?2, 'owner', 'active', datetime('now'))",
  )
    .bind(row.id, user.id)
    .run();
  return c.json({ id: row.id });
});

classes.get("/classes/:id", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a || (!a.cls.my_status && user.role !== "admin")) return c.json({ error: "Không tìm thấy lớp." }, 404);
  const me = { role: a.cls.my_role, status: a.cls.my_status, manage: a.manage, own: a.own };
  const lim = classLimits(c.env);
  // Someone with a pending invite sees the class card and the invite, nothing more.
  if (a.cls.my_status === "invited") return c.json({ class: a.cls, me, members: [], lessons: [], limits: lim });

  const [members, lessons] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT m.user_id AS id, u.login, m.role, m.status, m.created_at, m.joined_at, ib.login AS invited_by,
              ${MEMBER_PROGRESS("m.user_id")},
              (SELECT COALESCE(SUM(x.amount), 0) FROM xp_events x WHERE x.user_id = m.user_id AND x.created_at >= ${WEEK_START}) AS week_xp,
              (SELECT MAX(p.updated_at) FROM lesson_progress p JOIN class_lessons cl ON cl.lesson_id = p.lesson_id AND cl.class_id = c.id
                WHERE p.user_id = m.user_id) AS last_active
         FROM class_members m JOIN classes c ON c.id = m.class_id JOIN users u ON u.id = m.user_id
         LEFT JOIN users ib ON ib.id = m.invited_by
        WHERE m.class_id = ?1 AND (?2 OR m.status = 'active')
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END, m.status = 'invited', week_xp DESC, u.login`,
    ).bind(a.cls.id, a.manage ? 1 : 0),
    c.env.DB.prepare(
      `SELECT ${LESSON_COLUMNS}, cl.position FROM class_lessons cl JOIN lessons l ON l.id = cl.lesson_id JOIN users u ON u.id = l.user_id
        WHERE cl.class_id = ?2 ORDER BY cl.position, cl.added_at`,
    ).bind(user.id, a.cls.id),
  ]);
  return c.json({ class: a.cls, me, members: members.results, lessons: lessons.results, limits: lim });
});

classes.patch("/classes/:id", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a) return c.json({ error: "Không tìm thấy lớp." }, 404);
  if (!a.manage) return canTeach(user) ? c.json({ error: "Chỉ giáo viên của lớp mới sửa được." }, 403) : vipOnly(c);
  const f = readClassFields(await c.req.json().catch(() => ({})));
  if (f.name === "") return c.json({ error: "Hãy đặt tên lớp." }, 400);
  await c.env.DB.prepare(
    `UPDATE classes SET name = COALESCE(?2, name), description = COALESCE(?3, description),
            level = CASE WHEN ?4 THEN ?5 ELSE level END WHERE id = ?1`,
  )
    .bind(a.cls.id, f.name ?? null, f.description ?? null, f.level !== undefined ? 1 : 0, f.level ?? null)
    .run();
  return c.json({ ok: true });
});

classes.delete("/classes/:id", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a) return c.json({ error: "Không tìm thấy lớp." }, 404);
  if (!a.own) return c.json({ error: "Chỉ chủ lớp mới xoá được lớp." }, 403);
  await c.env.DB.batch([
    // Members hear about it; pending invites to the class disappear.
    c.env.DB.prepare(
      `INSERT INTO notifications (user_id, kind, actor_id, data)
       SELECT user_id, 'class_deleted', ?2, ?3 FROM class_members WHERE class_id = ?1 AND status = 'active' AND user_id != ?2`,
    ).bind(a.cls.id, user.id, JSON.stringify({ className: a.cls.name })),
    c.env.DB.prepare("DELETE FROM notifications WHERE class_id = ?1 AND kind = 'invite'").bind(a.cls.id),
    c.env.DB.prepare("DELETE FROM classes WHERE id = ?1").bind(a.cls.id),
  ]);
  return c.json({ ok: true });
});

// ---- Invites ------------------------------------------------------------------------------

classes.post("/classes/:id/invites", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a) return c.json({ error: "Không tìm thấy lớp." }, 404);
  if (!a.manage) return canTeach(user) ? c.json({ error: "Chỉ giáo viên của lớp mới mời được." }, 403) : vipOnly(c);
  const body = await c.req.json<{ who?: unknown; role?: unknown }>().catch(() => ({}) as never);
  const role = body.role === "teacher" ? "teacher" : "student";
  if (role === "teacher" && !a.own) return c.json({ error: "Chỉ chủ lớp mới mời giáo viên cùng đứng lớp." }, 403);

  const who = typeof body.who === "string" ? body.who.trim().toLowerCase().replace(/^@/, "").slice(0, 254) : "";
  if (!who) return c.json({ error: "Nhập tên đăng nhập hoặc email." }, 400);
  const byEmail = who.includes("@");
  const target = await c.env.DB.prepare(`SELECT id, login, role FROM users WHERE ${byEmail ? "email" : "login"} = ?1`)
    .bind(who)
    .first<Pick<User, "id" | "login" | "role">>();
  if (!target || target.role === "blocked") {
    return c.json({ error: byEmail ? "Không có tài khoản nào dùng email này." : "Không tìm thấy tên đăng nhập này." }, 404);
  }
  if (target.id === user.id) return c.json({ error: "Bạn đã ở trong lớp này." }, 400);
  const existing = await c.env.DB.prepare("SELECT status FROM class_members WHERE class_id = ?1 AND user_id = ?2")
    .bind(a.cls.id, target.id)
    .first<{ status: string }>();
  if (existing) {
    return c.json({ error: existing.status === "invited" ? `Đã mời ${target.login}, đang chờ trả lời.` : `${target.login} đã ở trong lớp.` }, 409);
  }
  if (role === "teacher" && !canTeach(target)) {
    return c.json({ error: "Giáo viên cùng đứng lớp cần là tài khoản VIP." }, 400);
  }

  const lim = classLimits(c.env);
  const limit = role === "teacher" ? lim.teachers : lim.students;
  const row = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO class_members (class_id, user_id, role, status, invited_by)
     SELECT ?1, ?2, ?3, 'invited', ?4 WHERE ?6 OR (SELECT COUNT(*) FROM class_members WHERE class_id = ?1 AND role = ?3) < ?5
     RETURNING user_id`,
  )
    .bind(a.cls.id, target.id, role, user.id, limit, user.role === "admin" ? 1 : 0)
    .first();
  if (!row) {
    return c.json(
      {
        error:
          role === "teacher"
            ? `Lớp đã có ${limit} giáo viên cùng đứng lớp.`
            : `Lớp đã đủ ${limit} học sinh (tính cả lời mời đang chờ).`,
      },
      409,
    );
  }
  await notifyStmt(c.env, {
    userId: target.id,
    kind: "invite",
    actorId: user.id,
    classId: a.cls.id,
    data: { className: a.cls.name, role },
  }).run();
  return c.json({ ok: true, member: { id: target.id, login: target.login } });
});

/** The invitee says yes (accept: true) or no. */
classes.post("/classes/:id/join", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a || a.cls.my_status !== "invited") return c.json({ error: "Lời mời này không còn nữa." }, 404);
  const body = await c.req.json<{ accept?: boolean }>().catch(() => ({}) as never);
  const accept = body.accept === true;
  const row = await c.env.DB.prepare(
    accept
      ? `UPDATE class_members SET status = 'active', joined_at = datetime('now')
          WHERE class_id = ?1 AND user_id = ?2 AND status = 'invited' RETURNING role, invited_by`
      : "DELETE FROM class_members WHERE class_id = ?1 AND user_id = ?2 AND status = 'invited' RETURNING role, invited_by",
  )
    .bind(a.cls.id, user.id)
    .first<{ role: string; invited_by: number | null }>();
  if (!row) return c.json({ error: "Lời mời này không còn nữa." }, 404);
  await c.env.DB.batch([
    notifyStmt(c.env, {
      userId: row.invited_by ?? a.cls.owner_id,
      kind: accept ? "accepted" : "declined",
      actorId: user.id,
      classId: a.cls.id,
      data: { className: a.cls.name, role: row.role },
    }),
    c.env.DB.prepare(
      "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ?1 AND class_id = ?2 AND kind = 'invite' AND read_at IS NULL",
    ).bind(user.id, a.cls.id),
  ]);
  return c.json({ ok: true });
});

/** A teacher removes someone (or cancels an invite); a member leaves when the id is their own. */
classes.delete("/classes/:id/members/:userId", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a) return c.json({ error: "Không tìm thấy lớp." }, 404);
  const uid = Number(c.req.param("userId"));
  const target = await c.env.DB.prepare("SELECT role, status FROM class_members WHERE class_id = ?1 AND user_id = ?2")
    .bind(a.cls.id, uid)
    .first<{ role: string; status: string }>();
  if (!target) return c.json({ error: "Người này không ở trong lớp." }, 404);
  if (target.role === "owner") return c.json({ error: "Chủ lớp không rời lớp được; hãy xoá lớp nếu không dùng nữa." }, 400);
  const self = uid === user.id;
  if (!self && (!a.manage || (target.role === "teacher" && !a.own))) {
    return c.json({ error: "Bạn không có quyền xoá người này khỏi lớp." }, 403);
  }

  const stmts = [c.env.DB.prepare("DELETE FROM class_members WHERE class_id = ?1 AND user_id = ?2").bind(a.cls.id, uid)];
  const data = { className: a.cls.name, role: target.role };
  if (target.status === "invited") {
    // A cancelled invite simply disappears from the invitee's notifications.
    stmts.push(c.env.DB.prepare("DELETE FROM notifications WHERE user_id = ?1 AND class_id = ?2 AND kind = 'invite'").bind(uid, a.cls.id));
  } else if (self) {
    stmts.push(notifyStmt(c.env, { userId: a.cls.owner_id, kind: "left", actorId: user.id, classId: a.cls.id, data }));
  } else {
    stmts.push(notifyStmt(c.env, { userId: uid, kind: "removed", actorId: user.id, classId: a.cls.id, data }));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---- Class lessons --------------------------------------------------------------------------

classes.post("/classes/:id/lessons", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a) return c.json({ error: "Không tìm thấy lớp." }, 404);
  if (!a.manage) return canTeach(user) ? c.json({ error: "Chỉ giáo viên của lớp mới thêm bài được." }, 403) : vipOnly(c);
  const body = await c.req.json<{ lessonId?: number }>().catch(() => ({}) as never);
  const lesson = await c.env.DB.prepare("SELECT id, title, is_public, user_id FROM lessons WHERE id = ?1")
    .bind(Number(body.lessonId))
    .first<{ id: number; title: string; is_public: number; user_id: number }>();
  if (!lesson) return c.json({ error: "Không tìm thấy bài học." }, 404);
  if (!lesson.is_public && lesson.user_id !== user.id && user.role !== "admin") {
    return c.json({ error: "Chỉ thêm được bài công khai hoặc bài của chính bạn." }, 403);
  }
  if (!(await addLesson(c.env, a.cls, lesson, user))) {
    const there = await c.env.DB.prepare("SELECT 1 FROM class_lessons WHERE class_id = ?1 AND lesson_id = ?2").bind(a.cls.id, lesson.id).first();
    return c.json({ error: there ? "Bài này đã có trong lớp." : `Mỗi lớp có tối đa ${MAX_CLASS_LESSONS} bài.` }, 409);
  }
  return c.json({ ok: true });
});

classes.delete("/classes/:id/lessons/:lessonId", async (c) => {
  const user = c.get("user");
  const a = await access(c.env, Number(c.req.param("id")), user);
  if (!a) return c.json({ error: "Không tìm thấy lớp." }, 404);
  if (!a.manage) return c.json({ error: "Chỉ giáo viên của lớp mới bỏ bài được." }, 403);
  await c.env.DB.prepare("DELETE FROM class_lessons WHERE class_id = ?1 AND lesson_id = ?2")
    .bind(a.cls.id, Number(c.req.param("lessonId")))
    .run();
  return c.json({ ok: true });
});
