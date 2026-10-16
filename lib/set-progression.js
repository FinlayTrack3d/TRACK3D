// Playbook V1.3 set-by-set progression.
//
// Every set has its own rep range and its own weight. Sets are staggered,
// heaviest first (a top set, then lighter back-off sets), except beginners on
// straight sets, where every set has the same range and the same weight.
// Each set is judged against its own range with the Rep-Range Result Table
// (Rule 22a); weight steps come from the user's gym (Rule 20); warm-up sets
// are left out (Rule 16); a form rating of 1-3 holds the weight (Rule 29); and
// the second session of a brand-new exercise is put in order, heaviest first
// (Rule 10a).

// The weight steps a gym's equipment goes up in, in kg. A user's own steps
// (profile) replace these.
export const DEFAULT_GYM_STEPS = { dumbbell: 2.5, barbell: 2.5, machine: 5, cable: 5, kettlebell: 4, other: 2.5 };

export const EQUIPMENT_LABELS = {
  dumbbell: "Dumbbells",
  barbell: "Barbell (total, both sides)",
  machine: "Machines",
  cable: "Cables",
  kettlebell: "Kettlebells",
};

// The kind of equipment an exercise uses, from its name.
export function equipmentOf(name = "") {
  const text = String(name).toLowerCase();
  if (/\bkettlebell|\bkb\b/.test(text)) return "kettlebell";
  if (/dumbbell|\bdb\b|goblet/.test(text)) return "dumbbell";
  if (/cable|pulldown|pull-down|pushdown|push-down|face pull|crossover/.test(text)) return "cable";
  if (/machine|leg press|leg curl|leg extension|pec deck|hack squat|seated row machine|chest press|shoulder press machine|calf raise machine|smith/.test(text)) return "machine";
  if (/barbell|\bbb\b|ez[- ]?bar|trap bar|deadlift|back squat|front squat|bench press|overhead press|military press|hip thrust|good morning|\bsquat\b/.test(text)) return "barbell";
  if (/push-?up|pull-?up|chin-?up|\bdips?\b|plank|bodyweight|sit-?up|crunch|burpee|lunge walk/.test(text)) return "bodyweight";
  return "other";
}

// The gym's step for an exercise. gymSteps is the user's saved steps.
export function stepFor(name, gymSteps = null) {
  const equipment = equipmentOf(name);
  if (equipment === "bodyweight") return 2.5;
  const saved = Number(gymSteps?.[equipment]);
  return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_GYM_STEPS[equipment] || DEFAULT_GYM_STEPS.other;
}

const round2 = value => Math.round(value * 100) / 100;

// A weight on the gym's steps: nearest, or the step at or below / above.
export function snapWeight(weight, step, mode = "nearest") {
  const value = Number(weight);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const size = Number(step) > 0 ? Number(step) : 2.5;
  const ratio = value / size;
  const steps = mode === "down" ? Math.floor(ratio + 1e-9) : mode === "up" ? Math.ceil(ratio - 1e-9) : Math.round(ratio);
  return round2(Math.max(0, steps * size));
}

// "8-12" / "8–12" / "10" / ["8","12"] -> { min, max }. A single number is a
// fixed target (min = max).
export function parseRange(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Number.isFinite(Number(value.min))) {
    return { min: Number(value.min), max: Number(value.max ?? value.min) };
  }
  const numbers = (Array.isArray(value) ? value.join("-") : String(value ?? "")).match(/\d+/g)?.map(Number) || [];
  if (!numbers.length) return null;
  const min = Math.min(numbers[0], numbers.at(-1));
  const max = Math.max(numbers[0], numbers.at(-1));
  return { min, max };
}

export const rangeText = range => (range ? (range.min === range.max ? String(range.max) : `${range.min}–${range.max}`) : "");

// A rep range a person typed is usable: two whole numbers, min below max,
// both between 1 and 30.
export function rangeProblem(text) {
  const numbers = String(text ?? "").match(/\d+/g)?.map(Number) || [];
  if (numbers.length !== 2) return "Enter a range like 8-12.";
  const [min, max] = numbers;
  if (min < 1 || max > 30) return "Reps must be between 1 and 30.";
  if (min >= max) return "The first number must be lower than the second.";
  return "";
}

// Logged sets that count: warm-ups are left out.
export const workingSets = (sets = []) => (Array.isArray(sets) ? sets : []).filter(set => set && !set.warmup);

const numberOf = value => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Estimated one-rep max (Epley) and the reps a weight should allow.
export const e1rm = (weight, reps) => weight * (1 + reps / 30);
export const repsAt = (oneRepMax, weight) => (weight > 0 ? Math.floor(30 * (oneRepMax / weight - 1) + 1e-9) : 0);

// Where a set's reps landed against its range (the Rep-Range Result Table).
export function resultOf(reps, range) {
  if (!range || reps === null) return null;
  if (reps >= range.max + 3) return "way_over";
  if (reps >= range.max + 1) return "over";
  if (reps === range.max) return "top";
  if (reps >= range.min) return "in_range";
  if (reps === range.min - 1) return "just_under";
  if (reps >= range.min - 3) return "under";
  return "way_under";
}

// Labels for a logged set against its range (workout screen, summary, history).
export function setStatus(reps, rangeValue) {
  const range = parseRange(rangeValue);
  const count = numberOf(reps);
  const result = resultOf(count, range);
  if (!result) return { tone: "neutral", label: "" };
  if (["just_under", "under", "way_under"].includes(result)) return { tone: "under", label: `below ${rangeText(range)}` };
  if (result === "in_range") return { tone: "in", label: "in range" };
  return { tone: "top", label: "Top ✓" };
}

// The cue straight after a set is logged ("During the workout" column).
// delta: the change to suggest for the next set, in steps.
export function inSessionCue(reps, rangeValue, { week = 2 } = {}) {
  const range = parseRange(rangeValue);
  const result = resultOf(numberOf(reps), range);
  if (!result) return null;
  switch (result) {
    case "way_over": return { delta: 1, text: "Too light — go up a step for the next set." };
    case "over": return { delta: 0, text: "Bit light — keep the weight." };
    case "top": return { delta: 0, text: "Top of range ✓" };
    case "in_range": return { delta: 0, text: "In range ✓" };
    case "just_under": return { delta: 0, text: "Just under — keep the weight." };
    case "under": return { delta: -1, text: "Heavy — drop a step for the next set." };
    case "way_under": return { delta: week === 1 ? -2 : -1, text: week === 1 ? "Too heavy — drop two steps for the next set." : "Too heavy — drop a step for the next set." };
    default: return null;
  }
}

// Next session for one set from the last time it was done (Rule 22a).
// last / previous: this set last time and the time before ({ weight, reps,
// formRating }). daysSince: days since last time. Returns { weight, reps,
// result, reason }.
export function nextForSet({ range, last, previous = null, step = 2.5, daysSince = 0 }) {
  const weight = numberOf(last?.weight);
  const reps = numberOf(last?.reps);
  if (!range || weight === null || reps === null) return null;
  const result = resultOf(reps, range);
  const rating = numberOf(last?.formRating);
  const lowForm = rating !== null && rating < 4;
  const bodyweight = weight === 0;
  const up = steps => (bodyweight ? 0 : snapWeight(weight + steps * step, step));
  const down = steps => (bodyweight ? 0 : Math.max(step, snapWeight(weight - steps * step, step)));
  const aimUp = Math.min(range.max, Math.max(range.min, reps + 1));
  const longGap = daysSince > 14;
  const prevWeight = numberOf(previous?.weight);
  const prevReps = numberOf(previous?.reps);
  const firstAfterIncrease = prevWeight !== null && prevWeight < weight;
  const missedLastTimeToo = prevWeight === weight && prevReps !== null && prevReps < range.min;

  if (bodyweight && ["way_over", "over", "top"].includes(result)) {
    return { weight: 0, reps: range.max, result, reason: "top of the range: add weight or a harder version when you're ready" };
  }
  switch (result) {
    case "way_over":
      return lowForm
        ? { weight: up(1), reps: range.min, result, reason: "well over the range, but form was rated below 4, so one step only" }
        : { weight: up(2), reps: range.min, result, reason: "well over the range, so two steps up" };
    case "over":
    case "top":
      return lowForm
        ? { weight, reps: range.max, result, reason: "top of the range, but form was rated below 4: same weight, cleaner reps", formFocus: true }
        : { weight: up(1), reps: range.min, result, reason: "top of the range, so one step up" };
    case "in_range":
      return { weight, reps: aimUp, result, reason: "in range: same weight, one more rep" };
    case "just_under":
      if (missedLastTimeToo && !longGap) return { weight: down(1), reps: range.min, result, reason: "just under the range two sessions running, so one step down" };
      return { weight, reps: range.min, result, reason: "just under the range: same weight" };
    case "under":
      if (firstAfterIncrease || longGap) return { weight, reps: range.min, result, reason: firstAfterIncrease ? "first session at a new weight: hold it once" : "a long gap: same weight" };
      return { weight: down(1), reps: range.min, result, reason: "under the range, so one step down" };
    case "way_under":
      return { weight: down(1), reps: range.min, result, reason: "well under the range, so one step down" };
    default:
      return null;
  }
}

// Session 2 of a brand-new exercise (Rule 10a): session 1's working weights,
// heaviest first, one per set, with reps predicted from the best set. For
// straight sets (every range the same), one weight: the heaviest at which
// every set reached the bottom of the range.
export function reorderAfterFirstSession({ sets = [], ranges = [], step = 2.5 }) {
  const parsed = ranges.map(parseRange);
  const count = parsed.length;
  if (!count || parsed.some(range => !range)) return null;
  const logged = workingSets(sets)
    .map(set => ({ weight: numberOf(set.weight), reps: numberOf(set.reps) }))
    .filter(set => set.weight !== null && set.weight > 0 && set.reps !== null);
  if (!logged.length) return null;
  const weights = [...new Set(logged.map(set => set.weight))];
  if (weights.length === 1) return null; // one weight throughout: the normal table applies
  const straight = parsed.every(range => range.min === parsed[0].min && range.max === parsed[0].max);
  const best = Math.max(...logged.map(set => e1rm(set.weight, set.reps)));
  if (straight) {
    const range = parsed[0];
    const usable = logged.filter(set => set.reps >= range.min).map(set => set.weight);
    const weight = usable.length ? Math.max(...usable) : Math.min(...logged.map(set => set.weight));
    const bestHere = Math.max(...logged.filter(set => set.weight === weight).map(set => set.reps));
    const reps = Math.min(range.max, Math.max(range.min, bestHere + 1));
    return parsed.map(() => ({ weight, reps }));
  }
  const usable = logged.filter(set => set.reps >= parsed[0].min - 3);
  const sorted = [...new Set((usable.length ? usable : logged).map(set => set.weight))].sort((a, b) => b - a);
  const plan = [];
  for (let index = 0; index < count; index++) {
    const range = parsed[index];
    let weight = sorted[index] ?? snapWeight((plan[index - 1]?.weight ?? sorted.at(-1)) - step, step, "down");
    let reps = repsAt(best, weight);
    if (reps >= range.max + 2) { weight = snapWeight(weight + step, step); reps = range.min; }
    else if (reps < range.min) { weight = Math.max(step, snapWeight(weight - step, step, "down")); reps = range.min; }
    else reps = Math.min(range.max, reps);
    if (index > 0 && weight > plan[index - 1].weight) { weight = plan[index - 1].weight; reps = Math.min(range.max, Math.max(range.min, repsAt(best, weight))); }
    plan.push({ weight, reps });
  }
  return plan;
}

// Next session's plan for every set of an exercise. exposures: earlier
// sessions of this exercise, newest first ({ sets, date }); todayKey for the
// gap since last time.
export function planExercise({ ranges = [], exposures = [], step = 2.5, todayKey = null }) {
  const parsed = ranges.map(parseRange);
  const last = exposures[0];
  const lastSets = workingSets(last?.sets);
  if (!last || !lastSets.length) return null;
  const daysSince = todayKey && last.date ? Math.max(0, Math.round((Date.parse(todayKey) - Date.parse(last.date)) / 86400000)) : 0;

  if (exposures.length === 1) {
    const reordered = reorderAfterFirstSession({ sets: lastSets, ranges, step });
    if (reordered) return reordered.map(item => ({ ...item, reason: "first session put in order: heaviest first", reordered: true }));
  }

  const previousSets = workingSets(exposures[1]?.sets);
  const straight = parsed.length > 1 && parsed.every(range => range && range.min === parsed[0].min && range.max === parsed[0].max);
  const perSet = parsed.map((range, index) => {
    const lastSet = lastSets[index] || null;
    if (!lastSet) return null;
    return nextForSet({ range, last: lastSet, previous: previousSets[index] || null, step, daysSince });
  });

  if (straight) {
    // Straight sets (beginners): one weight for every set. Up only when every
    // set earned it; down when set 1 says so; otherwise hold and add reps.
    const range = parsed[0];
    const weight = numberOf(lastSets[0]?.weight);
    const done = perSet.filter(Boolean);
    if (weight === null || !done.length) return null;
    const allUp = done.length >= parsed.length && done.every(item => item.weight > weight);
    const firstDown = perSet[0] && perSet[0].weight < weight;
    const nextWeight = allUp ? Math.min(...done.map(item => item.weight)) : firstDown ? perSet[0].weight : weight;
    return parsed.map((_, index) => {
      const lastSet = lastSets[index];
      const reps = nextWeight !== weight || !lastSet ? range.min : Math.min(range.max, Math.max(range.min, Number(lastSet.reps) + 1));
      const reason = allUp ? "every set reached the top, so one step up" : firstDown ? perSet[0].reason : "same weight until every set reaches the top";
      return { weight: nextWeight, reps, reason };
    });
  }

  // Staggered sets after a session at one weight (a beginner who has just
  // switched, Rule 70a, or sets all done at one weight): set 1 follows its
  // own result; the back-off sets are about 7.5% and 12.5% lighter.
  const lastWeights = lastSets.slice(0, parsed.length).map(set => numberOf(set.weight));
  const oneWeight = lastWeights.length >= 2 && lastWeights.every(weight => weight !== null && weight > 0 && weight === lastWeights[0]);
  if (oneWeight && perSet[0]) {
    const top = perSet[0].weight;
    const best = Math.max(...lastSets.map(set => e1rm(Number(set.weight), Number(set.reps))));
    const drops = [0, 0.075, 0.125];
    const plan = [];
    parsed.forEach((range, index) => {
      if (index === 0) { plan.push({ ...perSet[0], reason: `${perSet[0].reason}; later sets lighter` }); return; }
      const drop = drops[Math.min(index, drops.length - 1)] + Math.max(0, index - 2) * 0.05;
      const weight = Math.min(plan[index - 1].weight, Math.max(step, snapWeight(top * (1 - drop), step)));
      const reps = Math.min(range.max, Math.max(range.min, repsAt(best, weight)));
      plan.push({ weight, reps, reason: "a lighter back-off set" });
    });
    return plan;
  }

  // Staggered: each set on its own, then keep the shape (a later set is
  // never heavier than an earlier one).
  const plan = [];
  parsed.forEach((range, index) => {
    let item = perSet[index];
    if (!item) {
      const before = plan[index - 1];
      item = before ? { weight: before.weight, reps: range?.min ?? before.reps, reason: "follows the set before" } : null;
    }
    if (item && index > 0 && plan[index - 1] && item.weight > plan[index - 1].weight) {
      item = { ...item, weight: plan[index - 1].weight, reason: `${item.reason}; capped at set ${index}'s weight` };
    }
    plan.push(item);
  });
  return plan;
}

// The set logger's suggestion for one set today: { weight, reps, note }.
// plan: planExercise's result (or null); todaySets: this exercise's sets
// logged so far today (warm-ups included); chosenWeight: a weight typed now.
export function suggestSet({ ranges = [], setIndex = 0, plan = null, todaySets = [], step = 2.5, chosenWeight = null, week = 2 }) {
  const range = parseRange(ranges[Math.min(setIndex, ranges.length - 1)]);
  const done = workingSets(todaySets);
  const kg = value => `${round2(value)} kg`;
  const planned = plan?.[setIndex] || null;
  const chosen = numberOf(chosenWeight);

  if (chosen !== null) {
    const reference = done.at(-1) || null;
    let reps = range ? range.min : null;
    if (range && planned?.weight > 0 && planned.reps) reps = Math.min(range.max, Math.max(range.min, repsAt(e1rm(planned.weight, planned.reps), chosen)));
    else if (range && reference && Number(reference.weight) > 0) reps = Math.min(range.max, Math.max(range.min, repsAt(e1rm(Number(reference.weight), Number(reference.reps)), chosen)));
    return { weight: String(chosen), reps: reps === null ? "" : String(reps), note: reps === null ? "" : `At ${kg(chosen)}, aim for ${reps}.` };
  }

  // Today's sets come first: the next set follows the weight actually used,
  // moved by the cue from the set just done, and never above it.
  const previousToday = done.at(-1) || null;
  if (previousToday && numberOf(previousToday.weight) !== null) {
    const used = Number(previousToday.weight);
    const previousRange = parseRange(ranges[Math.min(done.length - 1, ranges.length - 1)]);
    const cue = inSessionCue(previousToday.reps, previousRange, { week });
    const plannedBefore = plan?.[done.length - 1] || null;
    // The planned drop between sets (staggered), moved by what was really used.
    const shift = plannedBefore && planned ? used - plannedBefore.weight : 0;
    let weight = planned ? planned.weight + shift : used;
    if (!planned && range && previousRange && range.min > previousRange.max && used > 0) {
      // A lighter, higher-rep back-off set with no history: from today's set.
      weight = snapWeight(e1rm(used, Number(previousToday.reps)) / (1 + range.min / 30), step, "down");
    }
    if (cue?.delta) weight += cue.delta * step;
    weight = used === 0 ? 0 : Math.min(used, Math.max(step, snapWeight(weight, step)));
    const estimate = used > 0 ? e1rm(used, Number(previousToday.reps)) : null;
    let reps = range ? range.min : null;
    const predicted = range && estimate ? Math.min(range.max, Math.max(range.min, repsAt(estimate, weight))) : null;
    // At the planned weight, aim for the plan, or more if today's set at
    // that weight shows it (up to what was just done).
    if (range && planned && weight === planned.weight) reps = Math.max(planned.reps, predicted !== null && weight === used ? Math.min(predicted, Number(previousToday.reps)) : planned.reps);
    else if (predicted !== null) reps = predicted;
    // Sets never go above the one before (heaviest first), so "go up a
    // step" can't apply to the next set: the weight goes up next time.
    const cappedUp = cue?.delta > 0 && weight <= used;
    const lead = cue && cue.delta ? `${cappedUp ? "Too light — this goes up next time." : cue.text} ` : "";
    return { weight: String(weight), reps: reps === null ? "" : String(reps), note: `${lead}${weight === used ? `Stay at ${kg(weight)}` : `${kg(weight)} for this set`}${reps ? `, aim for ${reps}.` : "."}` };
  }

  if (planned) {
    const note = planned.reordered && setIndex === 0
      ? `Last time you built up through your sets. This time start heavy and work down: ${(plan || []).map(item => round2(item.weight)).join(" → ")} kg. Aim for ${planned.reps}.`
      : `${planned.reason ? `${planned.reason[0].toUpperCase()}${planned.reason.slice(1)}: ` : ""}${planned.weight > 0 ? kg(planned.weight) : "bodyweight"}, aim for ${planned.reps}.`;
    return { weight: String(planned.weight), reps: String(planned.reps), note, formFocus: Boolean(planned.formFocus) };
  }

  if (range) return { weight: "", reps: String(range.min), note: `No history yet: pick a weight you can lift for ${rangeText(range)} reps with good form.` };
  return { weight: "", reps: "", note: "" };
}

// Whether to ask for a form rating after a working set (Rule 29): the set
// reached the top of its range, not in week 1, at most once per exercise per
// week (unless last time's rating was below 4) and twice per workout.
export function shouldAskFormRating({ reps, range, week = 2, warmup = false, askedThisWorkout = 0, lastAskedDaysAgo = null, lastRating = null }) {
  if (warmup || week === 1) return false;
  const parsed = parseRange(range);
  const count = numberOf(reps);
  if (!parsed || count === null || count < parsed.max) return false;
  if (askedThisWorkout >= 2) return false;
  if (lastRating !== null && lastRating < 4) return true;
  return lastAskedDaysAgo === null || lastAskedDaysAgo >= 7;
}

// Default rep ranges for an exercise (Rule 11a): staggered for intermediate
// and advanced, straight for beginners. kind: "compound" | "isolation".
export function defaultRanges(sets = 3, { kind = "compound", straight = false } = {}) {
  const count = Math.max(1, Math.min(10, Math.round(Number(sets)) || 3));
  if (straight) return Array(count).fill(kind === "isolation" ? "10-15" : "8-10");
  const pattern = kind === "isolation" ? ["10-12", "12-15", "12-15"] : ["6-8", "8-10", "10-12"];
  return Array.from({ length: count }, (_, index) => pattern[Math.min(index, pattern.length - 1)]);
}

const ISOLATION = /curl|raise|fly|flye|extension|pushdown|push-down|kickback|calf|shrug|crunch|face pull|pec deck|abduct|adduct|leg curl|wrist/i;
export const exerciseKind = name => (ISOLATION.test(String(name || "")) ? "isolation" : "compound");

// A plan's single rep targets ("10") become ranges, using the default for
// the exercise type and the user's set structure.
export function withRanges(exercise = {}, { straight = false } = {}) {
  const sets = Math.max(1, Math.min(10, Number(exercise.sets) || 3));
  const reps = Array.isArray(exercise.reps) ? exercise.reps : [exercise.reps];
  // Timed or open targets (30s, AMRAP, 10 each side) are left as they are.
  if (reps.some(value => /[a-z]/i.test(String(value ?? "")))) return exercise;
  const usable = reps.map(value => parseRange(value)).filter(Boolean);
  if (usable.length && usable.every(range => range.min < range.max)) {
    return { ...exercise, sets, reps: Array.from({ length: sets }, (_, index) => rangeText(usable[Math.min(index, usable.length - 1)]).replace("–", "-")) };
  }
  return { ...exercise, sets, reps: defaultRanges(sets, { kind: exerciseKind(exercise.name), straight }) };
}

const BODYWEIGHT = /push-?up|pull-?up|chin-?up|\bdips?\b|plank|bodyweight|inverted row|burpee/i;

// The coach check on a plan the user wrote themselves (playbook V1.3): every
// set has its own rep range, staggered (heaviest set first, then lighter
// sets for more reps) or, for beginners, straight (one weight, one range).
// Suggests the default ranges where a set has a single number, where a
// staggered plan has the same range on every set, or where a straight plan
// has different ranges. Timed or open targets and bodyweight moves are left
// as they are. Returns { sessions (with the suggestions), changes }.
export function planRangeReview(sessions = [], { straight = false } = {}) {
  const changes = [];
  const reviewed = (sessions || []).map(session => ({
    ...session,
    exercises: (session.exercises || []).map(exercise => {
      const raw = Array.isArray(exercise.reps) ? exercise.reps : String(exercise.reps ?? "").split(/[/,]/);
      if (raw.some(value => /[a-z]/i.test(String(value ?? "")))) return exercise;
      const sets = Math.max(1, Math.min(10, Math.round(Number(exercise.sets)) || raw.length || 3));
      const current = Array.from({ length: sets }, (_, index) => String(raw[Math.min(index, raw.length - 1)] ?? "").replace(/[–—]/g, "-").replace(/\s+/g, ""));
      const ranges = current.map(parseRange);
      const singleNumbers = ranges.some(range => !range || range.min >= range.max);
      const allSame = current.every(value => value === current[0]);
      const bodyweight = BODYWEIGHT.test(String(exercise.name || ""));
      const needsChange = singleNumbers || (!bodyweight && sets > 1 && (straight ? !allSame : allSame));
      if (!needsChange) return exercise;
      const suggested = defaultRanges(sets, { kind: exerciseKind(exercise.name), straight: straight || bodyweight });
      if (suggested.every((value, index) => value === current[index])) return exercise;
      changes.push({ session: session.name, exercise: exercise.name, from: current, to: suggested });
      return { ...exercise, sets, reps: suggested };
    }),
  }));
  return { sessions: reviewed, changes };
}
