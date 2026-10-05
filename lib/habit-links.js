// Morning routine tasks and habits that are the same thing, so finishing
// the task in the morning ticks the habit too (for example "Stretch /
// Mobility" and "Stretch or move").
const LINKS = [
  /stretch|mobility|yoga/i,
  /\bwalk/i,
  /\bread(ing)?\b/i,
  /meditat/i,
  /\bwater\b|hydrat/i,
  /supplement|vitamin/i,
  /journal/i,
];

// The ids of today's habits not done yet that a finished morning task covers.
export function linkedHabitIds(taskName, habits = []) {
  const link = LINKS.find(pattern => pattern.test(String(taskName || "")));
  if (!link) return [];
  return (habits || []).filter(habit => !habit.done && link.test(String(habit.name || ""))).map(habit => habit.id);
}
