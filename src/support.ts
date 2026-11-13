// Where people report bugs, lesson errors and ideas. Change these two if you run your own copy.
export const SUPPORT_EMAIL = "byocao@gmail.com";
export const ISSUES_URL = "https://github.com/byocao/english-coach/issues";

type Template = "bug_report.yml" | "lesson_error.yml" | "feature_request.yml";

const enc = encodeURIComponent;

/** "Android · Chrome 131 · 412×915": enough to reproduce a bug, nothing personal. */
export function deviceInfo(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Khác";
  const m = ua.match(/(Edg|OPR|SamsungBrowser|Firefox|CriOS|Chrome)\/(\d+)/);
  const safari = !m && /Safari/.test(ua) ? ua.match(/Version\/(\d+)/) : null;
  const names: Record<string, string> = { Edg: "Edge", OPR: "Opera", CriOS: "Chrome", SamsungBrowser: "Samsung Internet" };
  const name = m ? `${names[m[1]] ?? m[1]} ${m[2]}` : safari ? `Safari ${safari[1]}` : "trình duyệt khác";
  return `${os} · ${name} · ${innerWidth}×${innerHeight}`;
}

/** A GitHub issue form with some fields filled in (keys are the form's field ids). */
export function issueUrl(template: Template, fields: Record<string, string> = {}, title?: string): string {
  const q = [`template=${enc(template)}`, ...(title ? [`title=${enc(title)}`] : []), ...Object.entries(fields).map(([k, v]) => `${k}=${enc(v)}`)];
  return `${ISSUES_URL}/new?${q.join("&")}`;
}

export function lessonErrorUrl(lesson: { id: number; title: string }): string {
  return issueUrl(
    "lesson_error.yml",
    { lesson: `${lesson.title} – ${location.origin}/#/lesson/${lesson.id}`, device: deviceInfo() },
    `[Bài học] ${lesson.title}: `,
  );
}

/** An email to support, with the account and device at the bottom so we can help. */
export function mailtoUrl(login?: string): string {
  const body = `\n\n\n---\n${login ? `Tài khoản: ${login}\n` : ""}Thiết bị: ${deviceInfo()}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${enc("[Wancha] Góp ý")}&body=${enc(body)}`;
}
