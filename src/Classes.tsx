// Classes: VIP (and admin) accounts teach, everyone can be invited to learn.
import { ArrowLeft, Check, MagnifyingGlass, PencilSimple, Plus, SignOut, Trash, UserPlus, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, type ClassDetail, type ClassList, type ClassMember, type ClassSummary, type LessonRow, type Me } from "./api";
import { Fx, LEVELS, LEVEL_LABEL } from "./meta";
import { answerInvite, ago } from "./Notifications";
import { LessonCard, Loading, Meter } from "./ui";

const ROLE_NAME = { owner: "Chủ lớp", teacher: "Giáo viên", student: "Học sinh" } as const;

// ---- All my classes ----------------------------------------------------------------------------

export function Classes({ me, onChange }: { me: Me; onChange: () => void }) {
  const [d, setD] = useState<ClassList | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    api<ClassList>("/api/classes")
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (!d) return error ? <p className="error center">{error}</p> : <Loading />;
  const invites = d.classes.filter((c) => c.my_status === "invited");
  const teaching = d.classes.filter((c) => c.my_status === "active" && c.my_role !== "student");
  const learning = d.classes.filter((c) => c.my_status === "active" && c.my_role === "student");
  const full = !d.unlimited && d.owned >= d.limits.classes;

  const answer = async (c: ClassSummary, accept: boolean) => {
    const err = await answerInvite(c.id, accept);
    setError(err);
    if (err) return;
    onChange();
    if (accept) location.hash = `#/class/${c.id}`;
    else load();
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">Lớp học</h1>
        <p className="muted">
          {d.canTeach
            ? `Mở lớp, mời học sinh và giao bài riêng cho lớp. Bạn mở được ${d.unlimited ? "không giới hạn" : `tối đa ${d.limits.classes}`} lớp, mỗi lớp ${d.limits.students} học sinh và ${d.limits.teachers} giáo viên cùng đứng lớp.`
            : "Các lớp bạn được giáo viên mời vào. Bài riêng của lớp chỉ học sinh trong lớp mới mở được."}
        </p>
      </div>
      {error && <p className="error">{error}</p>}

      {invites.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Lời mời đang chờ</h2>
          {invites.map((c) => (
            <div key={c.id} className="card invite-card">
              <Fx name="envelope" size={44} tile />
              <div className="grow">
                <b>{c.name}</b>
                <p className="small muted">
                  {c.invited_by ?? c.owner} mời bạn {c.my_role === "teacher" ? "làm giáo viên cùng đứng lớp" : "vào lớp"}
                  {c.level ? ` · ${c.level}` : ""}
                </p>
              </div>
              <div className="row gap wrap">
                <button className="btn primary small" onClick={() => answer(c, true)}>
                  <Check size={16} weight="bold" /> Vào lớp
                </button>
                <button className="btn ghost small" onClick={() => answer(c, false)}>
                  <X size={16} weight="bold" /> Từ chối
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {d.canTeach ? (
        creating ? (
          <ClassForm
            onCancel={() => setCreating(false)}
            onSaved={(id) => {
              onChange();
              location.hash = `#/class/${id}`;
            }}
          />
        ) : (
          <button className="new-class" onClick={() => setCreating(true)} disabled={full}>
            <Fx name="classroom" size={48} tile />
            <span className="grow">
              <b>Mở lớp mới</b>
              <span className="small muted">
                {full
                  ? `Bạn đã có đủ ${d.limits.classes} lớp. Xoá bớt một lớp để mở lớp mới.`
                  : d.unlimited
                    ? "Quản trị viên mở được không giới hạn lớp."
                    : `Đã dùng ${d.owned}/${d.limits.classes} lớp.`}
              </span>
            </span>
            {!full && <Plus size={22} weight="bold" />}
          </button>
        )
      ) : (
        teaching.length === 0 && (
          <div className="card vip-card">
            <Fx name="classroom" size={48} tile />
            <div>
              <b>Muốn tự mở lớp?</b>
              <p className="small muted">
                Mở lớp, mời học sinh và soạn bài riêng bằng AI là tính năng của tài khoản VIP. Liên hệ{" "}
                <a href={me.contact} target="_blank" rel="noreferrer">
                  {me.contact.replace(/^https?:\/\//, "")}
                </a>{" "}
                để nâng cấp.
              </p>
            </div>
          </div>
        )
      )}

      {teaching.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Lớp bạn dạy</h2>
          <div className="class-grid">
            {teaching.map((c) => (
              <ClassCard key={c.id} c={c} limit={d.limits.students} />
            ))}
          </div>
        </section>
      )}
      {learning.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Lớp bạn học</h2>
          <div className="class-grid">
            {learning.map((c) => (
              <ClassCard key={c.id} c={c} limit={d.limits.students} />
            ))}
          </div>
        </section>
      )}
      {d.classes.length === 0 && (
        <div className="empty">
          <Fx name="students" size={64} />
          <p className="muted">
            Bạn chưa ở lớp nào. Khi giáo viên mời, lời mời sẽ hiện ở đây và trong Thông báo.
            {!me.user.email && (
              <>
                {" "}
                Thêm email trong <a href="#/me">Hồ sơ</a> để giáo viên mời bạn bằng email.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function ClassCard({ c, limit }: { c: ClassSummary; limit: number }) {
  const student = c.my_role === "student";
  return (
    <a className="class-card" href={`#/class/${c.id}`}>
      <div className={`class-cover lvl-${c.level ?? "own"}`}>
        <Fx name="classroom" size={44} className="lc-fx" />
        {c.level && <span className="lvl light">{c.level}</span>}
        {!student && <span className="chip-light">{ROLE_NAME[c.my_role ?? "teacher"]}</span>}
      </div>
      <div className="lc-body">
        <h3>{c.name}</h3>
        <p className="small muted clamp2">{c.description || `Giáo viên: ${c.owner}`}</p>
        <div className="lc-foot small muted">
          <span>
            <Fx name="students" size={16} /> {c.students}/{limit} học sinh
          </span>
          <span>
            <Fx name="books" size={16} /> {c.lessons} bài
          </span>
        </div>
        {student && c.lessons > 0 && (
          <>
            <Meter value={c.done} max={c.lessons} tone="good" />
            <span className="small muted">
              Đã xong {c.done}/{c.lessons} bài
            </span>
          </>
        )}
      </div>
    </a>
  );
}

function ClassForm({
  initial,
  classId,
  onCancel,
  onSaved,
}: {
  initial?: { name: string; description: string; level: string | null };
  classId?: number;
  onCancel: () => void;
  onSaved: (id: number) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [level, setLevel] = useState(initial?.level ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name, description, level: level || null };
      if (classId) {
        await api(`/api/classes/${classId}`, { method: "PATCH", body });
        onSaved(classId);
      } else {
        const r = await api<{ id: number }>("/api/classes", { body });
        onSaved(r.id);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="card class-form" onSubmit={save}>
      <h2 className="card-title">
        <Fx name="classroom" size={34} tile /> {classId ? "Sửa thông tin lớp" : "Mở lớp mới"}
      </h2>
      <label className="field">
        Tên lớp
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="Ví dụ: Tiếng Anh giao tiếp tối thứ 3" />
      </label>
      <label className="field">
        Giới thiệu (không bắt buộc)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Lớp học gì, lịch học, nội quy…"
        />
      </label>
      <div className="field">
        Trình độ của lớp
        <div className="seg" role="group" aria-label="Trình độ của lớp">
          {["", ...LEVELS.map((l) => l.key)].map((lv) => (
            <button type="button" key={lv || "any"} className={level === lv ? "on" : ""} onClick={() => setLevel(lv)}>
              {lv || "Nhiều cấp"}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row gap wrap">
        <button className="btn primary" disabled={busy || !name.trim()}>
          {classId ? "Lưu" : "Mở lớp"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}

// ---- One class --------------------------------------------------------------------------------

export function ClassPage({ id, me, onChange }: { id: number; me: Me; onChange: () => void }) {
  const [d, setD] = useState<ClassDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"lessons" | "members">("lessons");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);

  const load = useCallback(() => {
    api<ClassDetail>(`/api/classes/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (!d) return error ? <p className="error center">{error}</p> : <Loading />;
  const c = d.class;
  const students = d.members.filter((m) => m.role === "student");
  const activeStudents = students.filter((m) => m.status === "active");
  const coTeachers = d.members.filter((m) => m.role === "teacher");
  const mine = d.members.find((m) => m.id === me.user.id);

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError("");
    try {
      await fn();
      after ? after() : load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const back = (
    <a href="#/classes" className="back">
      <ArrowLeft size={18} weight="bold" /> Lớp học
    </a>
  );

  if (d.me.status === "invited") {
    return (
      <div className="stack-lg narrow">
        {back}
        <div className="card invite-card big">
          <Fx name="envelope" size={56} tile />
          <div className="grow">
            <h1 className="class-title">{c.name}</h1>
            <p className="muted">
              {c.invited_by ?? c.owner} mời bạn {d.me.role === "teacher" ? "làm giáo viên cùng đứng lớp" : "vào lớp này"}.
              {c.description && ` ${c.description}`}
            </p>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row gap wrap">
          <button
            className="btn primary"
            onClick={() => act(() => api(`/api/classes/${c.id}/join`, { body: { accept: true } }), () => (onChange(), load()))}
          >
            <Check size={18} weight="bold" /> Vào lớp
          </button>
          <button
            className="btn ghost"
            onClick={() => act(() => api(`/api/classes/${c.id}/join`, { body: { accept: false } }), () => (location.hash = "#/classes"))}
          >
            <X size={18} weight="bold" /> Từ chối
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      {back}
      {editing ? (
        <ClassForm
          initial={c}
          classId={c.id}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      ) : (
        <header className={`class-hero lvl-${c.level ?? "own"}`}>
          <Fx name="classroom" size={72} className="lesson-hero-fx" />
          <div>
            <div className="row gap wrap">
              {c.level && (
                <span className="lvl light">
                  {c.level} · {LEVEL_LABEL[c.level]}
                </span>
              )}
              {d.me.role && <span className="chip-light">Bạn là {ROLE_NAME[d.me.role].toLowerCase()}</span>}
            </div>
            <h1>{c.name}</h1>
            {c.description && <p>{c.description}</p>}
            <span className="small hero-meta">
              Chủ lớp {c.owner}
              {coTeachers.filter((t) => t.status === "active").map((t) => ` · cùng dạy: ${t.login}`)} · {activeStudents.length}/
              {d.limits.students} học sinh · {d.lessons.length} bài
            </span>
          </div>
        </header>
      )}

      {!editing && (
        <div className="row gap wrap">
          {d.me.manage && (
            <button className="btn small ghost" onClick={() => setEditing(true)}>
              <PencilSimple size={18} /> Sửa thông tin
            </button>
          )}
          {confirm ? (
            <>
              <span className="small">
                {confirm === "delete"
                  ? "Xoá lớp? Học sinh sẽ không mở được các bài riêng của lớp nữa. Bài học của bạn vẫn còn."
                  : "Rời lớp? Bạn sẽ không mở được các bài riêng của lớp nữa."}
              </span>
              <button
                className="btn small danger"
                onClick={() =>
                  act(
                    () =>
                      confirm === "delete"
                        ? api(`/api/classes/${c.id}`, { method: "DELETE" })
                        : api(`/api/classes/${c.id}/members/${me.user.id}`, { method: "DELETE" }),
                    () => {
                      onChange();
                      location.hash = "#/classes";
                    },
                  )
                }
              >
                {confirm === "delete" ? "Xoá lớp" : "Rời lớp"}
              </button>
              <button className="btn small ghost" onClick={() => setConfirm(null)}>
                Huỷ
              </button>
            </>
          ) : d.me.own ? (
            <button className="btn small ghost danger-text" onClick={() => setConfirm("delete")}>
              <Trash size={18} /> Xoá lớp
            </button>
          ) : (
            d.me.role !== "owner" &&
            d.me.status === "active" && (
              <button className="btn small ghost danger-text" onClick={() => setConfirm("leave")}>
                <SignOut size={18} /> Rời lớp
              </button>
            )
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="seg big-seg" role="tablist" aria-label="Nội dung lớp">
        <button role="tab" aria-selected={tab === "lessons"} className={tab === "lessons" ? "on" : ""} onClick={() => setTab("lessons")}>
          Bài học ({d.lessons.length})
        </button>
        <button role="tab" aria-selected={tab === "members"} className={tab === "members" ? "on" : ""} onClick={() => setTab("members")}>
          Thành viên ({d.members.filter((m) => m.status === "active").length})
        </button>
      </div>

      {tab === "lessons" ? (
        <ClassLessons d={d} me={me} mine={mine} act={act} reload={load} />
      ) : (
        <ClassMembers d={d} me={me} act={act} reload={load} />
      )}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, after?: () => void) => Promise<void>;

function ClassLessons({ d, me, mine, act, reload }: { d: ClassDetail; me: Me; mine?: ClassMember; act: Act; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const c = d.class;
  return (
    <section className="stack-lg">
      {mine?.role === "student" && d.lessons.length > 0 && (
        <div className="card class-progress">
          <Fx name="bullseye" size={40} tile />
          <div className="grow">
            <b>
              Bạn đã xong {mine.done}/{d.lessons.length} bài của lớp
            </b>
            <Meter value={mine.done} max={d.lessons.length} tone="good" />
          </div>
        </div>
      )}
      {d.me.manage &&
        (adding ? (
          <LessonPicker classId={c.id} me={me} have={new Set(d.lessons.map((l) => l.id))} onAdded={reload} onClose={() => setAdding(false)} />
        ) : (
          <div className="row gap wrap">
            <button className="btn primary small" onClick={() => setAdding(true)}>
              <Plus size={18} weight="bold" /> Thêm bài vào lớp
            </button>
            {me.canTeach && (
              <a className="btn ghost small" href={`#/library?class=${c.id}`}>
                <Fx name="robot" size={18} /> Soạn bài mới cho lớp
              </a>
            )}
          </div>
        ))}
      {d.lessons.length === 0 ? (
        <div className="empty">
          <Fx name="books" size={64} />
          <p className="muted">
            {d.me.manage
              ? "Lớp chưa có bài nào. Thêm bài từ thư viện, hoặc soạn bài riêng bằng AI chỉ cho học sinh của lớp."
              : "Giáo viên chưa giao bài nào. Bạn sẽ nhận thông báo khi có bài mới."}
          </p>
        </div>
      ) : (
        <div className="lib-grid">
          {d.lessons.map((l) => (
            <div key={l.id} className="class-lesson">
              <LessonCard l={l} />
              {d.me.manage && (
                <button
                  className="btn small ghost danger-text"
                  onClick={() => act(() => api(`/api/classes/${c.id}/lessons/${l.id}`, { method: "DELETE" }))}
                >
                  <X size={16} weight="bold" /> Bỏ khỏi lớp
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LessonPicker({ classId, me, have, onAdded, onClose }: { classId: number; me: Me; have: Set<number>; onAdded: () => void; onClose: () => void }) {
  const [source, setSource] = useState<"mine" | "">(me.canTeach ? "mine" : "");
  const [q, setQ] = useState("");
  const [list, setList] = useState<LessonRow[] | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<number>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ lessons: LessonRow[] }>(`/api/lessons?scope=library&cat=${source}&q=${encodeURIComponent(q)}`).then((r) =>
        // Only lessons the class can use: public ones and my own.
        setList(r.lessons.filter((l) => l.is_public || l.user_id === me.user.id)),
      );
    }, 200);
    return () => clearTimeout(t);
  }, [source, q, me.user.id]);

  const add = async (l: LessonRow) => {
    setError("");
    try {
      await api(`/api/classes/${classId}/lessons`, { body: { lessonId: l.id } });
      setAdded(new Set(added).add(l.id));
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card picker">
      <div className="row gap wrap picker-head">
        <h2 className="card-title grow">Thêm bài vào lớp</h2>
        <button className="btn small ghost" onClick={onClose}>
          Xong
        </button>
      </div>
      <div className="filters">
        <div className="seg" role="group" aria-label="Nguồn bài">
          <button className={source === "mine" ? "on" : ""} onClick={() => setSource("mine")}>
            Bài của tôi
          </button>
          <button className={source === "" ? "on" : ""} onClick={() => setSource("")}>
            Cả thư viện
          </button>
        </div>
        <label className="search">
          <MagnifyingGlass size={20} />
          <input placeholder="Tìm bài…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!list ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="muted small">
          {source === "mine" ? "Bạn chưa soạn bài nào. Soạn bài trong Thư viện, hoặc chọn từ cả thư viện." : "Không có bài nào khớp."}
        </p>
      ) : (
        <ul className="pick-list">
          {list.slice(0, 40).map((l) => {
            const there = have.has(l.id) || added.has(l.id);
            return (
              <li key={l.id}>
                <span className={`lvl lvl-${l.level}`}>{l.level}</span>
                <span className="grow">
                  <b>{l.title}</b>
                  <span className="small muted">
                    {" "}
                    {l.is_public ? (l.course_order ? "Khoá học Wancha" : `bởi ${l.author}`) : "Bài riêng"}
                  </span>
                </span>
                <button className="btn small primary" disabled={there} onClick={() => add(l)}>
                  {there ? <Check size={16} weight="bold" /> : <Plus size={16} weight="bold" />} {there ? "Đã có" : "Thêm"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ClassMembers({ d, me, act, reload }: { d: ClassDetail; me: Me; act: Act; reload: () => void }) {
  const c = d.class;
  const [who, setWho] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [sent, setSent] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const students = d.members.filter((m) => m.role === "student");
  const pending = students.filter((m) => m.status === "invited").length;
  const teachers = d.members.filter((m) => m.role === "teacher").length;

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSent("");
    setInviteError("");
    setBusy(true);
    try {
      const r = await api<{ member: { login: string } }>(`/api/classes/${c.id}/invites`, { body: { who, role } });
      setSent(r.member.login);
      setWho("");
      reload();
    } catch (err) {
      // Keep what was typed so a typo can be fixed.
      setInviteError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <section className="stack-lg">
      {d.me.manage && (
        <form className="card invite-form" onSubmit={invite}>
          <h2 className="card-title">
            <UserPlus size={26} weight="duotone" /> Mời vào lớp
          </h2>
          <div className="invite-row">
            <input
              className="invite-input"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="Tên đăng nhập hoặc email"
              aria-label="Tên đăng nhập hoặc email"
              autoComplete="off"
              required
            />
            {d.me.own && (
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as "student" | "teacher")} aria-label="Vai trò">
                <option value="student">Học sinh</option>
                <option value="teacher">Giáo viên cùng đứng lớp</option>
              </select>
            )}
            <button className="btn primary" disabled={busy || !who.trim()}>
              Mời
            </button>
          </div>
          <p className="small muted">
            Học sinh: {students.length}/{d.limits.students}
            {pending > 0 && ` (${pending} đang chờ trả lời)`} · Giáo viên cùng đứng lớp: {teachers}/{d.limits.teachers} (cần là tài khoản VIP).
            Người được mời cần bấm “Vào lớp” trong Thông báo.
          </p>
          {sent && <p className="ok-text small">Đã gửi lời mời tới {sent}.</p>}
          {inviteError && <p className="error">{inviteError}</p>}
        </form>
      )}

      <ul className="member-list">
        {d.members.map((m) => {
          const canRemove = d.me.manage && m.role !== "owner" && m.id !== me.user.id && (m.role === "student" || d.me.own);
          return (
            <li key={m.id} className={m.id === me.user.id ? "me" : ""}>
              <span className="avatar">{m.login.slice(0, 1).toUpperCase()}</span>
              <div className="grow member-main">
                <b>{m.login}</b>
                <span className="small muted">
                  {ROLE_NAME[m.role]}
                  {m.status === "invited"
                    ? ` · đang chờ trả lời (mời ${ago(m.created_at)})`
                    : m.role === "student" && d.lessons.length > 0
                      ? ` · xong ${m.done}/${d.lessons.length} bài`
                      : ""}
                  {m.status === "active" && m.last_active ? ` · học ${ago(m.last_active)}` : ""}
                </span>
                {m.status === "active" && m.role === "student" && d.lessons.length > 0 && (
                  <Meter value={m.done} max={d.lessons.length} tone="good" />
                )}
              </div>
              {m.status === "active" && (
                <span className="member-xp">
                  <b>{m.week_xp}</b>
                  <span className="small muted">XP tuần</span>
                </span>
              )}
              {canRemove &&
                (removing === m.id ? (
                  <span className="row gap">
                    <button
                      className="btn small danger"
                      onClick={() => act(() => api(`/api/classes/${c.id}/members/${m.id}`, { method: "DELETE" }), undefined).then(() => setRemoving(null))}
                    >
                      {m.status === "invited" ? "Huỷ mời" : "Xoá"}
                    </button>
                    <button className="btn small ghost" onClick={() => setRemoving(null)}>
                      Không
                    </button>
                  </span>
                ) : (
                  <button
                    className="icon-btn"
                    title={m.status === "invited" ? "Huỷ lời mời" : "Xoá khỏi lớp"}
                    aria-label={m.status === "invited" ? `Huỷ lời mời ${m.login}` : `Xoá ${m.login} khỏi lớp`}
                    onClick={() => setRemoving(m.id)}
                  >
                    <X size={18} weight="bold" />
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
