function parseRange(repRange) {
  if (Array.isArray(repRange)) return { min: Number(repRange[0]), max: Number(repRange.at(-1)) };
  const values = String(repRange || "").match(/\d+/g)?.map(Number) || [];
  return values.length ? { min: values[0], max: values.at(-1) } : null;
}

export function inferIncrement({ currentWeight, equipmentHistory = [], fallback = 2.5 }) {
  const weights = [...new Set(equipmentHistory.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const positive = weights.slice(1).map((weight, index) => weight - weights[index]).filter((value) => value > 0);
  const increment = positive.length ? Math.min(...positive) : fallback;
  return {
    increment,
    relativeJump: currentWeight > 0 ? increment / currentWeight : 0,
    largeRelativeJump: currentWeight > 0 && increment / currentWeight >= 0.15,
  };
}

function baseResult(overrides = {}) {
  return {
    decision: "hold",
    cue: null,
    reason: "Build performance across the prescribed sets.",
    requiresCoachReview: false,
    nextWeight: null,
    ...overrides,
  };
}

export function evaluateStraightSets(input) {
  const {
    sets = [], repRange, currentWeight = 0, week = 2, previousExposure,
    equipmentHistory = [], repeatedOvershoot = false, restAppropriate = false,
    executionAppropriate = false, consecutiveStalledExposures = 0, pain = false,
  } = input;
  const range = parseRange(repRange);
  if (pain) return baseResult({ decision: "safety_stop", cue: "STOP THIS MOVEMENT", reason: "Pain overrides progression.", requiresCoachReview: true });
  if (!range || !sets.length) return baseResult({ decision: "insufficient_data", reason: "No complete working-set pattern is available." });

  const reps = sets.map((set) => Number(set.reps)).filter(Number.isFinite);
  if (!reps.length) return baseResult({ decision: "insufficient_data", reason: "No valid reps are available." });
  const { increment, largeRelativeJump } = inferIncrement({ currentWeight, equipmentHistory });

  if (week === 1) {
    const first = reps[0];
    if (first <= range.min - 2) return baseResult({ decision: "calibrate_down", cue: "REDUCE NEXT SET", reason: "The first attempt is clearly too heavy for calibration." });
    if (first === range.min - 1) return baseResult({ decision: "calibrate_review", cue: "SLIGHTLY HEAVY", reason: "Retry or make a small reduction while protecting form." });
    if (first >= range.max + 5) return baseResult({ decision: "calibrate_up_large", cue: "INCREASE NEXT SET", reason: "The first attempt materially overshot the range.", requiresCoachReview: largeRelativeJump });
    if (first > range.max) return baseResult({ decision: "calibrate_up", cue: "SLIGHTLY LIGHT", reason: "The first attempt was above the range without requiring an aggressive jump." });
    return baseResult({ decision: "calibrated", cue: "WEIGHT LOOKS RIGHT", reason: "The first attempt is inside the target range." });
  }

  const allAtTop = reps.length === sets.length && reps.every((rep) => rep >= range.max);
  if (allAtTop) {
    if (largeRelativeJump) return baseResult({ decision: "review_large_jump", cue: "COACH CHECK", reason: "Progression is earned, but the available increment is a large relative jump.", requiresCoachReview: true });
    return baseResult({ decision: "progress", cue: "PROGRESS NEXT TIME", reason: "Every prescribed set reached the top of the range.", nextWeight: currentWeight + increment });
  }

  const newlyProgressed = previousExposure?.decision === "progress" || previousExposure?.loadIncreased === true;
  const broadlyAppropriate = reps[0] >= range.min && reps.filter((rep) => rep >= range.min).length >= Math.max(1, reps.length - 1);
  if (newlyProgressed && broadlyAppropriate) return baseResult({ decision: "hold_new_load", cue: "BUILD THE NEW LOAD", reason: "One ordinary first exposure does not reverse an earned progression." });

  const earlyOvershoot = reps.slice(0, -1).some((rep) => rep >= range.max + 2);
  const laterClose = reps.at(-1) >= range.min - 1;
  if (repeatedOvershoot && earlyOvershoot && laterClose) {
    if (!restAppropriate || !executionAppropriate) return baseResult({ decision: "check_execution", cue: "CHECK REST & FORM", reason: "Confirm rest and execution before progressing an uneven set pattern.", requiresCoachReview: true });
    if (largeRelativeJump) return baseResult({ decision: "review_large_jump", cue: "COACH CHECK", reason: "The load appears outgrown, but the available increment is large.", requiresCoachReview: true });
    return baseResult({ decision: "progress_pattern", cue: "PROGRESS NEXT TIME", reason: "Repeated overshoot shows the exercise load has been outgrown.", nextWeight: currentWeight + increment });
  }

  if (consecutiveStalledExposures >= 4) return baseResult({ decision: "plateau_review", cue: `TARGET ${currentWeight} × ${Math.min(range.max, Math.max(...reps) + 1)}`, reason: "The exercise has shown no meaningful progression across roughly four exposures.", requiresCoachReview: true });
  if (consecutiveStalledExposures >= 3) return baseResult({ decision: "plateau_target", cue: `TARGET ${currentWeight} × ${Math.min(range.max, Math.max(...reps) + 1)}`, reason: "Use a specific next-session target before changing the programme." });

  const clearlyUnder = reps.every((rep) => rep < range.min) && reps[0] <= range.min - 2;
  if (clearlyUnder && !newlyProgressed) return baseResult({ decision: "review_down", cue: "COACH CHECK", reason: "The exercise is repeatedly or clearly under range; review the load and context.", requiresCoachReview: true });
  return baseResult();
}

export function evaluateTopBackOff({ tracks = [], ...shared }) {
  return tracks.map((track) => ({ id: track.id, ...evaluateStraightSets({ ...shared, ...track }) }));
}

export function evaluateProgression(input) {
  return input.prescriptionType === "top_backoff" ? evaluateTopBackOff(input) : evaluateStraightSets(input);
}

export function detectPersonalBest(currentSet, history = []) {
  const weight = Number(currentSet.weight);
  const reps = Number(currentSet.reps);
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  const prior = history.filter((set) => Number.isFinite(Number(set.weight)) && Number.isFinite(Number(set.reps)));
  if (!prior.length) return null;
  if (weight > Math.max(...prior.map((set) => Number(set.weight)))) return { type: "weight_pb", label: "Weight PB" };
  const priorAtWeight = prior.filter((set) => Number(set.weight) === weight);
  if (!priorAtWeight.length) return null;
  const bestAtWeight = Math.max(...priorAtWeight.map((set) => Number(set.reps)));
  if (reps > bestAtWeight) return { type: "rep_pb", label: "Rep PB" };
  return null;
}
