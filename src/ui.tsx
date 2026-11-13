// Small pieces shared by the pages: loading state, progress meter, lesson card.
import { CaretLeft, CaretRight, ChatText, LockSimple, Users } from "@phosphor-icons/react";
import type { LessonRow } from "./api";
import { Fx, STEPS, category, parseProgress } from "./meta";

export function stepsDone(l: LessonRow): number {
  return Object.keys(parseProgress(l.my_progress)).length;
}

export function Meter({ value, max, tone = "" }: { value: number; max: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`meter ${tone}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading">
      <Fx name="books" size={56} className="bob" />
      <span className="muted">Đang tải…</span>
    </div>
  );
}

export function LessonCard({ l }: { l: LessonRow }) {
  const done = stepsDone(l);
  const cat = category(l.category);
  return (
    <a className="lesson-card" href={`#/lesson/${l.id}`}>
      <div className={`lc-cover cat-${cat.key}`}>
        <span className="lvl light">{l.level}</span>
        {done === STEPS.length && <Fx name="crown" size={28} className="lc-crown" />}
        {!l.is_public && (
          <span className="lc-private" title="Bài riêng: chỉ học sinh trong lớp của tác giả mới mở được">
            <LockSimple size={14} weight="bold" /> Riêng
          </span>
        )}
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

/** Page numbers to show: the first, the last, and the current page with its neighbours; null marks a gap (…). */
function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | null)[] = [];
  let last = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - last === 2) out.push(p - 1); // a gap of one page: show it rather than "…"
    else if (p - last > 2) out.push(null);
    out.push(p);
    last = p;
  }
  return out;
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  return (
    <nav className="pager" aria-label="Phân trang">
      {pages > 1 && (
        <div className="pager-buttons">
          <button className="pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước">
            <CaretLeft size={18} weight="bold" />
          </button>
          {pageList(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap${i}`} className="pager-gap">
                …
              </span>
            ) : (
              <button
                key={p}
                className={p === page ? "pager-btn on" : "pager-btn"}
                aria-current={p === page ? "page" : undefined}
                onClick={() => p !== page && onPage(p)}
              >
                {p}
              </button>
            ),
          )}
          <button className="pager-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau">
            <CaretRight size={18} weight="bold" />
          </button>
        </div>
      )}
      <span className="small muted">
        {pages > 1 ? `Trang ${page}/${pages} · ` : ""}
        {total} bài
      </span>
    </nav>
  );
}
