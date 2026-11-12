-- Placement test result (CEFR level the course starts from) and the chosen Live2D companion.
ALTER TABLE users ADD COLUMN level TEXT;          -- A1..C1, NULL until the placement test or a manual pick
ALTER TABLE users ADD COLUMN placed_at TEXT;      -- when the placement test was last taken
ALTER TABLE users ADD COLUMN placement_score INTEGER;
ALTER TABLE users ADD COLUMN mascot TEXT;         -- wanko | tororo | hijiki | hiyori | haru
