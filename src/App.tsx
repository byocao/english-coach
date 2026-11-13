import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChatText,
  Desktop,
  Eye,
  EyeSlash,
  House,
  MagnifyingGlass,
  Moon,
  Play,
  SignOut,
  Sparkle,
  SpeakerHigh,
  Sun,
  Trash,
  Trophy,
  UserCircle,
  Users,
  Wrench,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, onApiError, type ApiError, type LessonDetail, type LessonRow, type Me } from "./api";
import { englishVoices, isNaturalVoice, onVoicesChanged, preferredVoice, setPreferredVoice, speak } from "./audio";
import { Exercise } from "./Exercise";
import { Landing } from "./Landing";
import { Login } from "./Login";
import { COMPANIONS, CompanionContext, MASCOT_CREDIT, Mascot, availableCompanions, isCompanion, useCompanion, type MascotName } from "./Mascot";
import { Placement } from "./Placement";
import { CATEGORIES, Fx, LEVELS, LEVEL_LABEL, STEPS, category, parseProgress, quests } from "./meta";
import { setSoundOn, soundOn } from "./sound";
import { getTheme, setTheme, type Theme } from "./theme";

type Route =
  | { name: "learn" }
  | { name: "library" }
  | { name: "lesson"; id: number }
  | { name: "exercise"; id: number; step: string }
  | { name: "rank" }
  | { name: "me" }
  | { name: "placement" }
  | { name: "admin" }
  | { name: "login" }
  | { name: "register" };

function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  let m = h.match(/^lesson\/(\d+)\/(\w+)/);
  if (m) return { name: "exercise", id: Number(m[1]), step: m[2] };
  m = h.match(/^lesson\/(\d+)/);
  if (m) return { name: "lesson", id: Number(m[1]) };
  if (h === "library") return { name: "library" };
  if (h === "rank") return { name: "rank" };
  if (h === "me") return { name: "me" };
  if (h === "admin") return { name: "admin" };
  if (h === "placement") return { name: "placement" };
  if (h === "login") return { name: "login" };
  if (h === "register") return { name: "register" };
  return { name: "learn" };
}

function useNarrow(q = "(max-width: 1180px)"): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const fn = () => setNarrow(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [q]);
  return narrow;
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
        if (["blocked", "lesson_limit", "grade_limit", "maintenance"].includes(err.code ?? "")) setLocked(err);
        if (err.code === "maintenance") refreshMe();
        if (err.code === "unauthenticated") setMe(null);
      }),
    [],
  );

  if (me === undefined)
    return (
      <div className="boot">
        <Fx name="books" size={72} className="bob" />
        <span>Đang mở sách…</span>
      </div>
    );
  // Signed out: a public landing page, with sign-in and sign-up on their own page.
  if (me === null) {
    if (route.name === "login" || route.name === "register") return <Login mode={route.name} />;
    return <Landing />;
  }
  if (route.name === "login" || route.name === "register") {
    location.replace("#/");
    return null;
  }

  const companion: MascotName = isCompanion(me.user.mascot) ? me.user.mascot : "wanko";

  if (route.name === "placement") {
    return (
      <CompanionContext.Provider value={companion}>
        <Placement me={me} onDone={refreshMe} />
      </CompanionContext.Provider>
    );
  }

  if (route.name === "exercise") {
    return (
      <CompanionContext.Provider value={companion}>
        <Exercise key={`${route.id}/${route.step}`} lessonId={route.id} step={route.step} me={me} onGame={refreshMe} />
        {locked && <LockedDialog err={locked} onClose={() => setLocked(null)} />}
      </CompanionContext.Provider>
    );
  }

  const nav = [
    { href: "#/", Icon: House, label: "Học", on: route.name === "learn" || route.name === "lesson" },
    { href: "#/library", Icon: BookOpenText, label: "Thư viện", on: route.name === "library" },
    { href: "#/rank", Icon: Trophy, label: "Xếp hạng", on: route.name === "rank" },
    { href: "#/me", Icon: UserCircle, label: "Hồ sơ", on: route.name === "me" },
    ...(me.user.role === "admin" ? [{ href: "#/admin", Icon: Wrench, label: "Quản trị", on: route.name === "admin" }] : []),
  ];

  return (
    <CompanionContext.Provider value={companion}>
    <div className="app">
      <aside className="sidenav">
        <a className="logo" href="#/">
          <Logo />
          <span>
            Wan<b>cha</b>
          </span>
        </a>
        <nav>
          {nav.map(({ href, Icon, label, on }) => (
            <a key={href} href={href} className={on ? "navlink on" : "navlink"} aria-current={on ? "page" : undefined}>
              <Icon size={26} weight={on ? "fill" : "duotone"} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <div className="page">
        <header className="topbar">
          <a className="logo" href="#/" aria-label="Trang chủ">
            <Logo />
          </a>
          <StatPills me={me} />
        </header>
        <main className="content">
          {route.name === "learn" && <Learn me={me} />}
          {route.name === "library" && <Library me={me} onQuota={refreshMe} />}
          {route.name === "lesson" && <LessonPage id={route.id} me={me} />}
          {route.name === "rank" && <Leaderboard me={me} />}
          {route.name === "me" && <Profile me={me} onChange={refreshMe} />}
          {route.name === "admin" && me.user.role === "admin" && <Admin />}
        </main>
      </div>

      <aside className="rightcol">
        <StatPills me={me} />
        <QuestCard me={me} />
        {me.spend && <SpendCard usd={me.spend.usd} budget={me.spend.budget} />}
        {me.maintenance && me.user.role !== "admin" && <MaintenanceCard />}
        {me.quota.limited && !me.maintenance && <QuotaCard me={me} />}
        {route.name !== "learn" && route.name !== "me" && (
          <div className="card mascot-card">
            <Mascot name={companion} className="side-mascot" say={greeting(me)} />
          </div>
        )}
        <p className="credit">{MASCOT_CREDIT}</p>
      </aside>

      <nav className="tabbar">
        {nav.map(({ href, Icon, label, on }) => (
          <a key={href} href={href} className={on ? "on" : ""} aria-label={label}>
            <Icon size={26} weight={on ? "fill" : "duotone"} />
            <small>{label}</small>
          </a>
        ))}
      </nav>

      {locked && <LockedDialog err={locked} onClose={() => setLocked(null)} />}
    </div>
    </CompanionContext.Provider>
  );
}

function Logo() {
  return <img className="logo-mark" src="/icons/wancha-192.png" alt="" width={44} height={44} />;
}

function greeting(me: Me): string {
  const g = me.game;
  if (!g.practicedToday && g.streak > 0) return `Giữ chuỗi ${g.streak} ngày nhé, ${me.user.login}!`;
  if (g.todayXp >= g.dailyGoal) return "Hôm nay bạn đạt mục tiêu rồi. Giỏi lắm!";
  if (g.todayXp > 0) return `Còn ${g.dailyGoal - g.todayXp} XP nữa là đạt mục tiêu!`;
  return `Chào ${me.user.login}! Học một chút hôm nay nhé?`;
}

function StatPills({ me }: { me: Me }) {
  const g = me.game;
  return (
    <div className="pills">
      <span className={`pill streak ${g.practicedToday ? "lit" : ""}`} title="Chuỗi ngày học liên tiếp">
        <Fx name="fire" size={24} /> {g.streak}
      </span>
      <span className="pill xp" title="Tổng XP">
        <Fx name="high_voltage" size={24} /> {g.xp}
      </span>
      <span className="pill goal" title="XP hôm nay / mục tiêu">
        <Fx name="bullseye" size={24} /> {g.todayXp}/{g.dailyGoal}
      </span>
    </div>
  );
}

function Meter({ value, max, tone = "" }: { value: number; max: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`meter ${tone}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function QuestCard({ me }: { me: Me }) {
  const qs = quests(me.game);
  const done = qs.filter((q) => q.value >= q.target).length;
  return (
    <section className="card quests">
      <header>
        <h3>Nhiệm vụ hôm nay</h3>
        <span className="muted small">
          {done}/{qs.length}
        </span>
      </header>
      {qs.map((q) => (
        <div key={q.id} className={q.value >= q.target ? "quest done" : "quest"}>
          <Fx name={q.value >= q.target ? "check_mark_button" : q.fx} size={38} tile />
          <div className="grow">
            <b>{q.label}</b>
            <div className="quest-bar">
              <Meter value={q.value} max={q.target} tone="gold" />
              <span>
                {q.value}/{q.target}
              </span>
            </div>
          </div>
        </div>
      ))}
      {done === qs.length && (
        <p className="quest-win">
          <Fx name="wrapped_gift" size={28} /> Xong hết nhiệm vụ! Mai quay lại nhé.
        </p>
      )}
    </section>
  );
}

const usd = (n: number) => "$" + n.toFixed(n < 10 ? 2 : 1);

/** Admin: Claude API spend this month against the budget. */
function SpendCard({ usd: spent, budget }: { usd: number; budget: number }) {
  const over = spent >= budget;
  return (
    <section className={`card bridge ${over ? "off" : "ok"}`}>
      <Fx name="robot" size={38} tile />
      <div>
        <b>Claude API tháng này</b>
        <span className="small">
          {usd(spent)} / {usd(budget)}
          {over && " · đã tạm dừng tạo bài và chấm điểm"}
        </span>
      </div>
    </section>
  );
}

function MaintenanceCard() {
  return (
    <section className="card bridge off">
      <Fx name="robot" size={38} tile />
      <div>
        <b>Đang bảo trì</b>
        <span className="small">Tạo bài và chấm điểm phát âm tạm dừng. Các bài có sẵn vẫn học bình thường.</span>
      </div>
    </section>
  );
}

function QuotaCard({ me }: { me: Me }) {
  const { lessons, grades } = me.quota;
  return (
    <section className="card quota">
      <header>
        <h3>Lượt AI của bạn</h3>
      </header>
      <span className="small">
        Tạo bài riêng: còn <b>{lessons.left}</b>/{lessons.limit}
      </span>
      <Meter value={lessons.left} max={lessons.limit} tone="violet" />
      <span className="small">
        Chấm điểm phát âm: còn <b>{grades.left}</b>/{grades.limit}
      </span>
      <Meter value={grades.left} max={grades.limit} tone="violet" />
    </section>
  );
}

function LockedDialog({ err, onClose }: { err: ApiError; onClose: () => void }) {
  const contact = err.contact || "https://github.com/byocao";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <Fx name="locked" size={72} tile className="dialog-fx" />
        <h2>
          {err.code === "blocked"
            ? "Tài khoản đã bị khoá"
            : err.code === "maintenance"
              ? "Đang bảo trì"
              : err.code === "lesson_limit"
                ? "Hết lượt tạo bài"
                : "Hết lượt chấm điểm"}
        </h2>
        <p>
          {err.code === "blocked"
            ? "Tài khoản của bạn không còn dùng được các tính năng AI."
            : err.code === "maintenance"
              ? "Chức năng tạo bài và chấm điểm phát âm đang bảo trì. Bạn vẫn học được toàn bộ khoá học có sẵn."
              : err.code === "lesson_limit"
                ? "Bạn đã dùng hết lượt tạo bài học riêng bằng AI. Bạn vẫn học được toàn bộ khoá học và các bài trong thư viện."
                : "Bạn đã dùng hết lượt chấm điểm phát âm. Bạn vẫn luyện từ vựng, nghe, chép chính tả, đọc và thử thách."}
        </p>
        {err.code !== "maintenance" && (
          <p>
            Muốn dùng tiếp, hãy liên hệ{" "}
            <a href={contact} target="_blank" rel="noreferrer">
              {contact.replace(/^https?:\/\//, "")}
            </a>
            .
          </p>
        )}
        <button className="btn primary full" onClick={onClose}>
          Đã hiểu
        </button>
      </div>
    </div>
  );
}

// ---- Learn: the course path ------------------------------------------------------------

function stepsDone(l: LessonRow): number {
  return Object.keys(parseProgress(l.my_progress)).length;
}

function nextStepOf(progress: Record<string, number>) {
  return STEPS.find((s) => !(s.key in progress)) ?? STEPS[0];
}

function Learn({ me }: { me: Me }) {
  const [course, setCourse] = useState<LessonRow[] | null>(null);
  const [mine, setMine] = useState<LessonRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const narrow = useNarrow();

  useEffect(() => {
    api<{ lessons: LessonRow[] }>("/api/course").then((r) => setCourse(r.lessons));
    api<{ lessons: LessonRow[] }>("/api/lessons?scope=mine").then((r) => setMine(r.lessons.filter((l) => l.course_order === null)));
  }, []);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".node-wrap")) setOpen(null);
    };
    addEventListener("click", close);
    return () => removeEventListener("click", close);
  }, [open]);

  const myLevel = Math.max(0, LEVELS.findIndex((l) => l.key === me.user.level));
  const levelOf = (l: LessonRow) => LEVELS.findIndex((x) => x.key === l.level);
  // The current lesson: the first unfinished one at or above the learner's level.
  const current = useMemo(
    () =>
      course?.find((l) => levelOf(l) >= myLevel && stepsDone(l) < STEPS.length) ??
      course?.find((l) => stepsDone(l) < STEPS.length) ??
      course?.[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [course, myLevel],
  );
  const scrolled = useRef(false);
  useEffect(() => {
    if (!current || scrolled.current) return;
    scrolled.current = true;
    if (course && course.indexOf(current) > 1) {
      setTimeout(() => document.getElementById(`node-${current.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
    }
  }, [current, course]);

  if (!course) return <Loading />;

  return (
    <div className="learn">
      {/* Cubism renders one live model per page, so onboarding replaces the hero until placed. */}
      {!me.user.level ? <Onboard /> : <Hero me={me} lesson={current} index={current ? course.indexOf(current) + 1 : 0} total={course.length} />}
      {narrow && <QuestCard me={me} />}

      {LEVELS.map((lv, li) => {
        const lessons = course.filter((l) => l.level === lv.key);
        if (lessons.length === 0) return null;
        const doneCount = lessons.filter((l) => stepsDone(l) === STEPS.length).length;
        return (
          <section key={lv.key} className={`unit lvl-${lv.key}`}>
            <header className="unit-head">
              <Fx name={lv.fx} size={52} />
              <div className="grow">
                <small>
                  Cấp {lv.key} · {lessons.length} bài
                </small>
                <h2>
                  {lv.label}
                  {me.user.level && li === myLevel && <span className="here-chip">Bạn ở đây</span>}
                </h2>
                <p>{li < myLevel ? "Bạn đã xếp lớp trên cấp này. Vẫn có thể ôn lại bất cứ bài nào." : lv.blurb}</p>
              </div>
              <div className="unit-count">
                <b>{doneCount}</b>/{lessons.length}
              </div>
            </header>
            <div className="trail">
              {lessons.map((l, i) => (
                <PathNode
                  key={l.id}
                  lesson={l}
                  offset={WAVE[i % WAVE.length]}
                  isCurrent={l.id === current?.id}
                  open={open === l.id}
                  onToggle={() => setOpen(open === l.id ? null : l.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {mine.length > 0 && (
        <section className="unit lvl-own">
          <header className="unit-head">
            <Fx name="sparkles" size={52} />
            <div className="grow">
              <small>Từ thư viện cộng đồng</small>
              <h2>Bài bạn đang học</h2>
              <p>Bài bạn tự tạo hoặc mở từ thư viện.</p>
            </div>
          </header>
          <div className="lib-grid">
            {mine.map((l) => (
              <LessonCard key={l.id} l={l} />
            ))}
          </div>
        </section>
      )}

      <a className="more-card" href="#/library">
        <Fx name="robot" size={52} tile />
        <div className="grow">
          <b>Muốn chủ đề khác?</b>
          <span>Mở Thư viện để học bài của mọi người, hoặc nhờ AI soạn bài theo ý bạn.</span>
        </div>
        <ArrowRight size={24} weight="bold" />
      </a>
    </div>
  );
}

const WAVE = [0, 70, 105, 70, 0, -70, -105, -70];

function Onboard() {
  const companion = useCompanion();
  const [busy, setBusy] = useState(false);
  const beginner = async () => {
    setBusy(true);
    await api("/api/me", { method: "PATCH", body: { level: "A1" } });
    location.reload();
  };
  return (
    <section className="onboard">
      <Mascot name={companion} mood="happy" className="onboard-mascot" />
      <div className="onboard-text">
        <span className="hero-kicker dark">
          <Fx name="bullseye" size={16} /> Xếp lớp
        </span>
        <h2>Bạn đang ở trình độ nào?</h2>
        <p>Làm bài kiểm tra ngắn (tối đa 12 câu, khoảng 3 phút) để bắt đầu đúng cấp A1–C1, khỏi học lại bài quá dễ.</p>
        <div className="row gap wrap">
          <a className="btn primary" href="#/placement">
            LÀM BÀI XẾP LỚP <ArrowRight size={18} weight="bold" />
          </a>
          <button className="btn ghost" onClick={beginner} disabled={busy}>
            Mình mới bắt đầu
          </button>
        </div>
      </div>
    </section>
  );
}

function Hero({ me, lesson, index, total }: { me: Me; lesson?: LessonRow; index: number; total: number }) {
  const companion = useCompanion();
  if (!lesson) return null;
  const prog = parseProgress(lesson.my_progress);
  const step = nextStepOf(prog);
  const fresh = Object.keys(prog).length === 0 && index === 1 && me.game.xp === 0;
  return (
    <section className="hero">
      <div className="hero-text">
        <span className="hero-kicker">
          <Sparkle size={16} weight="fill" /> {fresh ? "Bắt đầu hành trình" : `Bài ${index}/${total} · ${lesson.level} ${LEVEL_LABEL[lesson.level] ?? ""}`}
        </span>
        <h1>{fresh ? `Chào ${me.user.login}! Mình là ${COMPANIONS[companion].label}.` : lesson.title}</h1>
        <p>{fresh ? "Mỗi ngày vài phút: học từ, nghe, chép, nói và đọc. Mình sẽ đi cùng bạn." : (lesson.summary ?? lesson.topic)}</p>
        <div className="hero-steps" aria-label="Tiến độ bài">
          {STEPS.map((s) => (
            <span key={s.key} className={s.key in prog ? "on" : s.key === step.key ? "now" : ""} title={s.label}>
              <Fx name={s.fx} size={22} />
            </span>
          ))}
        </div>
        <a className="btn primary big" href={`#/lesson/${lesson.id}/${step.key}`}>
          <Play size={20} weight="fill" /> {fresh ? "Học bài đầu tiên" : `Tiếp tục: ${step.label}`}
        </a>
      </div>
      <Mascot name={companion} mood="cheer" className="hero-mascot" />
      <span className="hero-bubble">{greeting(me)}</span>
    </section>
  );
}

function PathNode({
  lesson,
  offset,
  isCurrent,
  open,
  onToggle,
}: {
  lesson: LessonRow;
  offset: number;
  isCurrent: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const prog = parseProgress(lesson.my_progress);
  const done = Object.keys(prog).length;
  const complete = done === STEPS.length;
  const cat = category(lesson.category);
  const step = nextStepOf(prog);
  const r = 46;
  const len = 2 * Math.PI * r;
  return (
    <div className={open ? "node-wrap open" : "node-wrap"} style={{ "--x": `${offset}px` } as React.CSSProperties} id={`node-${lesson.id}`}>
      {isCurrent && !open && <span className="start-tip">{done ? "TIẾP TỤC" : "BẮT ĐẦU"}</span>}
      <button
        className={`node cat-${cat.key} ${complete ? "complete" : ""} ${isCurrent ? "current" : ""} ${done ? "" : "fresh"}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${lesson.title}, ${done}/${STEPS.length} bước`}
      >
        <svg className="node-ring" viewBox="0 0 104 104" aria-hidden="true">
          <circle cx="52" cy="52" r={r} className="ring-track" />
          <circle cx="52" cy="52" r={r} className="ring-fill" strokeDasharray={len} strokeDashoffset={len * (1 - done / STEPS.length)} />
        </svg>
        <span className="node-face">
          <Fx name={cat.fx} size={40} />
        </span>
        {complete && <Fx name="crown" size={30} className="node-crown" />}
      </button>
      <span className="node-title">{lesson.title}</span>
      {open && (
        <div className="node-pop" role="dialog">
          <div className="row gap">
            <span className="lvl">{lesson.level}</span>
            <span className="muted small">{cat.label}</span>
          </div>
          <h3>{lesson.title}</h3>
          <p className="small">{lesson.summary ?? lesson.topic}</p>
          <div className="pop-steps">
            {STEPS.map((s) => (
              <a key={s.key} href={`#/lesson/${lesson.id}/${s.key}`} className={s.key in prog ? "on" : ""} title={s.label}>
                <Fx name={s.fx} size={22} />
                {s.key in prog && <i>{prog[s.key]}</i>}
              </a>
            ))}
          </div>
          <a className="btn primary full" href={`#/lesson/${lesson.id}/${step.key}`}>
            {complete ? "ÔN LẠI" : done ? `TIẾP: ${step.label.toUpperCase()}` : "BẮT ĐẦU"}
          </a>
          <a className="pop-link" href={`#/lesson/${lesson.id}`}>
            Xem chi tiết bài <ArrowRight size={14} />
          </a>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="loading">
      <Fx name="books" size={56} className="bob" />
      <span className="muted">Đang tải…</span>
    </div>
  );
}

// ---- One lesson ------------------------------------------------------------------------

function LessonPage({ id, me }: { id: number; me: Me }) {
  const [d, setD] = useState<LessonDetail | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    api<LessonDetail>(`/api/lessons/${id}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [id]);
  if (error) return <p className="error center">{error}</p>;
  if (!d) return <Loading />;
  const l = d.lesson;
  const prog = Object.fromEntries(d.progress.map((p) => [p.step, p.best]));
  const next = nextStepOf(prog);
  const cat = category(l.category);
  const isAdmin = me.user.role === "admin";
  const canDelete = (l.user_id === me.user.id && l.course_order === null) || isAdmin;

  const togglePublic = async () => {
    await api(`/api/lessons/${l.id}`, { method: "PATCH", body: { is_public: !l.is_public } });
    setD({ ...d, lesson: { ...l, is_public: l.is_public ? 0 : 1 } });
  };
  const remove = async () => {
    await api(`/api/lessons/${l.id}`, { method: "DELETE" });
    location.hash = "#/library";
  };

  return (
    <div className="stack-lg">
      <a href={l.course_order ? "#/" : "#/library"} className="back">
        <ArrowLeft size={18} weight="bold" /> {l.course_order ? "Lộ trình" : "Thư viện"}
      </a>
      <header className={`lesson-hero cat-${cat.key}`}>
        <Fx name={cat.fx} size={80} className="lesson-hero-fx" />
        <div>
          <div className="row gap wrap">
            <span className="lvl light">
              {l.level} · {LEVEL_LABEL[l.level]}
            </span>
            <span className="chip-light">{cat.label}</span>
            {!l.is_public && <span className="chip-light">Đang ẩn</span>}
          </div>
          <h1>{l.content.title}</h1>
          <p>{l.content.summary_vi}</p>
          <span className="small hero-meta">
            {l.content.sentences.length} câu · {l.content.vocabulary.length} từ vựng ·{" "}
            {l.course_order ? "Khoá học Wancha" : `soạn bởi ${l.provider === "claude" ? "Claude" : "Workers AI"} cho ${l.author}`}
          </span>
        </div>
      </header>

      <div className="step-grid">
        {STEPS.map((s) => {
          const best = prog[s.key];
          return (
            <a key={s.key} href={`#/lesson/${l.id}/${s.key}`} className={`step-card tone-${s.tone} ${s.key === next.key ? "next" : ""}`}>
              <Fx name={s.fx} size={56} tile />
              <b>{s.label}</b>
              <span className="small muted">{s.hint}</span>
              {best !== undefined ? <span className="best">{best}%</span> : s.key === next.key ? <span className="best new">TIẾP</span> : null}
            </a>
          );
        })}
      </div>

      <section className="card">
        <h2 className="card-title">
          <Fx name="card_index_dividers" size={34} tile /> Từ vựng trong bài
        </h2>
        <div className="vocab-list">
          {l.content.vocabulary.map((v) => (
            <button key={v.word} className="vocab-row" onClick={() => speak(v.word)}>
              <SpeakerHigh size={18} weight="duotone" />
              <b>{v.word}</b>
              <span className="muted small">{v.ipa}</span>
              <span className="grow">{v.meaning_vi}</span>
            </button>
          ))}
        </div>
      </section>

      {(isAdmin || canDelete) && (
        <div className="row gap wrap">
          {isAdmin && (
            <button className="btn small ghost" onClick={togglePublic}>
              {l.is_public ? <EyeSlash size={18} /> : <Eye size={18} />} {l.is_public ? "Ẩn khỏi thư viện" : "Hiện trong thư viện"}
            </button>
          )}
          {canDelete &&
            (confirmDelete ? (
              <>
                <span className="small">Xoá hẳn bài này? Không khôi phục được.</span>
                <button className="btn small danger" onClick={remove}>
                  Xoá
                </button>
                <button className="btn small ghost" onClick={() => setConfirmDelete(false)}>
                  Huỷ
                </button>
              </>
            ) : (
              <button className="btn small ghost danger-text" onClick={() => setConfirmDelete(true)}>
                <Trash size={18} /> Xoá bài
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ---- Library -----------------------------------------------------------------------------

function Library({ me, onQuota }: { me: Me; onQuota: () => void }) {
  const [lessons, setLessons] = useState<LessonRow[] | null>(null);
  const [level, setLevel] = useState("");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ lessons: LessonRow[] }>(`/api/lessons?scope=library&level=${level}&cat=${cat}&q=${encodeURIComponent(q)}`).then((r) =>
        setLessons(r.lessons),
      );
    }, 200);
    return () => clearTimeout(t);
  }, [level, q, cat]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">Thư viện</h1>
        <p className="muted">
          Khoá học có sẵn và bài do mọi người tạo. Học lại bài có sẵn thì <b>không tốn lượt AI</b>.
        </p>
      </div>
      <CreateLesson me={me} onQuota={onQuota} />

      <div className="cat-scroll" role="tablist" aria-label="Chủ đề">
        {[{ key: "", label: "Tất cả", fx: "books" as const }, ...CATEGORIES, { key: "community", label: "Cộng đồng", fx: "sparkles" as const }].map((c) => (
          <button key={c.key || "all"} className={cat === c.key ? "cat-tile on" : "cat-tile"} onClick={() => setCat(c.key)} role="tab" aria-selected={cat === c.key}>
            <Fx name={c.fx} size={44} tile />
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <label className="search">
          <MagnifyingGlass size={20} />
          <input placeholder="Tìm theo tên hoặc chủ đề…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="seg" role="group" aria-label="Trình độ">
          {["", "A1", "A2", "B1", "B2", "C1"].map((lv) => (
            <button key={lv || "all"} className={level === lv ? "on" : ""} onClick={() => setLevel(lv)}>
              {lv || "Mọi cấp"}
            </button>
          ))}
        </div>
      </div>

      {!lessons ? (
        <Loading />
      ) : lessons.length === 0 ? (
        <div className="empty">
          <Fx name="light_bulb" size={64} />
          <p className="muted">Chưa có bài nào khớp. Thử nhờ AI soạn bài ở trên!</p>
        </div>
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
  const done = stepsDone(l);
  const cat = category(l.category);
  return (
    <a className="lesson-card" href={`#/lesson/${l.id}`}>
      <div className={`lc-cover cat-${cat.key}`}>
        <span className="lvl light">{l.level}</span>
        {done === STEPS.length && <Fx name="crown" size={28} className="lc-crown" />}
        <Fx name={cat.fx} size={56} className="lc-fx" />
      </div>
      <div className="lc-body">
        <span className="lc-cat">{cat.label}</span>
        <h3>{l.title}</h3>
        <p className="small muted clamp2">{l.summary ?? l.topic}</p>
        <div className="lc-foot small muted">
          <span>
            <Users size={16} /> {l.learners}
          </span>
          <span>
            <ChatText size={16} /> {l.sentences} câu
          </span>
          {l.course_order === null && <span className="by">bởi {l.author}</span>}
        </div>
        {done > 0 && <Meter value={done} max={STEPS.length} tone="good" />}
      </div>
    </a>
  );
}

const TOPIC_IDEAS = ["Ordering bubble tea", "A trip to Ha Long Bay", "My dream job", "Gaming with friends", "Tết holiday", "Learning to code"];

function CreateLesson({ me, onQuota }: { me: Me; onQuota: () => void }) {
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("B1");
  const [cat, setCat] = useState("");
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
      const r = await api<{ id: number }>("/api/lessons", { body: { topic, level, length, category: cat || undefined } });
      onQuota();
      location.hash = `#/lesson/${r.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="create">
      <div className="create-head">
        <Fx name="robot" size={60} className="bob" tile />
        <div>
          <h2>AI soạn bài theo ý bạn</h2>
          <p className="small">
            Gõ một chủ đề bất kỳ, AI viết đoạn văn kèm từ vựng và câu hỏi rồi lưu vào thư viện cho mọi người.
            {me.maintenance
              ? " Chức năng này đang bảo trì."
              : me.quota.limited && ` Tốn 1 lượt (còn ${me.quota.lessons.left}/${me.quota.lessons.limit}).`}
          </p>
        </div>
      </div>
      <form onSubmit={create} className="create-form">
        <input
          className="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Ví dụ: Ordering bubble tea"
          maxLength={200}
          required
          aria-label="Chủ đề"
        />
        <div className="chips ideas">
          {TOPIC_IDEAS.map((t) => (
            <button key={t} type="button" className="chip glass" onClick={() => setTopic(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="create-opts">
          <div className="seg light" role="group" aria-label="Trình độ">
            {["A1", "A2", "B1", "B2", "C1"].map((lv) => (
              <button type="button" key={lv} className={level === lv ? "on" : ""} onClick={() => setLevel(lv)}>
                {lv}
              </button>
            ))}
          </div>
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="select" aria-label="Chủ đề lớn">
            <option value="">Chủ đề: tự do</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={length} onChange={(e) => setLength(e.target.value)} className="select" aria-label="Độ dài">
            <option value="short">Ngắn · 6 câu</option>
            <option value="medium">Vừa · 10 câu</option>
            <option value="long">Dài · 16 câu</option>
          </select>
        </div>
        {similar.length > 0 && (
          <div className="similar">
            <b>Đã có bài giống vậy, học luôn không tốn lượt AI:</b>
            {similar.map((s) => (
              <a key={s.id} href={`#/lesson/${s.id}`} className="similar-item">
                <Fx name={category(s.category).fx} size={22} /> <span className="grow">{s.title}</span>
                <span className="lvl">{s.level}</span>
              </a>
            ))}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn gold full" disabled={busy || !topic.trim()}>
          <Sparkle size={20} weight="fill" /> {busy ? "AI đang soạn bài… (10–40 giây)" : "Soạn bài"}
        </button>
      </form>
    </section>
  );
}

// ---- Leaderboard -------------------------------------------------------------------------

interface RankRow {
  id: number;
  login: string;
  streak: number;
  week_xp: number;
}

function Leaderboard({ me }: { me: Me }) {
  const [d, setD] = useState<{ rows: RankRow[]; myRank: number | null } | null>(null);
  useEffect(() => {
    api<{ rows: RankRow[]; myRank: number | null }>("/api/leaderboard").then(setD);
  }, []);
  if (!d) return <Loading />;
  const podium = [d.rows[1], d.rows[0], d.rows[2]];
  const medals = ["2nd_place_medal", "1st_place_medal", "3rd_place_medal"] as const;
  return (
    <div className="stack-lg narrow">
      <div className="rank-hero">
        <Fx name="trophy" size={80} className="bob" tile />
        <h1 className="page-title">Giải đấu tuần</h1>
        <p className="muted">XP kiếm được từ thứ Hai. {d.myRank ? `Bạn đang hạng ${d.myRank}.` : "Học một bài để lên bảng!"}</p>
      </div>
      {d.rows.length > 0 && (
        <div className="podium">
          {podium.map((r, k) =>
            r ? (
              <div key={r.id} className={`podium-col p${k} ${r.id === me.user.id ? "me" : ""}`}>
                <Fx name={medals[k]} size={44} />
                <span className="avatar">{r.login.slice(0, 1).toUpperCase()}</span>
                <b>{r.login}</b>
                <span className="small">{r.week_xp} XP</span>
                <div className="podium-block" />
              </div>
            ) : (
              <div key={k} className="podium-col empty" />
            ),
          )}
        </div>
      )}
      <ol className="rank-list">
        {d.rows.slice(3).map((r, i) => (
          <li key={r.id} className={r.id === me.user.id ? "me" : ""}>
            <span className="rank">{i + 4}</span>
            <span className="avatar">{r.login.slice(0, 1).toUpperCase()}</span>
            <b className="grow">{r.login}</b>
            <span className="muted small">
              <Fx name="fire" size={18} /> {r.streak}
            </span>
            <b>{r.week_xp} XP</b>
          </li>
        ))}
      </ol>
      {d.rows.length === 0 && <p className="muted center">Chưa ai có XP tuần này. Bạn là người đầu tiên chứ?</p>}
    </div>
  );
}

// ---- Profile ---------------------------------------------------------------------------------

interface Stats {
  totals: { attempts: number; avg_score: number | null; lessons: number; steps: number };
  xpDaily: { day: string; xp: number }[];
  recent: { target: string; transcript: string; score: number }[];
}

function Profile({ me, onChange }: { me: Me; onChange: () => void }) {
  const [s, setS] = useState<Stats | null>(null);
  const [sound, setSound] = useState(soundOn);
  const [theme, setThemeState] = useState<Theme>(getTheme);
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
      <header className="profile-head">
        <span className="avatar xl">{me.user.login.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{me.user.login}</h1>
          <span className="role-chip">{roleLabel(me.user.role)}</span>
          {me.user.level && <span className="role-chip">Trình độ {me.user.level}</span>}
        </div>
      </header>

      <LevelCard me={me} onChange={onChange} />
      <CompanionPicker me={me} onChange={onChange} />

      <div className="stat-grid">
        <Stat fx="fire" value={me.game.streak} label="ngày liên tiếp" />
        <Stat fx="high_voltage" value={me.game.xp} label="tổng XP" />
        <Stat fx="books" value={s?.totals.lessons ?? "–"} label="bài đã học" />
        <Stat fx="microphone" value={s?.totals.avg_score ?? "–"} label="điểm nói TB" />
      </div>

      <section className="card">
        <h2 className="card-title">
          <Fx name="bar_chart" size={34} tile /> XP 14 ngày qua
        </h2>
        <div className="bars">
          {days.map((d) => (
            <div key={d} className="bar-col" title={`${d}: ${byDay[d] ?? 0} XP`}>
              <div className="bar-v" style={{ height: `${Math.max(3, ((byDay[d] ?? 0) / max) * 100)}%` }} />
              <span>{d.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card settings">
        <h2 className="card-title">
          <Fx name="alarm_clock" size={34} tile /> Cài đặt
        </h2>
        <div className="setting">
          <span>Mục tiêu mỗi ngày</span>
          <div className="seg">
            {[10, 20, 30, 50, 80].map((g) => (
              <button key={g} className={me.game.dailyGoal === g ? "on" : ""} onClick={() => setGoal(g)}>
                {g} XP
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <span>Giao diện</span>
          <div className="seg">
            {(
              [
                ["system", Desktop, "Tự động"],
                ["light", Sun, "Sáng"],
                ["dark", Moon, "Tối"],
              ] as const
            ).map(([t, Icon, label]) => (
              <button
                key={t}
                className={theme === t ? "on" : ""}
                onClick={() => {
                  setTheme(t);
                  setThemeState(t);
                }}
              >
                <Icon size={16} weight="bold" /> {label}
              </button>
            ))}
          </div>
        </div>
        <VoiceSetting />
        <label className="setting switch-row">
          <span>Âm thanh hiệu ứng</span>
          <input
            type="checkbox"
            className="switch"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              setSoundOn(e.target.checked);
            }}
          />
        </label>
      </section>

      {s && s.recent.length > 0 && (
        <section className="card">
          <h2 className="card-title">
            <Fx name="microphone" size={34} tile /> Lần nói gần đây
          </h2>
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
        <SignOut size={20} /> Đăng xuất
      </button>
      <p className="credit">
        {MASCOT_CREDIT} Icon: Phosphor Icons (MIT).
      </p>
    </div>
  );
}

function LevelCard({ me, onChange }: { me: Me; onChange: () => void }) {
  const lv = LEVELS.find((l) => l.key === me.user.level);
  const set = async (level: string) => {
    await api("/api/me", { method: "PATCH", body: { level } });
    onChange();
  };
  return (
    <section className="card level-card">
      <h2 className="card-title">
        <Fx name={lv?.fx ?? "bullseye"} size={34} tile /> Trình độ của bạn
      </h2>
      {lv ? (
        <p>
          <b>
            {lv.key} · {lv.label}
          </b>
          {me.user.placed_at
            ? ` (bài xếp lớp ngày ${new Date(me.user.placed_at + "Z").toLocaleDateString("vi-VN")}, đúng ${me.user.placement_score ?? 0}%)`
            : " (tự chọn)"}
          . Lộ trình bắt đầu từ cấp này.
        </p>
      ) : (
        <p className="muted">Chưa xếp lớp. Làm bài kiểm tra ngắn để bắt đầu đúng cấp.</p>
      )}
      <div className="row gap wrap">
        <a className="btn primary small" href="#/placement">
          {me.user.placed_at ? "Làm lại bài xếp lớp" : "Làm bài xếp lớp"}
        </a>
        <div className="seg">
          {LEVELS.map((l) => (
            <button key={l.key} className={me.user.level === l.key ? "on" : ""} onClick={() => set(l.key)} title={l.label}>
              {l.key}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function CompanionPicker({ me, onChange }: { me: Me; onChange: () => void }) {
  const current = useCompanion();
  const [have, setHave] = useState<MascotName[]>(["wanko"]);
  useEffect(() => {
    availableCompanions().then((m) => setHave((Object.keys(COMPANIONS) as MascotName[]).filter((k) => k === "fox" || m[k])));
  }, []);
  const choose = async (mascot: MascotName) => {
    await api("/api/me", { method: "PATCH", body: { mascot } });
    onChange();
  };
  return (
    <section className="card">
      <h2 className="card-title">
        <Fx name="paw" size={34} tile /> Bạn đồng hành
      </h2>
      <div className="companion-row">
        <Mascot key={current} name={current} className="companion-preview" mood="happy" />
        <div className="companion-list">
          {have.map((k) => (
            <button key={k} className={k === current ? "companion on" : "companion"} onClick={() => choose(k)}>
              <span className="companion-emoji">{COMPANIONS[k].emoji}</span>
              <b>{COMPANIONS[k].label}</b>
              <small>{COMPANIONS[k].kind}</small>
            </button>
          ))}
        </div>
      </div>
      {!have.includes("tororo") && (
        <p className="muted small">
          Muốn thêm hai bé mèo Tororo & Hijiki? Chủ app tải mẫu “Tororo & Hijiki” trên live2d.com/learn/sample, giải nén vào thư mục{" "}
          <code>live2d-extra/</code> rồi deploy lại.
        </p>
      )}
    </section>
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

function Stat({ fx, value, label }: { fx: Parameters<typeof Fx>[0]["name"]; value: React.ReactNode; label: string }) {
  return (
    <div className="stat">
      <Fx name={fx} size={44} tile />
      <div>
        <b>{value}</b>
        <span className="muted small">{label}</span>
      </div>
    </div>
  );
}

/** Picks the English voice used for listening; "automatic" takes the most natural one this browser has. */
function VoiceSetting() {
  const [voices, setVoices] = useState(englishVoices);
  const [uri, setUri] = useState(preferredVoice);
  useEffect(() => {
    // The list may have loaded between the first render and this effect, so read it again.
    setVoices(englishVoices());
    return onVoicesChanged(() => setVoices(englishVoices()));
  }, []);
  const auto = voices[0];
  const pick = (v: string) => {
    setUri(v);
    setPreferredVoice(v);
    void speak("Hi! This is the voice you will hear in your lessons.", { voiceURI: v || undefined });
  };
  if (!("speechSynthesis" in window)) return null;
  return (
    <div className="setting voice-setting">
      <span>Giọng đọc tiếng Anh</span>
      <div className="voice-pick">
        <select className="select" value={uri} onChange={(e) => pick(e.target.value)} aria-label="Giọng đọc tiếng Anh">
          <option value="">Tự động{auto ? ` (${auto.name.replace(/^Microsoft |^Google /, "").replace(/ - .*$/, "")})` : ""}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {isNaturalVoice(v) ? "★ " : ""}
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        <button className="btn small ghost" onClick={() => pick(uri)}>
          <SpeakerHigh size={16} weight="bold" /> Nghe thử
        </button>
      </div>
      {voices.length > 0 && !voices.some(isNaturalVoice) && (
        <span className="muted small voice-hint">
          Trình duyệt này chỉ có giọng máy. Mở app bằng Microsoft Edge để có giọng tự nhiên (Natural), hoặc Chrome để có giọng Google.
        </span>
      )}
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 85 ? "good" : score >= 60 ? "mid" : "low";
  return <span className={`score ${tone}`}>{score}</span>;
}

// ---- Admin -------------------------------------------------------------------------------------

interface AdminUser {
  id: number;
  login: string;
  role: string;
  ai_used: number;
  lessons_used: number;
  grades_used: number;
  xp: number;
  streak: number;
  attempts: number;
  last_seen_at: string | null;
}

interface AdminData {
  users: AdminUser[];
  limits: { lessons: number; grades: number };
  spend: {
    usd: number;
    budget: number;
    byModel: { kind: string; model: string; calls: number; input_tokens: number; output_tokens: number; usd: number }[];
  };
}

function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const load = useCallback(() => {
    api<AdminData>("/api/admin/users").then(setData);
  }, []);
  useEffect(load, [load]);
  const update = async (id: number, body: object) => {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body });
    load();
  };
  if (!data) return <Loading />;
  return (
    <div className="stack-lg">
      <h1 className="page-title">Quản trị</h1>
      <SpendCard usd={data.spend.usd} budget={data.spend.budget} />
      {data.spend.byModel.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Việc</th>
                <th>Model</th>
                <th>Lần gọi</th>
                <th>Token vào / ra</th>
                <th>Chi phí</th>
              </tr>
            </thead>
            <tbody>
              {data.spend.byModel.map((r) => (
                <tr key={r.kind + r.model}>
                  <td>{r.kind === "lesson" ? "Tạo bài" : "Chấm điểm"}</td>
                  <td className="small">{r.model}</td>
                  <td>{r.calls}</td>
                  <td className="small">
                    {r.input_tokens.toLocaleString("vi-VN")} / {r.output_tokens.toLocaleString("vi-VN")}
                  </td>
                  <td>{usd(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="card">
        <h2 className="card-title">Người dùng</h2>
        <p className="muted small">
          Mỗi tài khoản (trừ byocao) được tạo {data.limits.lessons} bài riêng bằng Claude Opus và chấm điểm phát âm{" "}
          {data.limits.grades} lần bằng Claude Haiku. Khi chi phí tháng chạm {usd(data.spend.budget)}, hai chức năng này
          chuyển sang "bảo trì". Bài học: mở bài để ẩn hoặc xoá.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Quyền</th>
                <th>Tạo bài</th>
                <th>Chấm điểm</th>
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
                  <td>{u.role === "admin" ? u.lessons_used : `${u.lessons_used}/${data.limits.lessons}`}</td>
                  <td>{u.role === "admin" ? u.grades_used : `${u.grades_used}/${data.limits.grades}`}</td>
                  <td>{u.xp}</td>
                  <td>{u.attempts}</td>
                  <td className="small muted">{u.last_seen_at ? new Date(u.last_seen_at + "Z").toLocaleString("vi-VN") : "–"}</td>
                  <td className="actions">
                    {u.role !== "admin" && (
                      <>
                        {u.role === "blocked" && (
                          <button className="btn small" onClick={() => update(u.id, { role: "trial" })}>
                            Mở khoá
                          </button>
                        )}
                        {(u.lessons_used > 0 || u.grades_used > 0) && (
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
