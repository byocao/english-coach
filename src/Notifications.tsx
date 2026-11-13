// In-app notifications: class invites (answered right here), replies, removals, new class lessons.
import { Check, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, type Notice } from "./api";
import { Fx, type FxName } from "./meta";
import { Loading } from "./ui";

/** "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước", then the date. */
export function ago(sqlTime: string): string {
  const t = Date.parse(sqlTime.replace(" ", "T") + "Z");
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(t).toLocaleDateString("vi-VN");
}

function describe(n: Notice): { fx: FxName; text: React.ReactNode; href?: string } {
  const who = <b>{n.actor ?? "Ai đó"}</b>;
  const cls = <b>{n.data.className ?? "lớp"}</b>;
  const classHref = n.class_id ? `#/class/${n.class_id}` : undefined;
  switch (n.kind) {
    case "invite":
      return {
        fx: "envelope",
        text: (
          <>
            {who} mời bạn vào lớp {cls} {n.data.role === "teacher" ? "làm giáo viên cùng đứng lớp" : "làm học sinh"}.
          </>
        ),
        href: n.my_status === "active" ? classHref : undefined,
      };
    case "accepted":
      return { fx: "check_mark_button", text: <>{who} đã vào lớp {cls}.</>, href: classHref };
    case "declined":
      return { fx: "cross_mark", text: <>{who} đã từ chối lời mời vào lớp {cls}.</>, href: classHref };
    case "removed":
      return { fx: "students", text: <>{who} đã đưa bạn ra khỏi lớp {cls}.</> };
    case "left":
      return { fx: "students", text: <>{who} đã rời lớp {cls}.</>, href: classHref };
    case "lesson":
      return {
        fx: "books",
        text: (
          <>
            {who} thêm bài <b>“{n.data.lessonTitle}”</b> vào lớp {cls}.
          </>
        ),
        href: n.lesson_id ? `#/lesson/${n.lesson_id}` : classHref,
      };
    case "class_deleted":
      return { fx: "classroom", text: <>{who} đã xoá lớp {cls}.</> };
  }
}

/** Accepts or declines a class invite; returns the error text, if any. */
export async function answerInvite(classId: number, accept: boolean): Promise<string> {
  try {
    await api(`/api/classes/${classId}/join`, { body: { accept } });
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

export function Notifications({ onRead, onJoin }: { onRead: () => void; onJoin: () => void }) {
  const [list, setList] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ notifications: Notice[] }>("/api/notifications");
    setList(r.notifications);
    // Opening the page reads everything; the list keeps its highlight until the next visit.
    if (r.notifications.some((n) => !n.read_at)) {
      await api("/api/notifications/read", { method: "POST" }).catch(() => {});
      onRead();
    }
  }, [onRead]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const answer = async (n: Notice, accept: boolean) => {
    if (!n.class_id) return;
    setBusy(n.id);
    const err = await answerInvite(n.class_id, accept);
    setBusy(null);
    setError(err);
    if (err) return;
    onJoin();
    if (accept) location.hash = `#/class/${n.class_id}`;
    else load();
  };

  if (!list) return error ? <p className="error center">{error}</p> : <Loading />;
  return (
    <div className="stack-lg narrow">
      <div className="page-head">
        <h1 className="page-title">Thông báo</h1>
        <p className="muted">Lời mời vào lớp, bài mới của lớp và tin từ giáo viên.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {list.length === 0 ? (
        <div className="empty">
          <Fx name="bell" size={64} />
          <p className="muted">Chưa có thông báo nào.</p>
        </div>
      ) : (
        <ul className="notices">
          {list.map((n) => {
            const d = describe(n);
            const pending = n.kind === "invite" && n.my_status === "invited";
            const body = (
              <>
                <Fx name={d.fx} size={40} tile />
                <div className="grow">
                  <p>{d.text}</p>
                  <span className="small muted">{ago(n.created_at)}</span>
                  {n.kind === "invite" && !pending && (
                    <span className="small muted">
                      {" · "}
                      {n.my_status === "active" ? "Bạn đã vào lớp" : "Lời mời đã đóng"}
                    </span>
                  )}
                </div>
              </>
            );
            return (
              <li key={n.id} className={n.read_at ? "notice" : "notice unread"}>
                {d.href ? (
                  <a className="notice-main" href={d.href}>
                    {body}
                  </a>
                ) : (
                  <div className="notice-main">{body}</div>
                )}
                {pending && (
                  <div className="notice-actions">
                    <button className="btn primary small" disabled={busy === n.id} onClick={() => answer(n, true)}>
                      <Check size={16} weight="bold" /> Vào lớp
                    </button>
                    <button className="btn ghost small" disabled={busy === n.id} onClick={() => answer(n, false)}>
                      <X size={16} weight="bold" /> Từ chối
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
