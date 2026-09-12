export function repRange(value) {
  const n = String(value ?? '12–15').match(/\d+/g)?.map(Number) || [12, 15];
  const high = Math.max(1, n[1] ?? n[0]);
  return [Math.max(1, Math.min(n[0], n.length === 1 ? high - 3 : high)), high];
}
export function targetFor(ex, i = 0) {
  const ranges = Array.isArray(ex.reps) ? ex.reps : String(ex.reps || '12–15').split('/');
  return repRange(ranges[Math.min(i, ranges.length - 1)]).join('–');
}
export function normalizeExercise(ex) {
  const sets = Math.max(1, Math.min(10, Number(ex.sets) || 3));
  return { ...ex, sets, reps: Array.from({ length: sets }, (_, i) => targetFor(ex, i)) };
}
export function estimateSession(session) {
  let working = 0, rest = 0, ramp = 0;
  const exercises = session.exercises || [];
  exercises.forEach(ex => {
    const tempo = String(ex.tempo || '3-0-1-0').split('-').reduce((a, n) => a + (/x/i.test(n) ? 1 : Number(n) || 0), 0) || 4;
    const sets = Number(ex.sets) || 3;
    for (let i = 0; i < sets; i++) working += repRange(targetFor(ex, i))[1] * tempo;
    rest += Math.max(0, sets - 1) * Math.max(60, Number(ex.rest_seconds) || 120);
    ramp += Math.max(1, Number(ex.warmup_sets) || 2) * (8 * tempo + 60);
  });
  const warmup = Math.max(5, Number(session.warmup_minutes) || 5) * 60;
  const transitions = Math.max(0, exercises.length - 1) * 90;
  return { minutes: Math.ceil((working + rest + ramp + warmup + transitions) / 60), working, rest, ramp, warmup, transitions };
}

// Enforce clear user-supplied budgets independently of the model's budget field.
export function requestedBudget(text, days = []) {
  const source = String(text || '').toLowerCase().replace(/\b(?:one|an?)\s+hour\b/g, '1 hour');
  const duration = value => {
    const match = value.match(/(\d+(?:\.\d+)?)(?:\s*[–—-]\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|m)?/);
    if (!match) return null;
    let minutes = Number(match[2] || match[1]) * (/^h/.test(match[3] || '') ? 60 : 1);
    if (/^h/.test(match[3] || '') && !match[2]) {
      const extra = value.slice(match.index + match[0].length).match(/^\s*(\d+)\s*(?:minutes?|mins?|m)\b/);
      if (extra) minutes += Number(extra[1]);
    }
    return minutes > 0 ? minutes : null;
  };
  const matches = [...source.matchAll(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/g)];
  if (!matches.length) return duration(source);
  const budgets = matches.flatMap((match, i) => {
    if (!days.some(day => day.toLowerCase().slice(0, 3) === match[0].slice(0, 3))) return [];
    const budget = duration(source.slice(match.index + match[0].length, matches[i + 1]?.index));
    return budget ? [budget] : [];
  });
  return budgets.length ? Math.min(...budgets) : null;
}
export function equivalentWorkout(history, session, started) {
  return history.find(log => log.session_name?.toLowerCase() === session?.name?.toLowerCase() && new Date(log.created_at).getTime() < started) || null;
}
export function workoutReview(session, completed, previous) {
  return (session?.exercises || []).map((ex, index) => {
    const sets = completed[index] || [], prescribed = sets.slice(0, Number(ex.sets));
    const achieved = prescribed.filter((set, i) => { const [low, high] = repRange(targetFor(ex, i)); return Number(set.reps) >= low && Number(set.reps) <= high; }).length;
    const top = prescribed.length === Number(ex.sets) && prescribed.every((set, i) => Number(set.reps) >= repRange(targetFor(ex, i))[1]);
    const last = previous?.exercises?.find(item => item.name?.toLowerCase() === ex.name?.toLowerCase());
    const improvements = sets.filter((set, i) => last?.sets?.[i] && (Number(set.weight) > Number(last.sets[i].weight) || Number(set.reps) > Number(last.sets[i].reps))).length;
    return { name: ex.name, achieved, logged: prescribed.length, prescribed: Number(ex.sets), extra: Math.max(0, sets.length - Number(ex.sets)), improvements,
      advice: !prescribed.length ? 'Not attempted. Plan time for this exercise next session.' : top ? 'Top of every range reached. If form felt good, try the next available weight and start near the lower end.' : prescribed.length < Number(ex.sets) ? 'Some prescribed sets remain. Review time, rest and fatigue next session.' : 'Build towards the top of each range with controlled form before increasing weight.' };
  });
}
