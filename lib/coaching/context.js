const DAY_MS = 24 * 60 * 60 * 1000;

export function recentCutoff(now = new Date()) {
  return new Date(now.getTime() - 14 * DAY_MS);
}

export function partitionRecentHistory(records = [], now = new Date()) {
  const cutoff = recentCutoff(now).getTime();
  return records.reduce((result, record) => {
    const time = new Date(record.occurred_at || record.completed_at || record.created_at || record.date).getTime();
    result[Number.isFinite(time) && time >= cutoff ? "recent" : "older"].push(record);
    return result;
  }, { recent: [], older: [] });
}

export function buildRecentContext(payload, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    windowStart: recentCutoff(now).toISOString(),
    profile: payload.profile || null,
    memories: payload.memories || [],
    activePain: payload.activePain || [],
    workouts: payload.workouts || [],
    workoutSets: payload.workoutSets || [],
    workoutChanges: payload.workoutChanges || [],
    missedWorkouts: payload.missedWorkouts || [],
    activities: payload.activities || [],
    coachMessages: payload.coachMessages || [],
    feedback: payload.feedback || [],
  };
}

export function needsHistoricalRetrieval(message = "") {
  return /\b(last year|months? ago|years? ago|ever|all[- ]time|lifetime|previous block|old programme|used to|when did i|histor(?:y|ical)|compare .* (month|year|block))\b/i.test(message);
}
