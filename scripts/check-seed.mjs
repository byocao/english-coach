// Validates seed/lessons/*.json (the built-in course). Usage: node scripts/check-seed.mjs [A1.json ...]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../seed/lessons/", import.meta.url);
const CATEGORIES = ["daily", "food", "travel", "work", "study", "tech", "health", "fun", "nature", "people"];
const LIMITS = { A1: [6, 9, 12], A2: [8, 11, 15], B1: [9, 12, 18], B2: [10, 13, 22], C1: [10, 14, 24] };

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(DIR).filter((f) => f.endsWith(".json"));
let problems = 0;
const slugs = new Set();
const bad = (where, msg) => {
  problems++;
  console.log(`✗ ${where}: ${msg}`);
};
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'");

for (const f of files) {
  const path = f.includes("/") || f.includes("\\") ? f : join(DIR.pathname.replace(/^\/([A-Za-z]:)/, "$1"), f);
  let lessons;
  try {
    lessons = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    bad(f, `invalid JSON: ${e.message}`);
    continue;
  }
  if (!Array.isArray(lessons)) {
    bad(f, "top level must be an array");
    continue;
  }
  for (const [i, l] of lessons.entries()) {
    const at = `${f}#${i} ${l.slug ?? "?"}`;
    for (const k of ["slug", "category", "topic", "level", "title", "summary_vi"]) if (typeof l[k] !== "string" || !l[k].trim()) bad(at, `missing ${k}`);
    if (slugs.has(l.slug)) bad(at, "duplicate slug");
    slugs.add(l.slug);
    if (!CATEGORIES.includes(l.category)) bad(at, `category must be one of ${CATEGORIES.join(", ")}`);
    const lim = LIMITS[l.level];
    if (!lim) {
      bad(at, "bad level");
      continue;
    }
    if (!Array.isArray(l.sentences) || l.sentences.length < lim[0] || l.sentences.length > lim[1])
      bad(at, `needs ${lim[0]}-${lim[1]} sentences, has ${l.sentences?.length}`);
    const passage = norm((l.sentences ?? []).join(" "));
    for (const s of l.sentences ?? []) if (s.split(/\s+/).length > lim[2]) bad(at, `sentence over ${lim[2]} words: "${s}"`);
    if (!Array.isArray(l.vocabulary) || l.vocabulary.length < 6 || l.vocabulary.length > 8) bad(at, `needs 6-8 vocabulary items`);
    for (const v of l.vocabulary ?? []) {
      for (const k of ["word", "ipa", "pos", "meaning_vi", "example"]) if (typeof v[k] !== "string" || !v[k].trim()) bad(at, `vocab ${v.word}: missing ${k}`);
      if (v.word && !passage.includes(norm(v.word))) bad(at, `vocab "${v.word}" not found verbatim in the passage`);
      if (v.word && v.example && !norm(v.example).includes(norm(v.word))) bad(at, `example for "${v.word}" must contain it verbatim`);
      if (v.ipa && !/^\/.+\/$/.test(v.ipa)) bad(at, `ipa for "${v.word}" must be wrapped in slashes`);
    }
    if (!Array.isArray(l.questions) || l.questions.length !== 4) bad(at, "needs exactly 4 questions");
    for (const q of l.questions ?? []) {
      if (!Array.isArray(q.options) || q.options.length !== 4) bad(at, `question "${q.question}" needs 4 options`);
      if (!Number.isInteger(q.answer_index) || q.answer_index < 0 || q.answer_index > 3) bad(at, `bad answer_index in "${q.question}"`);
      if (typeof q.explanation_vi !== "string" || !q.explanation_vi.trim()) bad(at, `missing explanation_vi in "${q.question}"`);
    }
    const answers = new Set((l.questions ?? []).map((q) => q.answer_index));
    if (answers.size < 2) bad(at, "vary answer_index across questions");
  }
  console.log(`${f}: ${lessons.length} lessons`);
}
console.log(problems ? `${problems} problem(s)` : "all good");
process.exit(problems ? 1 : 0);
