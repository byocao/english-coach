// Who can see which lesson, and the columns lesson lists share. ?1 is always the viewer's user id.
import type { User } from "./env";

/** Lesson list columns; the my_* columns are the viewer's own progress. */
export const LESSON_COLUMNS = `l.id, l.title, l.topic, l.level, l.is_public, l.created_at, l.user_id, u.login AS author,
  l.category, l.course_order, json_extract(l.content, '$.summary_vi') AS summary,
  json_array_length(l.content, '$.sentences') AS sentences,
  (SELECT COUNT(DISTINCT p.user_id) FROM lesson_progress p WHERE p.lesson_id = l.id) AS learners,
  (SELECT COUNT(*) FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = ?1) AS my_steps,
  (SELECT MAX(p.updated_at) FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = ?1) AS my_last,
  (SELECT json_group_object(p.step, p.best) FROM lesson_progress p WHERE p.lesson_id = l.id AND p.user_id = ?1) AS my_progress`;

/** Lesson l is in a class the viewer belongs to (as a student or a teacher). */
export const IN_MY_CLASS = `EXISTS (SELECT 1 FROM class_lessons cl JOIN class_members cm ON cm.class_id = cl.class_id
  WHERE cl.lesson_id = l.id AND cm.user_id = ?1 AND cm.status = 'active')`;

/**
 * SQL condition: the viewer may open lesson l. Public lessons are for everyone; a private lesson only for its
 * author, the admin and the members of a class that has it.
 */
export function canSee(user: Pick<User, "role">): string {
  return user.role === "admin" ? "1 = 1" : `(l.is_public = 1 OR l.user_id = ?1 OR ${IN_MY_CLASS})`;
}

/** Monday 00:00 in Vietnam time (UTC+7), as a UTC datetime to compare with created_at. */
export const WEEK_START = `datetime(date('now', '+7 hours', 'weekday 0', '-6 days'), '-7 hours')`;
