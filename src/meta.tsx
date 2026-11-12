// Shared look-up tables (steps, levels, topic categories) and the 3D icon component.
// 3D icons: Microsoft Fluent Emoji (MIT), resized into public/fx. UI icons: Phosphor (MIT).
import type { Game, Step } from "./api";

export type FxName =
  | "books" | "headphone" | "memo" | "microphone" | "open_book" | "trophy" | "fire" | "high_voltage"
  | "bullseye" | "1st_place_medal" | "2nd_place_medal" | "3rd_place_medal" | "gem_stone" | "wrapped_gift"
  | "glowing_star" | "party_popper" | "locked" | "check_mark_button" | "cross_mark" | "crown" | "sparkles"
  | "robot" | "light_bulb" | "speaker_high_volume" | "snail" | "seedling" | "herb" | "deciduous_tree"
  | "snow-capped_mountain" | "rocket" | "house" | "steaming_bowl" | "airplane" | "briefcase" | "graduation_cap"
  | "laptop" | "stethoscope" | "clapper_board" | "four_leaf_clover" | "speech_balloon" | "puzzle_piece"
  | "card_index_dividers" | "bar_chart" | "alarm_clock" | "hundred_points";

/** A Fluent 3D emoji picture. Decorative unless `label` is given. */
export function Fx({ name, size = 28, label, className = "" }: { name: FxName; size?: number; label?: string; className?: string }) {
  return (
    <img
      className={`fx ${className}`}
      src={`/fx/${name}.webp`}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}

export const STEPS: { key: Step; label: string; fx: FxName; hint: string; tone: string }[] = [
  { key: "words", label: "Từ vựng", fx: "books", hint: "Thẻ từ, ghép cặp, điền từ", tone: "violet" },
  { key: "listen", label: "Nghe & xếp câu", fx: "headphone", hint: "Nghe rồi xếp từ thành câu", tone: "sky" },
  { key: "dictation", label: "Chép chính tả", fx: "memo", hint: "Gõ lại câu bạn nghe được", tone: "mint" },
  { key: "speak", label: "Luyện nói", fx: "microphone", hint: "Đọc to, AI chấm phát âm", tone: "pink" },
  { key: "read", label: "Đọc hiểu", fx: "open_book", hint: "Đọc bài, tra từ, hỏi AI", tone: "amber" },
  { key: "quiz", label: "Thử thách", fx: "trophy", hint: "Trả lời câu hỏi về bài", tone: "coral" },
];

export const LEVELS: { key: string; label: string; fx: FxName; blurb: string }[] = [
  { key: "A1", label: "Mới bắt đầu", fx: "seedling", blurb: "Câu ngắn, từ thông dụng, chào hỏi và đời sống hằng ngày." },
  { key: "A2", label: "Sơ cấp", fx: "herb", blurb: "Kể chuyện quá khứ, đi lại, ăn uống, công việc đầu tiên." },
  { key: "B1", label: "Trung cấp", fx: "deciduous_tree", blurb: "Bày tỏ ý kiến, cụm động từ, chủ đề xã hội quen thuộc." },
  { key: "B2", label: "Trung cao", fx: "snow-capped_mountain", blurb: "Bài luận, tin tức, thành ngữ và lập luận rõ ràng." },
  { key: "C1", label: "Nâng cao", fx: "rocket", blurb: "Ngôn ngữ tinh tế, bài nói chuyên đề, sắc thái và hàm ý." },
];
export const LEVEL_LABEL: Record<string, string> = Object.fromEntries(LEVELS.map((l) => [l.key, l.label]));

export const CATEGORIES: { key: string; label: string; fx: FxName }[] = [
  { key: "daily", label: "Đời sống", fx: "house" },
  { key: "food", label: "Ăn uống", fx: "steaming_bowl" },
  { key: "travel", label: "Du lịch", fx: "airplane" },
  { key: "work", label: "Công việc", fx: "briefcase" },
  { key: "study", label: "Học tập", fx: "graduation_cap" },
  { key: "tech", label: "Công nghệ", fx: "laptop" },
  { key: "health", label: "Sức khoẻ", fx: "stethoscope" },
  { key: "fun", label: "Giải trí", fx: "clapper_board" },
  { key: "nature", label: "Thiên nhiên", fx: "four_leaf_clover" },
  { key: "people", label: "Con người", fx: "speech_balloon" },
];
const COMMUNITY = { key: "community", label: "Cộng đồng", fx: "sparkles" as FxName };

export function category(key: string | null | undefined) {
  return CATEGORIES.find((c) => c.key === key) ?? COMMUNITY;
}

/** Progress map {step: best} from a lesson row's JSON column. */
export function parseProgress(json: string | null | undefined): Record<string, number> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, number>;
  } catch {
    return {};
  }
}

export interface Quest {
  id: string;
  fx: FxName;
  label: string;
  value: number;
  target: number;
}

/** Three daily quests, computed from today's activity. */
export function quests(g: Game): Quest[] {
  return [
    { id: "xp", fx: "high_voltage", label: `Kiếm ${g.dailyGoal} XP`, value: Math.min(g.todayXp, g.dailyGoal), target: g.dailyGoal },
    { id: "steps", fx: "bullseye", label: "Hoàn thành 3 bài tập", value: Math.min(g.todaySteps, 3), target: 3 },
    { id: "speak", fx: "microphone", label: "Nói đạt 80 điểm", value: g.bestSpeakToday >= 80 ? 1 : 0, target: 1 },
  ];
}
