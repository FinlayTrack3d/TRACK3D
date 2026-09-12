import { useState } from 'react';
import { normalizeExercise, estimateSession } from '../lib/workout';

export function RichText({ children }) {
  return <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(children ?? '').split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</span>;
}

export function DurationEstimate({ session }) {
  const t = estimateSession(session);
  return <details style={{ fontSize: 12, margin: '10px 0', color: '#B8CCD8' }}><summary>Approx. {t.minutes} minutes · timing breakdown</summary><p>Warm-up {Math.ceil(t.warmup / 60)} min · ramp-up sets {Math.ceil(t.ramp / 60)} min · working sets {Math.ceil(t.working / 60)} min · rest {Math.ceil(t.rest / 60)} min · transitions {Math.ceil(t.transitions / 60)} min. Includes upper-end reps at the prescribed tempo; actual time varies.</p></details>;
}

export function ExerciseEdit({ exercise, onSave, setOnly = false }) {
  const [draft, setDraft] = useState(null), [error, setError] = useState('');
  return <><button className="t3d-btn t3d-btn-sm" style={{ fontSize: 10, padding: '6px 9px' }} aria-label={setOnly ? 'Edit logged set' : `Edit ${exercise.name}`} onClick={() => { setError(''); setDraft({ ...exercise, reps: Array.isArray(exercise.reps) ? exercise.reps.join(' / ') : exercise.reps || '12–15' }); }}>Edit</button>{draft && <div className="workout-edit-overlay"><form className="t3d-card workout-edit-dialog" role="dialog" aria-modal="true" aria-label={setOnly ? 'Edit logged set' : 'Edit exercise'} onSubmit={e => {
    e.preventDefault();
    if (setOnly) {
      if (!String(draft.weight).trim() || !Number.isInteger(Number(draft.reps)) || Number(draft.reps) < 1 || !Number.isFinite(Number(draft.weight)) || Number(draft.weight) < 0) { setError('Enter positive whole reps and a weight of zero or more.'); return; }
      onSave(draft);
    } else {
      if (!draft.name.trim() || !Number.isInteger(Number(draft.sets)) || Number(draft.sets) < 1 || Number(draft.sets) > 10 || !/^\d+([–—-]\d+)?(\s*\/\s*\d+([–—-]\d+)?)*$/.test(String(draft.reps).trim()) || !/^([0-9]+|[Xx])-[0-9]+-([0-9]+|[Xx])-[0-9]+$/.test(draft.tempo || '3-0-1-0')) { setError('Enter a name, 1–10 sets, rep ranges such as 12–15, and tempo such as 3-0-1-0.'); return; }
      onSave(normalizeExercise({ ...draft, name: draft.name.trim(), tempo: draft.tempo || '3-0-1-0' }));
    }
    setDraft(null);
  }}><h3>{setOnly ? 'Edit logged set' : 'Edit exercise'}</h3>{(setOnly ? ['reps', 'weight'] : ['name', 'sets', 'reps', 'tempo']).map((field, i) => <label key={field} style={{ display: 'block', margin: '12px 0' }}>{field === 'reps' && !setOnly ? 'Rep range (or one per set, separated by /)' : field}<input autoFocus={i === 0} className="t3d-input" value={draft[field] ?? ''} onChange={e => setDraft({ ...draft, [field]: e.target.value })} /></label>)}{error && <p role="alert">{error}</p>}<div style={{ display: 'flex', gap: 12 }}><button type="button" className="t3d-btn" onClick={() => setDraft(null)}>Cancel</button><button className="t3d-btn" type="submit">Save</button></div></form></div>}</>;
}
