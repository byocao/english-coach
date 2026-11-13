// Prints the built-in course per level: lesson count, lessons per category, and every slug + title + topic,
// so a writer can pick new topics that do not repeat existing ones. Usage: node scripts/course-index.mjs
import { readFileSync } from "node:fs";
import { SEED_DIR } from "./seed-dir.mjs";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const CATEGORIES = ["daily", "food", "travel", "work", "study", "tech", "health", "fun", "nature", "people"];

for (const level of LEVELS) {
  const lessons = JSON.parse(readFileSync(new URL(`${level}.json`, SEED_DIR), "utf8"));
  const per = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const l of lessons) per[l.category] = (per[l.category] ?? 0) + 1;
  console.log(`\n## ${level}: ${lessons.length} lessons`);
  console.log("per category: " + CATEGORIES.map((c) => `${c} ${per[c]}`).join(", "));
  for (const l of lessons) console.log(`- ${l.slug} [${l.category}] "${l.title}" (${l.topic})`);
}
