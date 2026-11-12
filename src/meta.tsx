// Shared look-up tables (steps, levels, topic categories) and the icon component.
// Icons: Phosphor (MIT), drawn as crisp vectors in each concept's own colour.
import {
  AirplaneTilt,
  BookOpenText,
  Briefcase,
  Cards,
  ChartBar,
  ChatsCircle,
  CheckCircle,
  Confetti,
  Crown,
  Diamond,
  FilmSlate,
  Fire,
  ForkKnife,
  GearSix,
  Gift,
  GraduationCap,
  Headphones,
  Heartbeat,
  House,
  Laptop,
  Leaf,
  Lightbulb,
  Lightning,
  Lock,
  Medal,
  Microphone,
  Mountains,
  Notebook,
  PawPrint,
  PencilLine,
  Plant,
  PuzzlePiece,
  Robot,
  RocketLaunch,
  SealCheck,
  Sparkle,
  SpeakerHigh,
  Star,
  Target,
  Tree,
  Trophy,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import type { Game, Step } from "./api";

const ICONS = {
  books: [Cards, "#7c5cff"],
  headphone: [Headphones, "#2aa8ff"],
  memo: [PencilLine, "#18b98a"],
  microphone: [Microphone, "#ff4fa3"],
  open_book: [BookOpenText, "#f59e0b"],
  trophy: [Trophy, "#ffb020"],
  fire: [Fire, "#ff7a1a"],
  high_voltage: [Lightning, "#ffb020"],
  bullseye: [Target, "#ff4d6a"],
  "1st_place_medal": [Medal, "#ffb020"],
  "2nd_place_medal": [Medal, "#9aa6b8"],
  "3rd_place_medal": [Medal, "#d0844a"],
  gem_stone: [Diamond, "#2aa8ff"],
  wrapped_gift: [Gift, "#ff4fa3"],
  glowing_star: [Star, "#ffb020"],
  party_popper: [Confetti, "#ff4fa3"],
  locked: [Lock, "#9a95c0"],
  check_mark_button: [CheckCircle, "#18b96b"],
  cross_mark: [XCircle, "#ff4d6a"],
  crown: [Crown, "#ffb020"],
  sparkles: [Sparkle, "#b65cff"],
  robot: [Robot, "#7c5cff"],
  light_bulb: [Lightbulb, "#ffb020"],
  speaker_high_volume: [SpeakerHigh, "#2aa8ff"],
  seedling: [Plant, "#18b96b"],
  herb: [Leaf, "#2aa8ff"],
  deciduous_tree: [Tree, "#7c5cff"],
  "snow-capped_mountain": [Mountains, "#ff4f8b"],
  rocket: [RocketLaunch, "#ff7a1a"],
  house: [House, "#ff9c3b"],
  steaming_bowl: [ForkKnife, "#ff5f7e"],
  airplane: [AirplaneTilt, "#4a78f5"],
  briefcase: [Briefcase, "#7a4cf0"],
  graduation_cap: [GraduationCap, "#13b38a"],
  laptop: [Laptop, "#2283db"],
  stethoscope: [Heartbeat, "#f2455a"],
  clapper_board: [FilmSlate, "#e0418d"],
  four_leaf_clover: [Leaf, "#34a853"],
  speech_balloon: [ChatsCircle, "#f6a609"],
  puzzle_piece: [PuzzlePiece, "#7c5cff"],
  card_index_dividers: [Notebook, "#7c5cff"],
  bar_chart: [ChartBar, "#7c5cff"],
  alarm_clock: [GearSix, "#7c5cff"],
  hundred_points: [SealCheck, "#18b96b"],
  paw: [PawPrint, "#ff7a59"],
} satisfies Record<string, [Icon, string]>;

export type FxName = keyof typeof ICONS;

/**
 * An icon in its own colour. `tile` puts it white on a rounded gradient tile (app-icon style);
 * inside coloured surfaces (.on-color) CSS turns it white.
 */
export function Fx({ name, size = 28, label, className = "", tile = false }: { name: FxName; size?: number; label?: string; className?: string; tile?: boolean }) {
  const [Glyph, color] = ICONS[name];
  return (
    <span
      className={`fx ${tile ? "tile" : ""} ${className}`}
      style={{ "--fx": color, "--fx-size": `${size}px` } as React.CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Glyph size={tile ? Math.round(size * 0.58) : size} weight="fill" />
    </span>
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
