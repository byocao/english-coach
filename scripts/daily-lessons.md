# Daily lessons

The live site grows its built-in course every day: a scheduled Claude Code task on the maintainer's machine writes
**3 new lessons for each level** (A1, A2, B1, B2, C1: 15 a day) and upserts them into the production D1 database.
The lesson content is not published in this repository (see `seed/README.md`); this file only describes the method,
so you can run the same thing for your own course.

## Steps for the task

1. Work in the project folder. The lessons live in `seed/live/<LEVEL>.json` (gitignored). No git commands are needed:
   nothing here is committed.
2. Run `node scripts/course-index.mjs` and read it. Never reuse a slug, title or topic that is already there, and do
   not write a near-duplicate of an existing lesson under a new name.
3. For each level, pick 3 topics from the **least-used categories** at that level (allowed: daily, food, travel,
   work, study, tech, health, fun, nature, people). Prefer concrete, useful situations for Vietnamese learners; a
   Vietnamese setting is welcome where natural. Slugs: `<level in lowercase>-<short-kebab-topic>`.
4. Append the lessons to the level's file, copying the exact format and tone of the lessons already there.
   `scripts/check-seed.mjs` is the rulebook: sentence count and words per sentence per level, `sentences_vi`
   translating every sentence in order, 6–8 vocabulary items whose `word` appears verbatim in the passage and in its
   `example`, IPA in `/slashes/`, exactly 4 questions with 4 options and varied `answer_index`.
   - Level guide: A1 very simple present tense; A2 simple past/future and everyday vocabulary; B1 opinions, reasons,
     phrasal verbs; B2 complex sentences, hedging, contrasting views; C1 nuanced argument, abstract and academic
     vocabulary. No invented statistics.
   - Vietnamese (`summary_vi`, `sentences_vi`, `meaning_vi`, `example_vi`, `explanation_vi`) must be natural, correct
     and fully accented. `summary_vi` starts with "Bạn sẽ luyện …".
   - Append only: never edit, reorder or delete existing lessons.
5. Run `npm run seed:check` and fix every problem until it prints "all good".
6. Back up the files before publishing: copy `seed/live/` to `seed/live-backup/<YYYY-MM-DD>/` (also gitignored).
7. Publish: `npm run db:seed:remote` (Wrangler must be signed in). It upserts every lesson by slug, so running it
   twice is harmless.
8. Check: `npx wrangler d1 execute english-coach --remote --command "SELECT level, COUNT(*) FROM lessons WHERE
   course_order IS NOT NULL GROUP BY level"` shows the new totals.
