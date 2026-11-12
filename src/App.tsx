import { useCallback, useEffect, useState } from "react";
import { api, onApiError, type ApiError, type LessonRow, type Me } from "./api";
import { LessonPage } from "./Lesson";
import { Login } from "./Login";

type Route = { name: "home" } | { name: "lesson"; id: number } | { name: "progress" } | { name: "admin" };

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const m = h.match(/^lesson\/(\d+)/);
  if (m) return { name: "lesson", id: Number(m[1]) };
  if (h === "progress") return { name: "progress" };
  if (h === "admin") return { name: "admin" };
  return { name: "home" };
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
    const fn = () => setRoute(parseRoute());
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

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark">EC</span>
          <span>English Coach</span>
        </a>
        <nav className="nav">
          <a href="#/" className={route.name === "home" || route.name === "lesson" ? "on" : ""}>
            Bài học
          </a>
          <a href="#/progress" className={route.name === "progress" ? "on" : ""}>
            Tiến độ
          </a>
          {me.user.role === "admin" && (
            <a href="#/admin" className={route.name === "admin" ? "on" : ""}>
              Quản trị
            </a>
          )}
        </nav>
        <div className="who">
          <QuotaBadge me={me} />
          <span className="avatar" aria-hidden="true">{me.user.login.slice(0, 1).toUpperCase()}</span>
          <span className="login">{me.user.login}</span>
          <button className="link" onClick={logout}>
            Thoát
          </button>
        </div>
      </header>

      <main className="main">
        {route.name === "home" && <Home me={me} onQuota={refreshMe} />}
        {route.name === "lesson" && <LessonPage id={route.id} me={me} onQuota={refreshMe} />}
        {route.name === "progress" && <Progress />}
        {route.name === "admin" && me.user.role === "admin" && <Admin />}
      </main>

      {locked && <LockedDialog err={locked} onClose={() => setLocked(null)} />}
    </div>
  );
}

function QuotaBadge({ me }: { me: Me }) {
  if (me.user.role === "admin") {
    return (
      <span className={`pill ${me.bridgeOnline ? "pill-ok" : "pill-warn"}`} title="Trạng thái bridge Claude CLI trên máy bạn">
        Claude {me.bridgeOnline ? "online" : "offline"}
      </span>
    );
  }
  if (me.quota.limited) {
    return (
      <span className={`pill ${me.quota.left ? "" : "pill-warn"}`} title="Số lượt AI còn lại trong bản dùng thử">
        Dùng thử: còn {me.quota.left}/{me.quota.limit}
      </span>
    );
  }
  if (me.user.role === "member") return <span className="pill pill-ok">Thành viên</span>;
  return null;
}

function LockedDialog({ err, onClose }: { err: ApiError; onClose: () => void }) {
  const contact = err.contact || "https://github.com/byocao";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{err.code === "blocked" ? "Tài khoản đã bị khoá" : "Hết lượt dùng thử"}</h2>
        <p>
          {err.code === "blocked"
            ? "Tài khoản của bạn không còn được dùng các tính năng AI."
            : "Bạn đã dùng hết số lượt AI miễn phí. Bạn vẫn xem lại được các bài đã có, nghe và chép chính tả."}
        </p>
        <p>
          Muốn dùng tiếp, hãy liên hệ{" "}
          <a href={contact} target="_blank" rel="noreferrer">
            {contact.replace(/^https?:\/\//, "")}
          </a>{" "}
          để được mở khoá.
        </p>
        <div className="row-end">
          <button className="btn" onClick={onClose}>
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Home: lesson list + create ------------------------------------------------

const TOPIC_IDEAS = [
  "Ordering coffee in a café",
  "A job interview for a developer",
  "Travelling in Da Nang",
  "How AI is changing work",
  "Talking about your weekend",
  "Healthy morning routines",
];

function Home({ me, onQuota }: { me: Me; onQuota: () => void }) {
  const [lessons, setLessons] = useState<LessonRow[] | null>(null);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("B1");
  const [length, setLength] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    api<{ lessons: LessonRow[] }>("/api/lessons").then((r) => setLessons(r.lessons));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await api<{ id: number; note?: string }>("/api/lessons", { body: { topic, level, length } });
      onQuota();
      if (r.note) sessionStorage.setItem("ec_note", r.note);
      location.hash = `#/lesson/${r.id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mine = lessons?.filter((l) => l.user_id === me.user.id) ?? [];
  const shared = lessons?.filter((l) => l.user_id !== me.user.id) ?? [];

  return (
    <div className="stack-lg">
      <section className="card create">
        <h2>Tạo bài học mới</h2>
        <p className="muted">
          AI viết một đoạn văn theo chủ đề và trình độ bạn chọn, kèm từ vựng và câu hỏi. Mỗi bài dùng được cho cả đọc, nghe,
          chép chính tả và luyện nói.
        </p>
        <form onSubmit={create} className="create-form">
          <label className="field grow">
            <span>Chủ đề</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ví dụ: Ordering coffee in a café"
              maxLength={200}
              required
            />
          </label>
          <label className="field">
            <span>Trình độ</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {["A1", "A2", "B1", "B2", "C1"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Độ dài</span>
            <select value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="short">Ngắn (~6 câu)</option>
              <option value="medium">Vừa (~10 câu)</option>
              <option value="long">Dài (~16 câu)</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || !topic.trim()}>
            {busy ? "Đang soạn bài…" : "Tạo bài"}
          </button>
        </form>
        <div className="chips">
          {TOPIC_IDEAS.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>
        {busy && <p className="muted small">Thường mất 10–40 giây.</p>}
        {error && <p className="error">{error}</p>}
        {note && <p className="note">{note}</p>}
      </section>

      <LessonList title="Bài của bạn" lessons={mine} loading={!lessons} empty="Chưa có bài nào. Hãy tạo bài đầu tiên ở trên." />
      {shared.length > 0 && <LessonList title="Bài được chia sẻ" lessons={shared} loading={false} empty="" />}
    </div>
  );
}

function LessonList({ title, lessons, loading, empty }: { title: string; lessons: LessonRow[]; loading: boolean; empty: string }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : lessons.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="lesson-grid">
          {lessons.map((l) => (
            <a key={l.id} className="lesson-card" href={`#/lesson/${l.id}`}>
              <div className="lesson-card-top">
                <span className="level">{l.level}</span>
                {l.is_public ? <span className="pill small">Chia sẻ</span> : null}
              </div>
              <h3>{l.title}</h3>
              <p className="muted small">{l.topic}</p>
              <div className="lesson-card-foot small muted">
                <span>{l.attempts ? `${l.attempts} lần nói · TB ${l.avg_score ?? "–"}` : "Chưa luyện nói"}</span>
                <span>{new Date(l.created_at + "Z").toLocaleDateString("vi-VN")}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Progress ------------------------------------------------------------------

interface Stats {
  totals: { attempts: number; avg_score: number | null; lessons: number };
  daily: { day: string; attempts: number; avg_score: number }[];
  recent: { target: string; transcript: string; score: number; created_at: string }[];
}

function Progress() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    api<Stats>("/api/stats").then(setS);
  }, []);
  if (!s) return <p className="muted">Đang tải…</p>;
  const max = Math.max(1, ...s.daily.map((d) => d.attempts));
  return (
    <div className="stack-lg">
      <div className="stat-row">
        <div className="stat">
          <span className="stat-num">{s.totals.lessons}</span>
          <span className="muted small">bài học đã tạo</span>
        </div>
        <div className="stat">
          <span className="stat-num">{s.totals.attempts}</span>
          <span className="muted small">lần luyện nói</span>
        </div>
        <div className="stat">
          <span className="stat-num">{s.totals.avg_score ?? "–"}</span>
          <span className="muted small">điểm nói trung bình</span>
        </div>
      </div>

      <section className="card">
        <h2>30 ngày gần đây</h2>
        {s.daily.length === 0 ? (
          <p className="muted">Chưa có dữ liệu. Hãy vào một bài và luyện nói.</p>
        ) : (
          <div className="bars" role="img" aria-label="Số lần luyện nói mỗi ngày">
            {s.daily.map((d) => (
              <div key={d.day} className="bar-col" title={`${d.day}: ${d.attempts} lần, TB ${d.avg_score}`}>
                <div className="bar" style={{ height: `${(d.attempts / max) * 100}%` }} />
                <span className="bar-label">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Lần nói gần nhất</h2>
        {s.recent.length === 0 ? (
          <p className="muted">Chưa có.</p>
        ) : (
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
        )}
      </section>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 85 ? "good" : score >= 60 ? "mid" : "low";
  return <span className={`score score-${tone}`}>{score}</span>;
}

// ---- Admin ---------------------------------------------------------------------

interface AdminUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  role: string;
  ai_used: number;
  attempts: number;
  created_at: string;
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

  if (!data) return <p className="muted">Đang tải…</p>;
  return (
    <div className="stack-lg">
      <section className="card">
        <h2>Bridge Claude CLI</h2>
        <p>
          Trạng thái:{" "}
          <span className={`pill ${data.bridgeOnline ? "pill-ok" : "pill-warn"}`}>{data.bridgeOnline ? "online" : "offline"}</span>
        </p>
        <p className="muted small">
          Chạy <code>npm run bridge</code> trên máy của bạn để các yêu cầu của tài khoản quản trị dùng Claude (gói Claude của
          bạn). Khi bridge offline, app tự chuyển sang Workers AI. Người dùng khác luôn dùng Workers AI.
        </p>
      </section>

      <section className="card">
        <h2>Người dùng</h2>
        <p className="muted small">Mỗi tài khoản dùng thử có {data.trialLimit} lượt AI. Mở khoá để thành viên dùng không giới hạn.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Quyền</th>
                <th>Lượt AI</th>
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
                    <span className={`role role-${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.ai_used}</td>
                  <td>{u.attempts}</td>
                  <td className="small muted">{u.last_seen_at ? new Date(u.last_seen_at + "Z").toLocaleString("vi-VN") : "–"}</td>
                  <td className="actions">
                    {u.role !== "admin" && (
                      <>
                        {u.role !== "member" && (
                          <button className="btn btn-sm" onClick={() => update(u.id, { role: "member" })}>
                            Mở khoá
                          </button>
                        )}
                        {u.role !== "trial" && (
                          <button className="btn btn-sm" onClick={() => update(u.id, { role: "trial" })}>
                            Về dùng thử
                          </button>
                        )}
                        {u.role === "trial" && u.ai_used > 0 && (
                          <button className="btn btn-sm" onClick={() => update(u.id, { resetUsage: true })}>
                            Cấp lại lượt
                          </button>
                        )}
                        {u.role !== "blocked" && (
                          <button className="btn btn-sm btn-danger" onClick={() => update(u.id, { role: "blocked" })}>
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
