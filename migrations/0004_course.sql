-- Built-in course: lessons seeded from seed/lessons/*.json carry a slug, a topic category
-- and their position in the course. Lessons written by users keep course_order NULL.
ALTER TABLE lessons ADD COLUMN slug TEXT;
ALTER TABLE lessons ADD COLUMN category TEXT;
ALTER TABLE lessons ADD COLUMN course_order INTEGER;
CREATE UNIQUE INDEX lessons_slug ON lessons(slug);
CREATE INDEX lessons_course ON lessons(course_order);
