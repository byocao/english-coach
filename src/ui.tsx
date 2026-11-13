// Small pieces shared by the pages: loading state, progress meter, lesson card.
import { ChatText, LockSimple, Users } from "@phosphor-icons/react";
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
