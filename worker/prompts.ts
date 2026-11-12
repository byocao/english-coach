// Prompts and JSON schemas shared by both providers (Claude via bridge, Workers AI).

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];

export const LENGTHS = { short: 6, medium: 10, long: 16 } as const;
export type LengthKey = keyof typeof LENGTHS;

export interface Lesson {
  title: string;
  summary_vi: string;
  sentences: string[];
  vocabulary: { word: string; ipa: string; pos: string; meaning_vi: string; example: string }[];
  questions: { question: string; options: string[]; answer_index: number; explanation_vi: string }[];
}

export const lessonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary_vi", "sentences", "vocabulary", "questions"],
  properties: {
    title: { type: "string" },
    summary_vi: { type: "string" },
    sentences: { type: "array", items: { type: "string" } },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "ipa", "pos", "meaning_vi", "example"],
        properties: {
          word: { type: "string" },
          ipa: { type: "string" },
          pos: { type: "string" },
          meaning_vi: { type: "string" },
          example: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "answer_index", "explanation_vi"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer_index: { type: "integer" },
          explanation_vi: { type: "string" },
        },
      },
    },
  },
} as const;

export const LESSON_SYSTEM = `You are an English teacher writing practice material for Vietnamese learners.
Write natural, modern English that a native speaker would actually say or write. Explanations for the learner are in Vietnamese.`;

export function lessonPrompt(topic: string, level: Level, length: LengthKey): string {
  const n = LENGTHS[length];
  return `Write a short English reading-and-listening lesson.

Topic: ${topic}
CEFR level: ${level}
Number of sentences: about ${n}

Requirements:
- "sentences": the passage as a list of complete sentences, in order, each at most 22 words, vocabulary and grammar matching ${level}. They will be read aloud for listening and shadowing practice, so they must sound natural when spoken.
- "title": a short English title. "summary_vi": one-sentence summary in Vietnamese.
- "vocabulary": 6-10 useful words or phrases from the passage, with IPA (American), part of speech, Vietnamese meaning, and a new example sentence.
- "questions": 4 multiple-choice comprehension questions in English, each with exactly 4 options, the index (0-3) of the correct one, and a short explanation in Vietnamese.`;
}

export interface Grade {
  score: number;
  words: { word: string; status: "ok" | "unclear" | "missing" | "extra"; tip_vi: string }[];
  feedback_vi: string;
  next_step_vi: string;
}

export const gradeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "words", "feedback_vi", "next_step_vi"],
  properties: {
    score: { type: "integer" },
    words: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "status", "tip_vi"],
        properties: {
          word: { type: "string" },
          status: { type: "string", enum: ["ok", "unclear", "missing", "extra"] },
          tip_vi: { type: "string" },
        },
      },
    },
    feedback_vi: { type: "string" },
    next_step_vi: { type: "string" },
  },
} as const;

export const GRADE_SYSTEM = `You are a friendly English pronunciation coach for Vietnamese learners.
You cannot hear the audio. You receive the sentence the learner tried to say and what a speech recogniser (Whisper) heard. Where the recogniser heard a different word, the learner most likely mispronounced it; where a word is absent, it was swallowed or skipped.
Know the typical Vietnamese-speaker issues (dropped final consonants such as /t/ /d/ /s/ /z/ /k/, missing -ed and -s endings, /θ/ and /ð/, /ʃ/ vs /s/, /r/ vs /l/, flat word stress, no linking) and use them to explain likely causes. Never claim certainty you do not have.`;

export function gradePrompt(target: string, transcript: string, matchRatio: number): string {
  return `Target sentence: "${target}"
Recogniser heard: "${transcript || "(nothing)"}"
Word match ratio (computed): ${Math.round(matchRatio * 100)}%

Return:
- "score": 0-100 overall intelligibility score. Anchor it on the word match ratio; adjust a little for how serious the differences are (a wrong content word costs more than a dropped article).
- "words": every word of the target sentence in order, with status "ok", "unclear" (recognised as something else), or "missing"; add "extra" entries for words the recogniser heard that are not in the target. "tip_vi" is a short Vietnamese pronunciation tip for non-ok words (IPA welcome), empty string for ok words.
- "feedback_vi": 1-3 sentences of encouraging, specific feedback in Vietnamese.
- "next_step_vi": one concrete thing to practise next, in Vietnamese.`;
}

export interface Explain {
  translation_vi: string;
  grammar_vi: string;
  notes_vi: string[];
}

export const explainSchema = {
  type: "object",
  additionalProperties: false,
  required: ["translation_vi", "grammar_vi", "notes_vi"],
  properties: {
    translation_vi: { type: "string" },
    grammar_vi: { type: "string" },
    notes_vi: { type: "array", items: { type: "string" } },
  },
} as const;

export const EXPLAIN_SYSTEM = `You are an English teacher explaining English to Vietnamese learners, clearly and briefly, in Vietnamese.`;

export function explainPrompt(sentence: string, context: string): string {
  return `Explain this English sentence for a Vietnamese learner.

Sentence: "${sentence}"
Surrounding passage (for context only): "${context}"

Return "translation_vi" (natural Vietnamese translation), "grammar_vi" (the key grammar structure, briefly), and "notes_vi" (2-4 short notes on useful phrases, collocations or pronunciation such as linking and stress).`;
}
