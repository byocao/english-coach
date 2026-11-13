# Built-in course

The lessons of the live site are not published in this repository. `seed/example/` holds one sample lesson per
level (A1–C1) so you can see the format and start your own course.

- Write your lessons in `seed/live/<LEVEL>.json` (gitignored). Copy `seed/example/` there to start:
  `cp -r seed/example seed/live`. When `seed/live/` exists the scripts use it; otherwise they use the examples.
- `npm run seed:check` validates every lesson (`scripts/check-seed.mjs` lists the rules: sentence count and
  length per level, a Vietnamese translation for every sentence, 6–8 vocabulary items found verbatim in the passage,
  4 questions).
- `npm run db:seed:local` / `npm run db:seed:remote` build `seed/course.sql` (gitignored) and upsert it into D1.
  Lessons are keyed by `slug`, so running it again updates them in place.
- `node scripts/course-index.mjs` lists the lessons per level and category, handy for picking new topics.
