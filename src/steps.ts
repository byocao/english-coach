import type { Step } from "./api";

export const STEPS: { key: Step; label: string; icon: string; hint: string; color: string }[] = [
  { key: "listen", label: "Nghe & xếp câu", icon: "🎧", hint: "Nghe rồi xếp từ thành câu", color: "blue" },
  { key: "dictation", label: "Chép chính tả", icon: "✍️", hint: "Gõ lại câu bạn nghe được", color: "purple" },
  { key: "speak", label: "Luyện nói", icon: "🎙️", hint: "Đọc to, AI chấm phát âm", color: "red" },
  { key: "read", label: "Đọc hiểu", icon: "📖", hint: "Đọc bài, tra từ, hỏi AI", color: "orange" },
  { key: "quiz", label: "Câu hỏi", icon: "🏆", hint: "Trả lời câu hỏi về bài", color: "green" },
];

export const UNIT_COLORS = ["green", "blue", "purple", "orange", "red", "teal"];

export function unitColor(id: number): string {
  return UNIT_COLORS[id % UNIT_COLORS.length];
}

export const LEVEL_LABEL: Record<string, string> = {
  A1: "Mới bắt đầu",
  A2: "Sơ cấp",
  B1: "Trung cấp",
  B2: "Trung cao",
  C1: "Nâng cao",
};
