-- Nutrition setup answers (weight, height, age, sex, activity, goal, meals
-- per day, wake-up time and the AI questions including allergies), so Edit
-- Plan starts from what the user entered and allergies reach every meal
-- builder. The app still saves a plan if this has not been run, but then
-- the answers are not kept. Safe to run more than once.
alter table public.nutrition_plans add column if not exists setup jsonb;
notify pgrst, 'reload schema';
