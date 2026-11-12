import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, onApiError, type ApiError, type LessonDetail, type LessonRow, type Me } from "./api";
import { Exercise } from "./Exercise";
import { Login } from "./Login";
import { MASCOT_CREDIT, Mascot } from "./Mascot";
import { setSoundOn, soundOn } from "./sound";
import { LEVEL_LABEL, STEPS, unitColor } from "./steps";

type Route =
  | { name: "learn" }
  | { name: "library" }
  | { name: "unit"; id: number }
  | { name: "exercise"; id: number; step: string }
  | { name: "rank" }
  | { name: "me" }
  | { name: "admin" };

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  let m = h.match(/^lesson\/(\d+)\/(\w+)/);
  if (m) return { name: "exercise", id: Number(m[1]), step: m[2] };
  m = h.match(/^lesson\/(\d+)/);
  if (m) return { name: "unit", id: Number(m[1]) };
  if (h === "library") return { name: "library" };
  if (h === "rank") return { name: "rank" };
  if (h === "me") return { name: "me" };
  if (h === "admin") return { name: "admin" };
  return { name: "learn" };
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(parseRoute);
  const [locked, setLocked] = useState<ApiError | null>(null);

  const refreshMe = useCallback(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(refreshMe, [refreshMe]);
  useEffect(() => {
    const fn = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", fn);
    return () => removeEventListener("hashchange", fn);
  }, []);
  useEffect(
    () =>
      onApiError((err) => {
        if (err.code === "trial_exhausted" || err.code === "blocked") setLocked(err);
        if (err.code === "unauthenticated") setMe(null);
      }),
    [],
  );

  if (me === undefined) return <div className="boot">Đang tải…</div>;
  if (me === null) return <Login />;

  if (route.name === "exercise") {
    return (
      <>
        <Exercise key={`${route.id}/${route.step}`} lessonId={route.id} step={route.step} me={me} onGame={refreshMe} />
        {locked && <LockedDialog err={locked} onClose={() => setLocked(null)} />}
      </>
    );
  }

  const nav = [
    { href: "#/", icon: "🏠", label: "Học", on: route.name === "learn" || route.name === "unit" },
    { href: "#/library", icon: "📚", label: "Thư viện", on: route.name === "library" },
    { href: "#/rank", icon: "🏅", label: "Xếp hạng", on: route.name === "rank" },
    { href: "#/me", icon: "👤", label: "Hồ sơ", on: route.name === "me" },
    ...(me.user.role === "admin" ? [{ href: "#/admin", icon: "🛠️", label: "Quản trị", on: route.name === "admin" }] : []),
  ];

  return (
    <div className="app">
      <aside className="sidenav">
        <a className="logo" href="#/">
          <span className="logo-mark">EC</span>
          <span>english coach</span>
        </a>
        {nav.map((n) => (
          <a key={n.href} href={n.href} className={n.on ? "navlink on" : "navlink"}>
            <span className="navicon">{n.icon}</span>
            <span>{n.label}</span>
          </a>
        ))}
      </aside>

      <div className="page">
        <header className="statbar">
          <a className="logo logo-mobile" href="#/">
            <span className="logo-mark">EC</span>
          </a>
          <StatPills me={me} />
        </header>
        <main className="content">
          {route.name === "learn" && <Learn me={me} />}
          {route.name === "library" && <Library me={me} onQuota={refreshMe} />}
          {route.name === "unit" && <Unit id={route.id} me={me} />}
          {route.name === "rank" && <Leaderboard me={me} />}
          {route.name === "me" && <Profile me={me} onChange={refreshMe} />}
          {route.name === "admin" && me.user.role === "admin" && <Admin />}
        </main>
      </div>

      <aside className="rightcol">
        <StatPills me={me} />
        <GoalCard me={me} />
        {me.user.role === "admin" && (
          <div className={`card bridge ${me.bridgeOnline ? "ok" : "off"}`}>
            <b>Claude bridge</b> <span>{me.bridgeOnline ? "đang online" : "offline — đang dùng Workers AI"}</span>
          </div>
        )}
        {me.quota.limited && (
          <div className="card quota">
            <b>Dùng thử</b>
            <div className="bar">
              <span style={{ width: `${((me.quota.left ?? 0) / (me.quota.limit ?? 1)) * 100}%` }} />
            </div>
            <span className="muted small">
              Còn {me.quota.left}/{me.quota.limit} lượt AI (tạo bài, chấm nói, giải thích)
            </span>
          </div>
        )}
        <Mascot name="hiyori" className="side-mascot" say={greeting(me)} />
        <p className="credit">{MASCOT_CREDIT}</p>
      </aside>

      <nav className="tabbar">
        {nav.map((n) => (
          <a key={n.href} href={n.href} className={n.on ? "on" : ""} aria-label={n.label}>
            <span>{n.icon}</span>
            <small>{n.label}</small>
          </a>
        ))}
      </nav>

      {locked && <LockedDialog err={locked} onClose={() => setLocked(null)} />}
    </div>
  );
}

function greeting(me: Me): string {
  const g = me.game;
  if (!g.practicedToday && g.streak > 0) return `Giữ chuỗi ${g.streak} ngày nhé, ${me.user.login}!`;
  if (g.todayXp >= g.dailyGoal) return "Hôm nay bạn đạt mục tiêu rồi. Giỏi lắm!";
  if (g.todayXp > 0) return `Còn ${g.dailyGoal - g.todayXp} XP nữa là đạt mục tiêu hôm nay!`;
  return `Chào ${me.user.login}! Học một chút hôm nay nhé?`;
}

function StatPills({ me }: { me: Me }) {
  const g = me.game;
  return (
    <div className="pills">
      <span className={`pill-stat streak ${g.practicedToday ? "lit" : ""}`} title="Chuỗi ngày học liên tiếp">
        🔥 {g.streak}
      </span>
      <span className="pill-stat xp" title="Tổng XP">
        ⚡ {g.xp}
      </span>
      <span className="pill-stat goal" title="XP hôm nay / mục tiêu">
        🎯 {g.todayXp}/{g.dailyGoal}
      </span>
    </div>
  );
}

function GoalCard({ me }: { me: Me }) {
  const g = me.game;
  const pct = Math.min(100, Math.round((g.todayXp / g.dailyGoal) * 100));
  return (
    <div className="card goal-card">
      <div className="goal-head">
        <b>Mục tiêu hôm nay</b>
        <span className="muted small">
          {g.todayXp}/{g.dailyGoal} XP
        </span>
      </div>
      <div className="bar big">
        <span style={{ width: `${pct}%` }} />
      </div>
      {pct >= 100 && <span className="small good">Hoàn thành! 🎉</span>}
    </div>
  );
}

function LockedDialog({ err, onClose }: { err: ApiError; onClose: () => void }) {
  const contact = err.contact || "https://github.com/byocao";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <Mascot name="haru" mood="sad" className="dialog-mascot" />
        <h2>{err.code === "blocked" ? "Tài khoản đã bị khoá" : "Hết lượt dùng thử"}</h2>
        <p>
          {err.code === "blocked"
            ? "Tài khoản của bạn không còn dùng được các tính năng AI."
            : "Bạn đã dùng hết lượt AI miễn phí. Bạn vẫn học được các bài có sẵn trong Thư viện: nghe, xếp câu, chép chính tả, đọc và trả lời câu hỏi."}
        </p>
        <p>
          Muốn dùng tiếp, hãy liên hệ{" "}
          <a href={contact} target="_blank" rel="noreferrer">
            {contact.replace(/^https?:\/\//, "")}
          </a>
          .
        </p>
        <button className="btn primary full" onClick={onClose}>
          Đã hiểu
        </button>
      </div>
    </div>
  );
}

// ---- Learn: my path ------------------------------------------------------------

function useNarrow(): boolean {
  const q = "(max-width: 1180px)";
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const fn = () => setNarrow(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);
  return narrow;
}

function Learn({ me }: { me: Me }) {
  const [lessons, setLessons] = useState<LessonRow[] | null>(null);
  const narrow = useNarrow();
  useEffect(() => {
    api<{ lessons: LessonRow[] }>("/api/lessons?scope=mine").then((r) => setLessons(r.lessons));
  }, []);

  if (!lessons) return <p className="muted center">Đang tải…</p>;
  if (lessons.length === 0) {
    return (
      <div className="empty">
        <Mascot name="hiyori" mood="cheer" className="empty-mascot" say="Bắt đầu thôi! Chọn một bài trong Thư viện hoặc nhờ AI soạn bài mới." />
        <a className="btn primary" href="#/library">
          Mở thư viện
        </a>
      </div>
    );
  }
  return (
    <div className="path-page">
      {narrow && (
        <div className="greet">
          <Mascot name="hiyori" className="greet-mascot" frame={0.42} />
          <div className="speech-bubble">{greeting(me)}</div>
        </div>
      )}
      <h1 className="page-title">Lộ trình của {me.user.login}</h1>
      {lessons.map((l) => (
        <UnitPath key={l.id} lesson={l} />
      ))}
      <a className="btn ghost full" href="#/library">
        + Thêm bài từ thư viện
      </a>
    </div>
  );
}

/** One lesson drawn as a Duolingo-style unit: a coloured banner and five winding step nodes. */
function UnitPath({
  lesson,
  progress,
}: {
  lesson: Pick<LessonRow, "id" | "title" | "level" | "topic"> & { my_progress?: string | null };
  progress?: Record<string, number>;
}) {
  const prog: Record<string, number> = progress ?? (lesson.my_progress ? JSON.parse(lesson.my_progress) : {});
  const done = prog ? STEPS.filter((s) => s.key in prog).length : 0;
  const next = prog ? STEPS.findIndex((s) => !(s.key in prog)) : 0;
  const color = unitColor(lesson.id);
  const offsets = [0, 52, 78, 52, 0];

  return (
    <section className="unit">
      <a className={`unit-banner c-${color}`} href={`#/lesson/${lesson.id}`}>
        <div>
          <small>
            {lesson.level} · {LEVEL_LABEL[lesson.level] ?? ""}
          </small>
          <h2>{lesson.title}</h2>
        </div>
        <span className="unit-count">
          {done}/{STEPS.length}
        </span>
      </a>
      <div className="nodes">
        {STEPS.map((s, i) => {
          const isDone = prog ? s.key in prog : false;
          const isNext = i === next;
          return (
            <div key={s.key} className="node-row" style={{ transform: `translateX(${offsets[i] - 40}px)` }}>
              {isNext && <span className="start-bubble">BẮT ĐẦU</span>}
              <a
                href={`#/lesson/${lesson.id}/${s.key}`}
                className={`node c-${color} ${isDone ? "done" : ""} ${isNext ? "next" : ""}`}
                title={`${s.label}: ${s.hint}`}
              >
                <span>{isDone ? "⭐" : s.icon}</span>
              </a>
              <span className="node-label">
                {s.label}
                {isDone && prog ? <em> · {prog[s.key]}%</em> : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- Unit page (one lesson) -------------------------------------------------------

function Unit({ id, me }: { id: number; me: Me }) {
  const [d, setD] = useState<LessonDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<LessonDetail>(`/api/lessons/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  const progress = useMemo(() => (d ? Object.fromEntries(d.progress.map((p) => [p.step, p.best])) : undefined), [d]);
  if (error) return <p className="error center">{error}</p>;
  if (!d) return <p className="muted center">Đang tải…</p>;
  const l = d.lesson;
  const canDelete = l.user_id === me.user.id || me.user.role === "admin";

  const togglePublic = async () => {
    await api(`/api/lessons/${l.id}`, { method: "PATCH", body: { is_public: !l.is_public } });
    setD({ ...d, lesson: { ...l, is_public: l.is_public ? 0 : 1 } });
  };
  const remove = async () => {
    if (!window.confirm("Xoá bài học này khỏi thư viện? Không khôi phục được.")) return;
    await api(`/api/lessons/${l.id}`, { method: "DELETE" });
    location.hash = "#/library";
  };

  return (
    <div className="path-page">
      <a href="#/" className="back">
        ← Lộ trình
      </a>
      <UnitPath lesson={l} progress={progress} />
      <section className="card">
        <p className="summary">{l.content.summary_vi}</p>
        <p className="muted small">
          {l.content.sentences.length} câu · {l.content.vocabulary.length} từ vựng · soạn bởi{" "}
          {l.provider === "claude" ? "Claude" : "Workers AI"} · tạo bởi {l.author}
        </p>
        <div className="vocab-chips">
          {l.content.vocabulary.map((v) => (
            <span key={v.word} className="vchip" title={`${v.ipa} — ${v.meaning_vi}`}>
              <b>{v.word}</b> {v.meaning_vi}
            </span>
          ))}
        </div>
        {(canDelete || me.user.role === "admin") && (
          <div className="row gap">
            {me.user.role === "admin" && (
              <button className="btn small ghost" onClick={togglePublic}>
                {l.is_public ? "Ẩn khỏi thư viện" : "Hiện trong thư viện"}
              </button>
            )}
            {canDelete && (
              <button className="btn small danger" onClick={remove}>
                Xoá bài
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---- Library ---------------------------------------------------------------------

const TOPIC_IDEAS = ["Ordering coffee", "Job interview", "Travelling in Da Nang", "AI at work", "Weekend plans", "Healthy habits"];

function Library({ me, onQuota }: { me: Me; onQuota: () => void }) {
  const [lessons, setLessons] = useState<LessonRow[] | null>(null);
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ lessons: LessonRow[] }>(`/api/lessons?scope=library&level=${level}&q=${encodeURIComponent(q)}`).then((r) =>
        setLessons(r.lessons),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [level, q]);

  return (
    <div className="stack-lg">
      <h1 className="page-title">Thư viện bài học</h1>
      <p className="muted lead">
        Bài do mọi người tạo đều nằm ở đây. Học lại bài có sẵn thì <b>không tốn lượt AI</b>.
      </p>
      <CreateLesson me={me} onQuota={onQuota} />
      <div className="filters">
        <input className="search" placeholder="🔍 Tìm theo chủ đề…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {["", "A1", "A2", "B1", "B2", "C1"].map((lv) => (
            <button key={lv || "all"} className={level === lv ? "chip on" : "chip"} onClick={() => setLevel(lv)}>
              {lv || "Tất cả"}
            </button>
          ))}
        </div>
      </div>
      {!lessons ? (
        <p className="muted">Đang tải…</p>
      ) : lessons.length === 0 ? (
        <p className="muted">Chưa có bài nào khớp. Hãy tạo bài mới ở trên!</p>
      ) : (
        <div className="lib-grid">
          {lessons.map((l) => (
            <LessonCard key={l.id} l={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({ l }: { l: LessonRow }) {
  const pct = Math.round((l.my_steps / STEPS.length) * 100);
  return (
    <a className={`lib-card c-${unitColor(l.id)}`} href={`#/lesson/${l.id}`}>
      <div className="lib-top">
        <span className="lvl">{l.level}</span>
        {!l.is_public && <span className="tag">Đang ẩn</span>}
      </div>
      <h3>{l.title}</h3>
      <p className="small muted">{l.topic}</p>
      <div className="lib-foot small">
        <span>👥 {l.learners}</span>
        <span>💬 {l.sentences} câu</span>
        <span>✍️ {l.author}</span>
      </div>
      {l.my_steps > 0 && (
        <div className="bar thin">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </a>
  );
}

function CreateLesson({ me, onQuota }: { me: Me; onQuota: () => void }) {
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("B1");
  const [length, setLength] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [similar, setSimilar] = useState<LessonRow[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (topic.trim().length < 3) return setSimilar([]);
    timer.current = setTimeout(() => {
      api<{ lessons: LessonRow[] }>(`/api/lessons/similar?level=${level}&topic=${encodeURIComponent(topic)}`)
        .then((r) => setSimilar(r.lessons))
        .catch(() => {});
    }, 400);
  }, [topic, level]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: number; note?: string }>("/api/lessons", { body: { topic, level, length } });
      onQuota();
      location.hash = `#/lesson/${r.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="card create">
      <div className="create-head">
        <span className="create-icon">✨</span>
        <div>
          <h2>Nhờ AI soạn bài mới</h2>
          <p className="muted small">
            Nhập chủ đề bạn thích, AI viết đoạn văn kèm từ vựng và câu hỏi.
            {me.quota.limited && ` Tốn 1 lượt (còn ${me.quota.left}).`}
          </p>
        </div>
      </div>
      <form onSubmit={create} className="create-form">
        <input
          className="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Ví dụ: Ordering coffee in a café"
          maxLength={200}
          required
        />
        <div className="chips">
          {["A1", "A2", "B1", "B2", "C1"].map((lv) => (
            <button type="button" key={lv} className={level === lv ? "chip on" : "chip"} onClick={() => setLevel(lv)}>
              {lv}
            </button>
          ))}
          <select value={length} onChange={(e) => setLength(e.target.value)} className="chip-select">
            <option value="short">Ngắn · 6 câu</option>
            <option value="medium">Vừa · 10 câu</option>
            <option value="long">Dài · 16 câu</option>
          </select>
        </div>
        <div className="chips ideas">
          {TOPIC_IDEAS.map((t) => (
            <button key={t} type="button" className="chip ghost" onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>
        {similar.length > 0 && (
          <div className="similar">
            <b>Đã có bài giống vậy — học luôn, không tốn lượt AI:</b>
            {similar.map((s) => (
              <a key={s.id} href={`#/lesson/${s.id}`} className="similar-item">
                <span className="lvl">{s.level}</span> {s.title} <span className="muted small">· 👥 {s.learners}</span>
              </a>
            ))}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary full" disabled={busy || !topic.trim()}>
          {busy ? "AI đang soạn bài… (10–40 giây)" : "Tạo bài"}
        </button>
      </form>
    </section>
  );
}

// ---- Leaderboard ------------------------------------------------------------------

function Leaderboard({ me }: { me: Me }) {
  const [d, setD] = useState<{ rows: { id: number; login: string; streak: number; week_xp: number }[]; myRank: number | null } | null>(null);
  useEffect(() => {
    api<typeof d>("/api/leaderboard").then(setD);
  }, []);
  if (!d) return <p className="muted center">Đang tải…</p>;
  return (
    <div className="stack-lg narrow">
      <div className="rank-hero">
        <span className="trophy">🏆</span>
        <h1 className="page-title">Bảng xếp hạng tuần</h1>
        <p className="muted">XP kiếm được từ thứ Hai. {d.myRank ? `Bạn đang hạng ${d.myRank}.` : "Học một bài để lên bảng!"}</p>
      </div>
      <ol className="rank-list">
        {d.rows.map((r, i) => (
          <li key={r.id} className={r.id === me.user.id ? "me" : ""}>
            <span className={`rank r${i + 1}`}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
            <span className="avatar">{r.login.slice(0, 1).toUpperCase()}</span>
            <b className="grow">{r.login}</b>
            <span className="muted small">🔥 {r.streak}</span>
            <b>{r.week_xp} XP</b>
          </li>
        ))}
      </ol>
      {d.rows.length === 0 && <p className="muted center">Chưa ai có XP tuần này.</p>}
    </div>
  );
}

// ---- Profile -----------------------------------------------------------------------

interface Stats {
  totals: { attempts: number; avg_score: number | null; lessons: number; steps: number };
  xpDaily: { day: string; xp: number }[];
  recent: { target: string; transcript: string; score: number }[];
}

function Profile({ me, onChange }: { me: Me; onChange: () => void }) {
  const [s, setS] = useState<Stats | null>(null);
  const [sound, setSound] = useState(soundOn);
  useEffect(() => {
    api<Stats>("/api/stats").then(setS);
  }, []);

  const setGoal = async (g: number) => {
    await api("/api/me", { method: "PATCH", body: { dailyGoal: g } });
    onChange();
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/";
  };

  const days = lastDays(14);
  const byDay = Object.fromEntries((s?.xpDaily ?? []).map((d) => [d.day, d.xp]));
  const max = Math.max(10, ...days.map((d) => byDay[d] ?? 0));

  return (
    <div className="stack-lg narrow">
      <div className="profile-head">
        <span className="avatar big">{me.user.login.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1 className="page-title">{me.user.login}</h1>
          <span className="muted">{roleLabel(me.user.role)}</span>
        </div>
      </div>

      <div className="stat-grid">
        <Stat icon="🔥" value={me.game.streak} label="ngày liên tiếp" />
        <Stat icon="⚡" value={me.game.xp} label="tổng XP" />
        <Stat icon="📘" value={s?.totals.lessons ?? "–"} label="bài đã học" />
        <Stat icon="🎙️" value={s?.totals.avg_score ?? "–"} label="điểm nói TB" />
      </div>

      <section className="card">
        <h2>XP 14 ngày qua</h2>
        <div className="bars">
          {days.map((d) => (
            <div key={d} className="bar-col" title={`${d}: ${byDay[d] ?? 0} XP`}>
              <div className="bar-v" style={{ height: `${((byDay[d] ?? 0) / max) * 100}%` }} />
              <span>{d.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Mục tiêu mỗi ngày</h2>
        <div className="chips">
          {[10, 20, 30, 50, 80].map((g) => (
            <button key={g} className={me.game.dailyGoal === g ? "chip on" : "chip"} onClick={() => setGoal(g)}>
              {g} XP
            </button>
          ))}
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              setSoundOn(e.target.checked);
            }}
          />{" "}
          Âm thanh hiệu ứng
        </label>
      </section>

      {s && s.recent.length > 0 && (
        <section className="card">
          <h2>Lần nói gần đây</h2>
          <ul className="recent">
            {s.recent.map((r, i) => (
              <li key={i}>
                <ScoreBadge score={r.score} />
                <div>
                  <div>{r.target}</div>
                  <div className="muted small">Máy nghe được: “{r.transcript || "…"}”</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button className="btn ghost full" onClick={logout}>
        Đăng xuất
      </button>
      <p className="credit">{MASCOT_CREDIT}</p>
    </div>
  );
}

function roleLabel(r: string) {
  return { admin: "Quản trị viên · Claude", member: "Thành viên", trial: "Dùng thử", blocked: "Đã khoá" }[r] ?? r;
}

function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date(Date.now() + 7 * 3600_000);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10));
  return out;
}

function Stat({ icon, value, label }: { icon: string; value: React.ReactNode; label: string }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <b>{value}</b>
      <span className="muted small">{label}</span>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 85 ? "good" : score >= 60 ? "mid" : "low";
  return <span className={`score ${tone}`}>{score}</span>;
}

// ---- Admin -------------------------------------------------------------------------

interface AdminUser {
  id: number;
  login: string;
  role: string;
  ai_used: number;
  xp: number;
  streak: number;
  attempts: number;
  last_seen_at: string | null;
}

function Admin() {
  const [data, setData] = useState<{ users: AdminUser[]; trialLimit: number; bridgeOnline: boolean } | null>(null);
  const load = useCallback(() => {
    api<{ users: AdminUser[]; trialLimit: number; bridgeOnline: boolean }>("/api/admin/users").then(setData);
  }, []);
  useEffect(load, [load]);
  const update = async (id: number, body: object) => {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body });
    load();
  };
  if (!data) return <p className="muted center">Đang tải…</p>;
  return (
    <div className="stack-lg">
      <h1 className="page-title">Quản trị</h1>
      <section className={`card bridge ${data.bridgeOnline ? "ok" : "off"}`}>
        <b>Claude bridge: {data.bridgeOnline ? "online" : "offline"}</b>
        <p className="muted small">
          Chạy <code>npm run bridge</code> trên máy bạn để tài khoản byocao dùng Claude. Người khác luôn dùng Workers AI.
        </p>
      </section>
      <section className="card">
        <h2>Người dùng</h2>
        <p className="muted small">Tài khoản dùng thử có {data.trialLimit} lượt AI. Bài học: mở bài để ẩn hoặc xoá.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Quyền</th>
                <th>Lượt AI</th>
                <th>XP</th>
                <th>Lần nói</th>
                <th>Lần cuối</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.login}</b>
                  </td>
                  <td>
                    <span className={`role ${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.ai_used}</td>
                  <td>{u.xp}</td>
                  <td>{u.attempts}</td>
                  <td className="small muted">{u.last_seen_at ? new Date(u.last_seen_at + "Z").toLocaleString("vi-VN") : "–"}</td>
                  <td className="actions">
                    {u.role !== "admin" && (
                      <>
                        {u.role !== "member" && (
                          <button className="btn small" onClick={() => update(u.id, { role: "member" })}>
                            Mở khoá
                          </button>
                        )}
                        {u.role !== "trial" && (
                          <button className="btn small ghost" onClick={() => update(u.id, { role: "trial" })}>
                            Về dùng thử
                          </button>
                        )}
                        {u.role === "trial" && u.ai_used > 0 && (
                          <button className="btn small ghost" onClick={() => update(u.id, { resetUsage: true })}>
                            Cấp lại lượt
                          </button>
                        )}
                        {u.role !== "blocked" && (
                          <button className="btn small danger" onClick={() => update(u.id, { role: "blocked" })}>
                            Khoá
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
