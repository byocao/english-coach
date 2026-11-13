-- Hiyori and Haru are no longer companions (Kitsu the fox replaces them); their fans go back to Wanko.
UPDATE users SET mascot = 'wanko' WHERE mascot IN ('hiyori', 'haru');
