// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-coach-review.cjs <scenario>   (all remote services are mocked)
// Browser checks for the AI coach review (sections F-J). Scenarios:
//  nutritionhistory, roundup, roundupfail, weeklysavefail, painresolve, coachstyle, setuplevel,
//  loadwrites, offplancap, offplanmacros, planwarning, setprefill, nextupmorning, nextupworkout,
//  nextupslow, nextupmorningslow, newdash,
//  profilelive, profileexperience, restday, targetsuggest, targetkeep, logextra, logextradash, editordraft,
//  weeklyplanstart, habitlink, activitylog, activitynextup, persistlogin, smallfixes,
//  fitnesslastweek, fitnessmissed, repsplit, mealswap, mealswapdash,
//  stalework, weeklystale, exercisealias, weekcount,
//  nutritionorder, dashlog, libraryedit, restdaybuild, restdayai, weeklybadge, fitnessrest, headerprofile,
//  profiletodo, profiletodofail, profileprefill, profilepartial,
//  planchangebutton, nutritionedit, nutritionnocolumn, nutritionlegacy, nutritionai,
//  reviewskip, dashexcludes, changeplanhint, planmarkdown, streamchat, streamcoach, streamerror, longname
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'roundup';
const shiftKey = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const londonKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
(async () => {
  if (scenario === 'persistlogin') {
    // Signed in once, the browser closed and opened again: still signed in.
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track3d-login-'));
    const loginUser = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const loginToken = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: loginUser.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400, aud: 'authenticated' }) + '.t';
    const open = async () => {
      const ctx = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 390, height: 844 } });
      await ctx.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.hostname === 'localhost') return url.pathname.startsWith('/api/') ? route.fulfill({ json: { content: [{ text: 'OK.' }] } }) : route.continue();
        if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: loginUser });
        if (!url.pathname.includes('/rest/v1/')) return route.fulfill({ json: [] });
        if (url.pathname.endsWith('/user_profiles')) return route.fulfill({ json: [{ user_id: loginUser.id, health_consent_at: '2026-10-06T08:00:00.000Z', health_consent_version: '2026-10-06' }] });
        return route.fulfill({ json: req.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
      });
      return ctx;
    };
    let ctx = await open();
    let tab = await ctx.newPage();
    await tab.goto('http://localhost:3123/login');
    await tab.evaluate(({ loginUser, loginToken }) => localStorage.setItem('track3d-auth', JSON.stringify({ access_token: loginToken, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user: loginUser })), { loginUser, loginToken });
    await tab.goto('http://localhost:3123/app');
    await tab.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await ctx.close();
    ctx = await open();
    tab = await ctx.newPage();
    await tab.goto('http://localhost:3123/app');
    await tab.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    assert.equal(new URL(tab.url()).pathname, '/app', 'still signed in after the browser was closed');
    // Signed in for 7 days from signing in, then signed out.
    const DAY = 24 * 60 * 60 * 1000;
    const signedIn = async (window) => {
      await tab.evaluate(value => localStorage.setItem('track3d-login-window', JSON.stringify(value)), window);
      await tab.goto('http://localhost:3123/app');
    };
    await signedIn({ userId: loginUser.id, startedAt: Date.now() - 6 * DAY, expiresAt: Date.now() + DAY });
    await tab.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    assert.equal(new URL(tab.url()).pathname, '/app', 'still signed in after 6 days');
    // Signed in 4 hours ago under the 3-hour rule: 7 days from that sign-in.
    await signedIn({ userId: loginUser.id, expiresAt: Date.now() - 60 * 60 * 1000 });
    await tab.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    assert.equal(new URL(tab.url()).pathname, '/app', 'a device signed in under the 3-hour rule gets 7 days');
    // The window ends while the app is open: signed out then.
    await signedIn({ userId: loginUser.id, startedAt: Date.now() - 7 * DAY + 12000 });
    await tab.getByText('DAILY SCORE').waitFor({ timeout: 10000 });
    await tab.waitForURL('**/login', { timeout: 30000 });
    // Signed in 8 days ago (with the sign-in session still saved): straight to the sign-in page.
    await tab.evaluate(auth => localStorage.setItem('track3d-auth', auth), JSON.stringify({ access_token: loginToken, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user: loginUser }));
    await signedIn({ userId: loginUser.id, startedAt: Date.now() - 8 * DAY, expiresAt: Date.now() - DAY });
    await tab.waitForURL('**/login', { timeout: 20000 });
    assert.equal(await tab.evaluate(() => localStorage.getItem('track3d-login-window')), null, 'the ended window is cleared');
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('PASS persistlogin');
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400, aud: 'authenticated' }) + '.t';
  if (scenario === 'loadwrites') {
    await context.addInitScript(({ user }) => {
      localStorage.setItem(`track3d-session-drafts:${user.id}:fitness`, JSON.stringify({ version: 1, userId: user.id, updatedAt: Date.now(), expiresAt: null, data: {
        activeSession: { name: 'Upper A', exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], gymContext: { type: 'usual', name: '' }, trainingSessionId: null },
        exerciseIdx: 0, setProgress: { 0: 1 }, completedSets: { 0: [{ weight: '80', reps: '9', setNum: 1 }] }, currentInputs: {}, workoutStart: Date.now() - 600000,
        restTimerEnabled: false, restSeconds: 90, restActive: false, restDeadline: null, activeWorkoutLogId: 43,
      } }));
    }, { user });
  }
  if (scenario === 'restday') {
    await context.addInitScript(() => {
      window.__clipboardWrites = 0;
      const count = () => { window.__clipboardWrites += 1; };
      if (navigator.clipboard) {
        const writeText = navigator.clipboard.writeText?.bind(navigator.clipboard);
        const write = navigator.clipboard.write?.bind(navigator.clipboard);
        navigator.clipboard.writeText = (...args) => { count(); return writeText ? writeText(...args) : Promise.resolve(); };
        navigator.clipboard.write = (...args) => { count(); return write ? write(...args) : Promise.resolve(); };
      }
      const execCommand = document.execCommand.bind(document);
      document.execCommand = (command, ...rest) => { if (/copy|cut/i.test(command)) count(); return execCommand(command, ...rest); };
      document.addEventListener('copy', count, true);
    });
  }
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user }));
  }, { user, token });
  // Next up depends on the time of day: fix the clock at a London hour today.
  const atLondonHour = hour => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
    for (let utc = 0; utc < 24; utc++) {
      const candidate = new Date(`${day}T${String(utc).padStart(2, '0')}:00:00Z`);
      if (Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(candidate)) === hour) return candidate;
    }
    throw new Error('no such hour');
  };
  if (['nextupmorning', 'nextupmorningslow'].includes(scenario)) await context.clock.setFixedTime(atLondonHour(9));
  if (['nextupworkout', 'nextupslow'].includes(scenario)) await context.clock.setFixedTime(atLondonHour(13));
  if (scenario === 'newdash') await context.clock.setFixedTime(atLondonHour(10));
  // Scenarios about a given weekday run at midday London time on a fixed date
  // (2026-10-07 is a Wednesday, 2026-10-12 a Monday).
  const fixedDay = { fitnessrest: '2026-10-07', fitnessmissed: '2026-10-07', fitnesslastweek: '2026-10-12', weeklystale: '2026-10-07', weekcount: '2026-10-07' }[scenario];
  if (fixedDay) await context.clock.setFixedTime(new Date(`${fixedDay}T11:00:00Z`));
  const today = fixedDay || londonKey();
  const yesterday = shiftKey(today, -1);
  const bornYearsAgo = years => `${Number(today.slice(0, 4)) - years}-01-01`;
  const dayCodes = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const lastWeekMonday = shiftKey(today, -((todayDow + 6) % 7) - 7);
  const timed = scenario.startsWith('nextup');
  const meals = [{ name: 'Breakfast', calories: 600, protein: 40, carbs: 60, fats: 20, ...(timed ? { time: '07:00' } : {}) }, { name: 'Lunch', calories: 700, protein: 45, carbs: 80, fats: 20, ...(timed ? { time: '12:30' } : {}) }, { name: 'Dinner', calories: 800, protein: 50, carbs: 90, fats: 25, ...(timed ? { time: '19:00' } : {}) }, ...(scenario === 'reviewskip' ? [{ name: 'Snack', calories: 250, protein: 20, carbs: 20, fats: 8 }] : [])];
  if (scenario === 'restday') { meals[0].time = '08:00'; meals[1].time = '13:00'; meals[2].time = '21:00'; }
  const freeDay = dayCodes[(todayDow + 2) % 7];
  const tables = {
    nutrition_plans: ['nutritionai', 'newdash'].includes(scenario) ? [] : [{ user_id: user.id, daily_calories: scenario === 'planwarning' ? 2600 : 2100, protein_target: scenario === 'planwarning' ? 100 : 135, carbs_target: 230, fats_target: 65, meals, rest_day_meals: [], meal_library: [], weekly_meal_plan: {},
      ...(['libraryedit', 'mealswap', 'mealswapdash'].includes(scenario) ? { meal_library: [{ id: 'lib1', name: 'Protein Pancakes', calories: 450, protein: 35, carbs: 50, fats: 9, mealType: 'fixed', repeatDaily: true }] } : {}),
      goal: scenario === 'nutritionlegacy' ? 'Cut (lose fat)' : ['nutritionedit', 'nutritionnocolumn'].includes(scenario) ? 'Lose fat' : 'maintain',
      ...(['nutritionedit', 'nutritionnocolumn'].includes(scenario) ? { setup: { mode: 'guided', weight: 82, height: 180, age: 34, sex: 'Male', activityLevel: 'Lightly active', goal: 'Lose fat', mealsPerDay: 3, wakeTime: '06:15', answers: { allergies: 'peanuts', diet_type: 'No restrictions' } } } : {}) }],
    ...(scenario === 'nutritionlegacy' ? { morning_checkins: [{ date: yesterday, score: 7, data: { weight: '79.5' } }] } : {}),
    user_profiles: scenario === 'profileprefill' ? [{ user_id: user.id, height_cm: '175.0', date_of_birth: bornYearsAgo(40), sex: 'prefer_not_to_say' }]
      : ['profilepartial', 'profiletodo', 'profiletodofail'].includes(scenario) ? [{ user_id: user.id, height_cm: scenario === 'profilepartial' ? '182.0' : '170.0', date_of_birth: null, sex: null }] : [],
    ...(timed ? { morning_routines: [{ user_id: user.id, wake_time: '06:00', tasks: [] }], habits: [{ id: 'h1', user_id: user.id, name: 'Read 10 pages', category: 'daily', created_at: '2026-01-01T00:00:00Z' }], habit_completions: [] } : {}),
    ...(scenario === 'nutritionai' ? { morning_routines: [{ user_id: user.id, wake_time: '05:30', tasks: [] }] } : {}),
    ...(scenario === 'nextupmorningslow' ? { morning_checkins: [{ id: 'mc', user_id: user.id, date: today, score: null, data: { inProgress: true, sleepHours: '7' } }] } : {}),
    nutrition_logs: [
      ...(scenario === 'offplancap' ? [{ id: 'n1', user_id: user.id, date: today, total_calories: 3720, total_protein: 85, meals_completed: { 0: true, 1: true, _review_complete: true }, off_plan_food: 'large pizza', off_plan_calories: 2420 }]
        : scenario === 'offplanmacros' ? [{ id: 'n1', user_id: user.id, date: today, total_calories: 1000, total_protein: 70, meals_completed: { 0: true, _off_plan: { protein: 30, carbs: 50, fats: 10 }, _review_complete: false }, off_plan_food: 'toast', off_plan_calories: 400 }]
        : ['dashlog', 'nutritionorder', 'loadwrites', 'setprefill', 'nextupmorning', 'nextupworkout', 'nextupslow', 'nextupmorningslow', 'newdash', 'planwarning', 'restday', 'targetsuggest', 'targetkeep', 'logextra', 'logextradash', 'editordraft', 'habitlink', 'activitylog', 'activitynextup', 'weeklyplanstart', 'profilelive', 'profileexperience', 'mealswap', 'mealswapdash'].includes(scenario) ? [] : [{ id: 'n1', user_id: user.id, date: today, total_calories: 1300, total_protein: 85, meals_completed: { 0: true, 1: true, 2: { completed: false, note: 'large pepperoni pizza and two beers' }, _review_complete: scenario !== 'reviewskip' }, off_plan_food: scenario === 'reviewskip' || scenario === 'dashexcludes' ? '' : 'large pepperoni pizza, two beers', off_plan_calories: null }]),
      { id: 'n0', user_id: user.id, date: yesterday, total_calories: 2050, total_protein: 130, meals_completed: [true, true, true] },
    ],
    daily_debrief: [{ overall_score: 7, task_scores: {} }],
    calendar_tasks: [{ title: 'Gym', status: 'done' }, { title: 'Emails', status: 'pending' }],
    workout_logs: ['loadwrites', 'nextupslow'].includes(scenario) ? [
        { id: 43, user_id: user.id, date: today, session_name: 'Upper A', in_progress: true, total_volume: 720, duration_mins: 10, created_at: new Date(Date.now() - 600000).toISOString(), exercises: [{ name: 'Bench Press', prescribed_sets: 3, prescribed_reps: ['8-10', '8-10', '8-10'], sets: [{ weight: '80', reps: '9', setNum: 1, repRange: '8-10' }] }] },
        { id: 41, user_id: user.id, date: yesterday, session_name: 'Lower A', in_progress: true, total_volume: 500, duration_mins: 20, created_at: `${yesterday}T18:00:00Z`, exercises: [{ name: 'Squat', sets: [{ weight: '100', reps: '5' }] }] },
      ] : scenario === 'nextupworkout' ? [{ id: 41, user_id: user.id, date: yesterday, session_name: 'Lower A', in_progress: true, total_volume: 500, duration_mins: 20, created_at: `${yesterday}T18:00:00Z`, exercises: [{ name: 'Squat', sets: [{ weight: '100', reps: '5' }] }] }]
      : scenario === 'setprefill' ? [{ id: 'old', user_id: user.id, date: shiftKey(today, -7), session_name: 'Push A', in_progress: false, total_volume: 2000, duration_mins: 40, created_at: `${shiftKey(today, -7)}T18:00:00Z`, exercises: [{ name: 'Bench Press', sets: [{ weight: '80', reps: '9' }, { weight: '80', reps: '8' }, { weight: '80', reps: '8' }] }] }]
      : scenario === 'weeklybadge' ? [{ id: 'wl', user_id: user.id, date: shiftKey(lastWeekMonday, 1), session_name: 'Push A', in_progress: false, total_volume: 3000, duration_mins: 50, exercises: [] }] : scenario === 'dashexcludes' ? [{ id: 'w1', user_id: user.id, date: today, session_name: 'Push A', in_progress: false, total_volume: 3000, duration_mins: 50, exercises: [{ name: 'Bench Press', sets: [{ weight: '80', reps: '6', personalBest: { type: 'weight_pb', label: 'Weight PB' } }, { weight: '80', reps: '5' }] }] }] : [],
    workout_splits: ['loadwrites', 'setprefill', 'nextupworkout', 'nextupmorning', 'nextupslow', 'nextupmorningslow', 'longname'].includes(scenario) ? [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [{ name: ['loadwrites', 'nextupslow'].includes(scenario) ? 'Upper A' : 'Push A', days: [dayCodes[todayDow]], exercises: [{ name: scenario === 'longname' ? 'Single-Arm Dumbbell Bent-Over Row (Bench Supported)' : 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } }] }]
      : scenario === 'fitnessrest' ? [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [{ name: 'Push A', days: [dayCodes[(todayDow + 6) % 7]], exercises: [{ name: 'Dumbbell Shoulder Press', sets: 4, reps: ['10','10','10','10'] }], approval: { approved: true } }] }] : ['painresolve', 'changeplanhint', 'planmarkdown', 'streamcoach', 'planchangebutton'].includes(scenario) ? [{ id: 's', user_id: user.id, programme_started_at: new Date().toISOString(), sessions: [{ name: 'Push A', days: [['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()]], exercises: [{ name: 'Dumbbell Shoulder Press', sets: 4, reps: ['10','10','10','10'] }], approval: { approved: true } }] }] : [],
  };
  // New scenarios' data.
  if (scenario === 'restday') tables.nutrition_plans[0].rest_day_meals = [
    { name: 'Rest Oats', time: '09:00', calories: 500, protein: 40, carbs: 50, fats: 12, ingredients: [{ name: 'Oats', weight: 60, unit: 'g' }] },
    { name: 'Rest Salad', time: '18:00', calories: 1030, protein: 60, carbs: 90, fats: 40, ingredients: [{ name: 'Chicken', weight: 150, unit: 'g' }] },
  ];
  if (['targetsuggest', 'targetkeep'].includes(scenario)) {
    Object.assign(tables.nutrition_plans[0], { daily_calories: 2381, protein_target: 115, updated_at: '2026-09-01T10:00:00Z', setup: { mode: 'guided', weight: 82, activityLevel: 'Moderately active', goal: 'Maintain', mealsPerDay: 3 } });
    tables.user_profiles = [{ user_id: user.id, height_cm: '178.0', date_of_birth: '1995-01-01', sex: 'male' }];
  }
  if (scenario === 'habitlink') Object.assign(tables, { habits: [{ id: 'h2', user_id: user.id, name: 'Stretch or move', category: 'daily', created_at: '2026-01-01T00:00:00Z' }], habit_completions: [] });
  if (['activitylog', 'activitynextup'].includes(scenario)) tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: `${today}T08:00:00Z`, sessions: [
    ...(scenario === 'activitynextup' ? [{ name: 'HYROX', kind: 'activity', activityType: 'hyrox', days: [dayCodes[todayDow]], duration_mins: 60, exercises: [], approval: { approved: true } }] : []),
    { name: 'Push A', days: [dayCodes[(todayDow + 6) % 7]], exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } },
  ] }];
  if (scenario === 'smallfixes') {
    tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: `${today}T08:00:00Z`, sessions: [{ name: 'Upper A', days: [dayCodes[todayDow]], duration_mins: 30, exercises: [{ name: 'Bench Press', sets: 4, reps: ['8-10', '8-10', '8-10', '8-10'] }, { name: 'Row', sets: 6, reps: ['8-10', '8-10', '8-10', '8-10', '8-10', '8-10'] }], approval: { approved: true, reviewAfter: '2026-11-30' } }] }];
    tables.workout_logs = [{ id: 'w9', user_id: user.id, date: yesterday, session_name: 'Upper A', in_progress: false, total_volume: 3000, duration_mins: 32, created_at: `${yesterday}T18:00:00Z`, exercises: [{ name: 'Bench Press', sets: [{ weight: '80', reps: '8' }] }] }];
  }
  if (scenario === 'fitnesslastweek') tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [
    { name: 'Push A', days: ['FRI'], exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } },
    { name: 'Pull A', days: ['WED'], exercises: [{ name: 'Row', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } },
  ] }];
  if (scenario === 'fitnessmissed') tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [
    { name: 'Push A', days: ['MON'], exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } },
    { name: 'Pull A', days: ['WED'], exercises: [{ name: 'Row', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } },
  ] }];
  // Rep targets saved as one string, as a coach reply or an import sometimes left them.
  if (scenario === 'repsplit') tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [
    { name: 'Upper A', days: [dayCodes[todayDow]], exercises: [{ name: 'Bench Press', sets: 4, reps: '6-8,6-8,8,10' }, { name: 'Row', sets: 3, reps: ['8-10,8-10,12', '8-10,8-10,12', '8-10,8-10,12'] }], approval: { approved: true } },
  ] }];
  if (scenario === 'stalework') {
    // Yesterday's Upper A: two sets, then left open; the last autosave said 345 min.
    tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [{ name: 'Upper A', days: [dayCodes[todayDow]], exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } }] }];
    tables.workout_logs = [
      { id: 'stale1', user_id: user.id, date: yesterday, session_name: 'Upper A', in_progress: true, created_at: `${yesterday}T12:00:00Z`, duration_mins: 345, total_volume: 960, exercises: [{ name: 'Bench Press', sets: [{ weight: '60', reps: '8', at: `${yesterday}T12:05:00Z` }, { weight: '60', reps: '8', at: `${yesterday}T12:12:00Z` }] }] },
      // Closed before sets had times: shown capped.
      { id: 'old2', user_id: user.id, date: shiftKey(today, -2), session_name: 'Lower A', in_progress: false, created_at: `${shiftKey(today, -2)}T12:00:00Z`, duration_mins: 345, total_volume: 1000, exercises: [{ name: 'Squat', sets: [{ weight: '100', reps: '5' }, { weight: '100', reps: '5' }] }] },
    ];
  }
  if (scenario === 'exercisealias') {
    tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [{ name: 'Lower B', days: [dayCodes[todayDow]], exercises: [{ name: 'Goblet Squat', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } }] }];
    tables.workout_logs = [{ id: 'h1', user_id: user.id, date: shiftKey(today, -7), session_name: 'Lower A', in_progress: false, created_at: `${shiftKey(today, -7)}T12:00:00Z`, duration_mins: 40, total_volume: 432, exercises: [{ name: 'Dumbbell Goblet Squat', sets: [{ weight: '18', reps: '8' }, { weight: '18', reps: '8' }, { weight: '18', reps: '8' }] }] }];
  }
  if (scenario === 'weekcount') {
    tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: shiftKey(today, -30) + 'T08:00:00Z', sessions: [
      { name: 'Upper A', days: ['MON'], exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } },
      { name: 'Lower A', days: ['TUE'], exercises: [{ name: 'Squat', sets: 3, reps: ['5', '5', '5'] }], approval: { approved: true } },
    ] }];
    tables.workout_logs = [
      { id: 'w1', user_id: user.id, date: shiftKey(today, -2), session_name: 'Upper A', in_progress: false, created_at: `${shiftKey(today, -2)}T12:00:00Z`, duration_mins: 50, total_volume: 3000, exercises: [] },
      { id: 'w2', user_id: user.id, date: yesterday, session_name: 'Lower A', in_progress: false, created_at: `${yesterday}T12:00:00Z`, duration_mins: 45, total_volume: 3500, exercises: [] },
      { id: 'r1', user_id: user.id, date: today, session_name: 'Run', in_progress: false, created_at: `${today}T07:00:00Z`, duration_mins: 45, total_volume: 0, exercises: [{ name: 'Run', activity: { type: 'run', effort: 'hard', distanceKm: 8, notes: '' }, sets: [] }] },
    ];
  }
  if (scenario === 'weeklystale') {
    // Last week (28 Sep – 4 Oct): two lifts and a run, no plan to compare with,
    // and a coach summary written before the figures changed.
    const lastWeek = key => shiftKey('2026-09-28', key);
    tables.workout_splits = [];
    tables.workout_logs = [
      { id: 'a', user_id: user.id, date: lastWeek(1), session_name: 'Upper A', in_progress: false, created_at: `${lastWeek(1)}T12:00:00Z`, duration_mins: 50, total_volume: 3000, exercises: [] },
      { id: 'b', user_id: user.id, date: lastWeek(2), session_name: 'Run', in_progress: false, created_at: `${lastWeek(2)}T07:00:00Z`, duration_mins: 45, total_volume: 0, exercises: [{ name: 'Run', activity: { type: 'run', effort: 'hard' }, sets: [] }] },
      { id: 'c', user_id: user.id, date: lastWeek(3), session_name: 'Lower A', in_progress: false, created_at: `${lastWeek(3)}T12:00:00Z`, duration_mins: 45, total_volume: 3500, exercises: [] },
    ];
    tables.weekly_reports = [{ id: 'wr', user_id: user.id, week_start: '2026-09-28', week_end: '2026-10-04', report_date: '2026-10-04', created_at: '2026-10-05T08:00:00Z',
      patterns: 'BIGGEST WIN: Consistent mornings.\n\nFOCUS FOR NEXT WEEK: Two out of four leaves half the volume on the table.\n\nCOACH\'S VERDICT: Get all four in.' }];
    // Habit ticks and mornings from this week only, after a streak that ended last Sunday.
    tables.habits = [{ id: 'hr', user_id: user.id, name: 'Read for 10 minutes', category: 'daily', created_at: '2026-09-01T00:00:00Z' }];
    tables.habit_completions = ['2026-10-05', '2026-10-06', '2026-10-07'].map(date => ({ user_id: user.id, habit_id: 'hr', date }));
    tables.morning_routines = [{ user_id: user.id, wake_time: '06:30', tasks: [] }];
    tables.morning_checkins = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'].map(date => ({ user_id: user.id, date, score: 8, data: {} }));
  }
  if (scenario === 'weeklyplanstart') {
    tables.workout_splits = [{ id: 's', user_id: user.id, programme_started_at: `${today}T08:00:00Z`, sessions: [{ name: 'Push A', days: ['MON', 'THU'], exercises: [{ name: 'Bench Press', sets: 3, reps: ['8-10', '8-10', '8-10'] }], approval: { approved: true } }] }];
    tables.workout_logs = [{ id: 'old', user_id: user.id, date: shiftKey(lastWeekMonday, 1), session_name: 'Old Plan Day', in_progress: false, total_volume: 2000, duration_mins: 40, exercises: [] }];
  }
  const writes = [];
  const reads = [];
  const chats = [];
  let chatFails = scenario === 'roundupfail';
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/chat') {
        const body = JSON.parse(req.postData() || '{}');
        chats.push(body);
        if (chatFails) return route.fulfill({ status: 502, json: { error: 'Coach provider failed (529): Overloaded' } });
        if (body.stream && scenario === 'streamchat') return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-coach-stream': '1' }, body: 'Streamed: you have logged 1,300 kcal of your 2,100 kcal target.' });
        if (body.stream && scenario === 'streamerror') return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-coach-stream': '1' }, body: 'Partial reply that gets cut\u0000ERROR:Coach provider failed: stream error' });
        if (body.area === 'food_estimate') return route.fulfill({ json: { content: [{ text: JSON.stringify({ items: [{ name: 'Large pepperoni pizza', amount: '1 large (as stated)', calories_low: 1800, calories_high: 2400, protein_low: 70, protein_high: 95, carbs_low: 200, carbs_high: 260, fat_low: 70, fat_high: 90 }, { name: 'Beer', amount: '2 (as stated)', calories_low: 360, calories_high: 480, protein_low: 2, protein_high: 4, carbs_low: 26, carbs_high: 40, fat_low: 0, fat_high: 0 }] }) }] } });
        if (body.area === 'rest_day_plan') {
          const first = body.messages[0].content;
          const [, kcal] = first.match(/Targets: (\d+) kcal/);
          const [, protein] = first.match(/(\d+)g protein/);
          const per = n => Math.round(Number(n) / 3);
          return route.fulfill({ json: { content: [{ text: JSON.stringify({ meals: [
            { name: 'Rest Oats', time: '08:00', ingredients: [{ name: 'Oats', weight: 60, unit: 'g' }], calories: per(kcal), protein: per(protein), carbs: 40, fats: 8 },
            { name: 'Rest Chicken Salad', time: '13:00', ingredients: [{ name: 'Chicken breast', weight: 150, unit: 'g' }], calories: per(kcal), protein: per(protein), carbs: 20, fats: 12 },
            { name: 'Rest Salmon & Veg', time: '19:00', ingredients: [{ name: 'Salmon', weight: 150, unit: 'g' }], calories: Number(kcal) - 2 * per(kcal), protein: Number(protein) - 2 * per(protein), carbs: 25, fats: 18 },
          ] }) }] } });
        }
        if (['meal_plan_build', 'meal_plan_tweak'].includes(body.area)) {
          const first = body.messages[0].content;
          const [, kcal, protein] = first.match(/Targets: (\d+) kcal,? (?:and )?(\d+) ?g protein/);
          const last = body.messages.at(-1).content;
          const withDairy = body.area === 'meal_plan_tweak' || !/Replace them with safe foods/.test(last);
          const per = n => Math.round(Number(n) / 3);
          const plan = [
            withDairy ? { name: 'Greek Yoghurt Bowl', time: '08:00', ingredients: [{ name: 'Greek yoghurt', weight: 200, unit: 'g' }], calories: per(kcal), protein: per(protein), carbs: 40, fats: 10 } : { name: 'Oat Porridge', time: '08:00', ingredients: [{ name: 'Oat milk', weight: 250, unit: 'ml' }, { name: 'Oats', weight: 60, unit: 'g' }], calories: per(kcal), protein: per(protein), carbs: 40, fats: 10 },
            { name: body.area === 'meal_plan_tweak' ? 'Cheese Omelette' : 'Chicken & Rice', time: '13:00', ingredients: [{ name: body.area === 'meal_plan_tweak' ? 'Cheddar cheese' : 'Chicken breast', weight: 150, unit: 'g' }], calories: per(kcal), protein: per(protein), carbs: 50, fats: 12 },
            { name: 'Salmon & Potatoes', time: '19:00', ingredients: [{ name: 'Salmon', weight: 180, unit: 'g' }], calories: Number(kcal) - 2 * per(kcal), protein: Number(protein) - 2 * per(protein), carbs: 45, fats: 20 },
          ];
          return route.fulfill({ json: { content: [{ text: JSON.stringify({ meals: plan }) }] } });
        }
        if (body.area === 'weekly_summary') return route.fulfill({ json: { content: [{ text: '{"biggest_win":"You trained twice.","focus":"Log meals.","verdict":"First tracked week."}' }] } });
        return route.fulfill({ json: { content: [{ text: 'Solid day: two meals on plan and a workout. Tomorrow, plan dinner before 6pm.' }] } });
      }
      if (url.pathname === '/api/coach') {
        const body = JSON.parse(req.postData() || '{}');
        chats.push({ coach: true, ...body });
        if (scenario === 'streamcoach') {
          const lines = [{ type: 'partial', message: 'Next set:' }, { type: 'partial', message: 'Next set: 10 reps at 20kg' }, { type: 'final', message: 'Next set: 10 reps at 20kg, then rest 90 seconds.', insights: [], actions: [], activePain: false, conversationId: 'c1' }];
          return route.fulfill({ status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }, body: lines.map(l => JSON.stringify(l)).join('\n') + '\n' });
        }
        if (/permanently/i.test(body.message)) return route.fulfill({ json: { message: "I can't change your saved plan from here — use CHANGE PLAN on the Fitness page. For today, tap swap.", insights: [], actions: [], activePain: false, planChangeHint: true, conversationId: 'c1' } });
        return route.fulfill({ json: /pain/i.test(body.message) ? { message: 'Stop that exercise for today — get it checked by a physio or doctor if it continues.', insights: [], actions: [], activePain: true, safetyStop: true, conversationId: 'c1' } : { message: 'Next set: 10 reps.', insights: [], actions: [], activePain: false, conversationId: 'c1' } });
      }
      if (url.pathname === '/api/plan-change') return route.fulfill({ json: { message: '**Sets per week:** chest gets 7 direct sets.\n**Effort:** stop 1–3 reps short of failure.', recommendation: 'clarify', changes: [] } });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { content: [{ text: 'OK.' }] } });
      return route.continue();
    }
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    if (url.pathname.includes('/storage/')) return route.fulfill({ json: [] });
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    const table = url.pathname.split('/').pop();
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    if (req.method() !== 'GET') {
      writes.push({ table, method: req.method(), body: req.postData(), url: req.url() });
      if (table === 'weekly_reports' && scenario === 'weeklysavefail') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.weekly_reports' in the schema cache" } });
      if (table === 'user_profiles' && scenario === 'profiletodofail') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.user_profiles' in the schema cache" } });
      if (table === 'nutrition_logs' && req.method() === 'POST') return route.fulfill({ status: 201, json: single ? { id: 'log-new' } : [{ id: 'log-new' }] });
      if (table === 'workout_logs' && req.method() === 'POST') return route.fulfill({ status: 201, json: single ? { id: 'wlog-new', ...JSON.parse(req.postData() || '{}') } : [{ id: 'wlog-new' }] });
      if (table === 'workout_splits' && req.method() === 'POST') { const body = JSON.parse(req.postData() || '{}'); return route.fulfill({ status: 201, json: single ? body : [body] }); }
      if (table === 'nutrition_plans' && scenario === 'nutritionnocolumn' && /"setup"/.test(req.postData() || '')) return route.fulfill({ status: 400, json: { code: 'PGRST204', message: "Could not find the 'setup' column of 'nutrition_plans' in the schema cache" } });
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    if (table === 'weekly_reports' && scenario === 'weeklysavefail') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.weekly_reports' in the schema cache" } });
    let rows = tables[table] || [];
    if (table === 'nutrition_logs' || table === 'morning_checkins') {
      const eq = url.searchParams.get('date');
      if (eq?.startsWith('eq.')) rows = rows.filter(r => r.date === eq.slice(3));
    }
    const idEq = url.searchParams.get('id');
    if (idEq?.startsWith('eq.')) rows = rows.filter(r => String(r.id) === idEq.slice(3));
    // Slow reads for one tab, so a Next up tap arrives while it is still loading.
    if (scenario === 'nextupslow' && table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true' && url.searchParams.get('date')?.startsWith('eq.')) await new Promise(resolve => setTimeout(resolve, 3000));
    if (scenario === 'nextupmorningslow' && table === 'morning_checkins' && url.searchParams.get('limit') === '30') await new Promise(resolve => setTimeout(resolve, 3000));
    const dateParam = url.searchParams.get('date');
    const dateMatches = r => !dateParam || (dateParam.startsWith('eq.') ? String(r.date) === dateParam.slice(3) : dateParam.startsWith('lt.') ? String(r.date) < dateParam.slice(3) : true);
    if (table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = ['loadwrites', 'nextupslow', 'nextupworkout', 'stalework'].includes(scenario) ? rows.filter(r => r.in_progress && dateMatches(r)) : [];
    if (scenario === 'weeklysavefail' && table === 'workout_logs') rows = [{ id: 'w', date: shiftKey(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - 5), total_volume: 2180, duration_mins: 1, in_progress: false, exercises: [] }];
    // PostgREST or=(in_progress.eq.false,date.lt.X): finished, or from an earlier day.
    const orFilter = url.searchParams.get('or');
    const earlierDay = orFilter && /in_progress\.eq\.false,date\.lt\.(\d{4}-\d{2}-\d{2})/.exec(orFilter);
    if (earlierDay) rows = rows.filter(r => !r.in_progress || String(r.date) < earlierDay[1]);
    // Everyone here has already agreed to health data storage (on their profile).
    if (table === 'user_profiles' && req.method() === 'GET') rows = (rows.length ? rows : [{ user_id: '11111111-1111-4111-8111-111111111111' }]).map(row => ({ health_consent_at: '2026-10-06T08:00:00.000Z', health_consent_version: '2026-10-06', ...row }));
    reads.push({ table, single, count: rows.length });
    // Like PostgREST: single() with no row (or several) is a 406.
    if (single && rows.length !== 1) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } });
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3123/app');
  await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });

  const openNutrition = async () => {
    await page.getByRole('button', { name: /NUTRITION$/ }).last().click();
  };
  // An existing plan opens on its review; EDIT on the targets opens the first step.
  const openTargets = async () => {
    await page.getByRole('button', { name: 'EDIT PLAN' }).click();
    await page.getByText('REVIEW YOUR PLAN').waitFor();
    await page.getByRole('button', { name: 'Edit targets' }).click();
  };
  const planWrite = () => { const w = writes.filter(w => w.table === 'nutrition_plans' && w.method !== 'GET' && JSON.parse(w.body).daily_calories).at(-1); return w && JSON.parse(w.body); };
  if (scenario === 'loadwrites') {
    // Opening the app writes nothing, reads each row once, and has no 406s.
    await page.waitForTimeout(4000);
    assert.deepEqual(writes.map(w => `${w.method} ${w.table}`), [], 'no writes on load');
    const count = table => reads.filter(r => r.table === table).length;
    for (const table of ['workout_splits', 'morning_routines', 'nutrition_plans', 'coach_profiles', 'user_profiles', 'habits', 'habit_completions']) {
      assert.ok(count(table) <= 1, `${table} read ${count(table)} times`);
    }
    assert.deepEqual(reads.filter(r => r.single && r.count !== 1).map(r => r.table), [], 'no single() reads of missing rows (406)');
    // One banner says where the workout is up to; Next up doesn't repeat it.
    const banner = page.getByTestId('active-banner-fitness');
    await banner.getByText('Upper A · Set 2 of 3 · Bench Press').waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'banner.png' });
    await page.getByTestId('next-up').waitFor();
    assert.equal(await page.getByTestId('next-up').getByText('Upper A').count(), 0, 'no second continue card');
    await banner.click();
    await page.getByText('SET 2 OF 3').waitFor();
    // Suggested faintly: the weight and reps of the set just logged.
    assert.equal(await page.getByLabel('Weight in kilograms').getAttribute('placeholder'), '80', 'weight from the set just logged');
    assert.equal(await page.getByLabel('Reps').getAttribute('placeholder'), '9', 'reps from the set just logged');
    await page.waitForTimeout(500);
    assert.equal(writes.filter(w => w.table === 'workout_logs').length, 0, 'opening the workout writes nothing');
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.waitForTimeout(500);
    const saved = writes.filter(w => w.table === 'workout_logs');
    assert.equal(saved.length, 1);
    assert.match(decodeURIComponent(saved[0].url), /id=eq\.43/);
    assert.deepEqual(JSON.parse(saved[0].body).exercises[0].sets.map(set => `${set.weight}x${set.reps}`), ['80x9', '80x9']);
  } else if (scenario === 'offplancap' || scenario === 'offplanmacros') {
    await openNutrition();
    const cell = async key => (await page.getByTestId(`remaining-${key}`).textContent()).replace(/[A-Z\s]+$/, '');
    await page.getByTestId('remaining-carbs').waitFor();
    if (scenario === 'offplancap') {
      assert.deepEqual([await cell('calories'), await cell('protein'), await cell('carbs'), await cell('fats')], ['0', '0g', '0g', '0g'], '0 kcal left means nothing else left');
      await page.getByTestId('offplan-rough').waitFor();
      assert.match(await page.getByTestId('offplan-rough').textContent(), /2,420 kcal/);
      if (process.env.SHOT) await page.screenshot({ path: 'offplan.png' });
    } else {
      assert.deepEqual([await cell('calories'), await cell('protein'), await cell('carbs'), await cell('fats')], ['1100', '65g', '120g', '35g'], 'off-plan macros count');
      assert.equal(await page.getByTestId('offplan-rough').count(), 0);
    }
  } else if (scenario === 'planwarning') {
    await openNutrition();
    const gap = page.getByTestId('plan-target-gap');
    await gap.waitFor();
    assert.match((await gap.textContent()).replace(/\s+/g, ' '), /Your training day meals add up to 2,100 kcal and 135 g protein: 500 kcal under and 35 g protein over your targets of 2,600 kcal and 100 g protein\./);
    if (process.env.SHOT) { await gap.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'plan-gap.png' }); }
    await gap.getByRole('button', { name: 'EDIT MEALS' }).click();
    await page.getByRole('button', { name: 'REVIEW →' }).click();
    await page.getByTestId('review-target-gap').waitFor();
  } else if (scenario === 'setprefill') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    await page.getByText('SET 1 OF 3').waitFor();
    const reps = page.getByLabel('Reps');
    const weight = page.getByLabel('Weight in kilograms');
    // The suggestion shows faintly in the boxes (placeholders): last time
    // 80 kg × 9 in an 8-10 range, so 80 kg and aim for 10.
    const shown = async () => [await reps.inputValue(), await reps.getAttribute('placeholder'), await weight.inputValue(), await weight.getAttribute('placeholder')];
    assert.deepEqual(await shown(), ['', '10', '', '80']);
    await page.getByText('REP RANGE: 8-10').waitFor();
    assert.equal(await page.getByTestId('set-note').textContent(), 'Last time 9 × 80 kg. Aim for 10.');
    const colour = locator => locator.evaluate(element => getComputedStyle(element).color);
    const placeholderColour = locator => locator.evaluate(element => getComputedStyle(element, '::placeholder').color);
    await page.waitForTimeout(400); // buttons fade between colours over 0.18 s
    assert.equal(await colour(page.getByRole('button', { name: 'One rep more' })), 'rgb(0, 200, 255)', '± buttons are blue, not green');
    assert.equal(await colour(page.getByRole('button', { name: '2.5 kg less' })), 'rgb(0, 200, 255)');
    assert.equal(await colour(page.getByRole('button', { name: 'END WORKOUT' })), 'rgb(255, 45, 120)', 'END WORKOUT is red');
    assert.equal(await placeholderColour(reps), 'rgb(125, 140, 149)', 'suggestions are faint');
    if (process.env.SHOT) await page.screenshot({ path: 'logger-target.png' });
    // Typing replaces the faint number instead of adding to it.
    await reps.click();
    await page.keyboard.type('9');
    assert.equal(await reps.inputValue(), '9');
    assert.equal(await colour(reps), 'rgb(8, 12, 16)', 'typed numbers are in full');
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByText('SET 2 OF 3').waitFor();
    // Set 2: faint again, aiming one above last time's 8.
    assert.deepEqual(await shown(), ['', '9', '', '80']);
    if (process.env.SHOT) await page.screenshot({ path: 'logger-faint.png' });
    await page.getByRole('button', { name: 'One rep more' }).click();
    assert.equal(await reps.inputValue(), '10', 'a stepped number is in full');
    assert.equal(await weight.inputValue(), '', 'the weight is still the suggestion');
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByText('SET 3 OF 3').waitFor();
    assert.deepEqual(await shown(), ['', '9', '', '80']);
    // A heavier weight changes the reps to aim for.
    await page.getByRole('button', { name: '2.5 kg more' }).click();
    assert.equal(await weight.inputValue(), '82.5');
    assert.equal(await reps.getAttribute('placeholder'), '8');
    assert.equal(await page.getByTestId('set-note').textContent(), 'Last time 8 × 80 kg. At 82.5 kg, aim for 8.');
    // An emptied box goes back to the suggestion.
    await reps.fill('7');
    await reps.fill('');
    assert.deepEqual([await reps.inputValue(), await reps.getAttribute('placeholder')], ['', '8']);
    if (process.env.SHOT) await page.screenshot({ path: 'logger.png' });
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.waitForTimeout(800);
    const withSets = writes.filter(w => w.table === 'workout_logs' && w.body && (JSON.parse(w.body).exercises || [])[0]?.sets?.length === 3);
    assert.ok(withSets.length, 'all three sets saved');
    assert.deepEqual(JSON.parse(withSets.at(-1).body).exercises[0].sets.map(set => `${set.weight}x${set.reps}`), ['80x9', '80x10', '82.5x8']);
  } else if (scenario === 'longname') {
    // A long exercise name shows in full at the top of the workout.
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    const name = page.getByTestId('exercise-name');
    await name.waitFor();
    assert.equal(await name.textContent(), 'Single-Arm Dumbbell Bent-Over Row (Bench Supported)');
    const layout = await name.evaluate(element => {
      const box = element.getBoundingClientRect();
      const prev = document.querySelector('[aria-label="Previous exercise"]').getBoundingClientRect();
      const next = document.querySelector('[aria-label="Next exercise"]').getBoundingClientRect();
      return { clipped: element.scrollWidth > element.clientWidth + 1, lines: Math.round(box.height / parseFloat(getComputedStyle(element).lineHeight)), between: box.left >= prev.right && box.right <= next.left, buttonsOnScreen: prev.left >= 0 && next.right <= innerWidth };
    });
    assert.deepEqual({ ...layout, lines: layout.lines >= 2 }, { clipped: false, lines: true, between: true, buttonsOnScreen: true }, JSON.stringify(layout));
    if (process.env.SHOT) await page.screenshot({ path: 'longname.png' });
  } else if (scenario === 'nextupmorning') {
    const card = page.getByTestId('next-up');
    await card.getByTestId('next-up-title').filter({ hasText: 'Morning check-in' }).waitFor();
    // Only a new weekly report (the yellow ! card) may sit above Next up.
    const cardIds = await page.locator('.t3d-main .t3d-card').evaluateAll(cards => cards.map(card => card.dataset.new ? 'weekly-new' : card.dataset.testid || '-'));
    assert.equal(cardIds.find(id => id !== 'weekly-new'), 'next-up', `Next up is at the top: ${cardIds.slice(0, 3).join(' | ')}`);
    const text = (await card.textContent()).replace(/\s+/g, ' ');
    assert.match(text, /Push A · Today's workout/);
    assert.match(text, /Breakfast · Next meal · 07:00/);
    assert.match(text, /Read 10 pages · Habit · 1 habit left today/);
    assert.doesNotMatch(text, /End-of-day/, 'not before 6 pm');
    if (process.env.SHOT) await page.screenshot({ path: 'nextup.png' });
    // One tap logs breakfast; lunch becomes the next meal.
    await card.getByRole('button', { name: '✓ ATE IT' }).click();
    await card.getByText(/Lunch · Next meal · 12:30/).waitFor();
    const logged = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(logged.meals_completed[0], true);
    // One tap ticks the habit.
    await card.getByRole('button', { name: '✓ DONE' }).click();
    await page.waitForTimeout(600);
    assert.ok(writes.some(w => w.table === 'habit_completions'), 'habit saved');
    assert.equal(await card.getByText('Read 10 pages').count(), 0);
    // The score and photos are further down than the habits.
    const titles = await page.locator('.t3d-main .t3d-card .t3d-ctitle').allTextContents();
    assert.ok(titles.indexOf('DAILY SCORE') > titles.indexOf('DO YOUR DAILY HABITS'), titles.join(' | '));
    assert.ok(titles.indexOf('PROGRESS PHOTOS') === -1 || titles.indexOf('PROGRESS PHOTOS') > titles.indexOf('DAILY SCORE'));
  } else if (scenario === 'nextupworkout') {
    // After midday the untouched morning is no longer due: the workout is next.
    await page.getByTestId('next-up-title').filter({ hasText: 'Push A' }).waitFor();
    assert.equal(await page.getByTestId('next-up').getByText('Morning check-in').count(), 0);
    await page.waitForTimeout(1000);
    assert.deepEqual(writes.map(w => `${w.method} ${w.table}`), [], 'yesterday\'s unfinished workout is not closed just by opening the app');
    await page.getByTestId('next-up-action').click();
    await page.getByText('SET 1 OF 3').waitFor({ timeout: 10000 });
    const started = writes.filter(w => w.table === 'workout_logs' && w.method === 'POST');
    assert.equal(started.length, 1, 'one tap started the workout');
    // Starting a workout closes yesterday's unfinished one, and only that row.
    const closed = writes.filter(w => w.table === 'workout_logs' && w.method === 'PATCH' && w.body === '{"in_progress":false}');
    assert.equal(closed.length, 1);
    assert.match(decodeURIComponent(closed[0].url), /id=in\.\(41\)/);
  } else if (scenario === 'nextupslow') {
    // Tapped while Fitness is still loading: once it has loaded, the
    // unfinished workout is continued, not replaced by a new one.
    await page.getByTestId('next-up-title').filter({ hasText: 'Upper A' }).waitFor();
    await page.getByTestId('next-up-action').click();
    await page.getByText('SET 2 OF 3').waitFor({ timeout: 10000 });
    assert.equal(writes.filter(w => w.table === 'workout_logs' && w.method === 'POST').length, 0, 'no new workout started');
  } else if (scenario === 'nextupmorningslow') {
    // Tapped while Morning is still loading: the unfinished check-in is finished, not restarted.
    await page.getByTestId('next-up-title').filter({ hasText: 'Finish your morning' }).waitFor();
    await page.getByTestId('next-up-action').click();
    await page.getByText('LOG THIS MORNING').waitFor({ timeout: 10000 });
  } else if (scenario === 'newdash') {
    // A new user with nothing due yet sees GET STARTED first, not an empty Next up.
    await page.getByText('GET STARTED').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByTestId('next-up').count(), 0, 'no empty Next up card');
    const titles = await page.locator('.t3d-main .t3d-card:not([data-new]) .t3d-ctitle').allTextContents();
    assert.equal(titles[0], 'GET STARTED', titles.join(' | '));
    if (process.env.SHOT) await page.screenshot({ path: 'newdash.png' });
  } else if (scenario === 'profilelive') {
    // A profile saved while the nutrition setup is open shows there at once.
    await openNutrition();
    await openTargets();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    await page.getByLabel('HEIGHT (cm)').waitFor();
    await page.getByRole('button', { name: 'PROFILE', exact: true }).click();
    const dialog = page.getByTestId('profile-dialog');
    await dialog.getByLabel('Height (cm)').fill('178');
    await dialog.getByLabel('Date of birth').fill('1995-01-01');
    await dialog.getByRole('button', { name: 'MALE', exact: true }).click();
    await dialog.getByRole('button', { name: 'SAVE PROFILE' }).click();
    await page.getByTestId('app-notice').getByText('Profile saved ✓').waitFor();
    const summary = page.getByTestId('profile-summary');
    await summary.waitFor();
    assert.match((await summary.textContent()).replace(/\s+/g, ' '), /From your profile: 178 cm · born 1 Jan 1995 \(age \d+\) · Male/);
    assert.equal(await page.getByLabel('HEIGHT (cm)').count(), 0, 'not asked again');
  } else if (scenario === 'profileexperience') {
    await page.getByRole('button', { name: 'PROFILE', exact: true }).click();
    const dialog = page.getByTestId('profile-dialog');
    const save = dialog.getByRole('button', { name: 'SAVE PROFILE' });
    assert.equal(await save.isDisabled(), true, 'nothing to save yet');
    await dialog.getByRole('button', { name: /^ADVANCED/ }).click();
    assert.equal(await save.isDisabled(), false, 'training experience can be saved on its own');
    assert.match(await dialog.getByTestId('profile-missing').textContent(), /Still to add: height, date of birth, sex/);
    await save.click();
    await page.getByTestId('app-notice').getByText('Profile saved ✓').waitFor();
    assert.equal(JSON.parse(writes.filter(w => w.table === 'coach_profiles').at(-1).body).experience_level, 'advanced');
    assert.equal(writes.filter(w => w.table === 'user_profiles').length, 0, 'nothing else changed');
  } else if (scenario === 'restday') {
    // A rest day (nothing scheduled) with its own meals: the lighter target.
    await page.getByText(/EATEN OF 1,850 TARGET/).waitFor();
    await page.getByTestId('score-parts').getByText('Calories').waitFor();
    await openNutrition();
    await page.getByRole('button', { name: 'REST DAY', exact: true }).click();
    await page.getByTestId('today-targets').getByText('REST DAY TARGET · 1,850 KCAL').waitFor();
    assert.equal((await page.getByTestId('remaining-calories').textContent()).replace(/[A-Z\s]+$/, ''), '1850');
    // Each day type's meals are checked against its own target.
    const restGap = page.getByTestId('plan-rest-gap');
    await restGap.waitFor();
    assert.match((await restGap.textContent()).replace(/\s+/g, ' '), /Your rest day meals add up to 1,530 kcal and 100 g protein: 320 kcal under and 35 g protein under your targets of 1,850 kcal and 135 g protein\./);
    assert.match(await page.getByTestId('plan-style').textContent(), /your rest day meals on rest days/);
    if (process.env.SHOT) await page.screenshot({ path: 'plan-card.png', fullPage: true });
    // EDIT MEALS writes nothing to the clipboard.
    await page.getByTestId('plan-training').getByRole('button', { name: 'EDIT MEALS' }).first().click();
    await page.getByText('ABOUT YOUR DAY').waitFor();
    assert.equal(await page.evaluate(() => window.__clipboardWrites), 0, 'no clipboard writes');
    // The meal times are the meals' own.
    assert.match(await page.getByTestId('meal-times').textContent(), /Your meals run from 08:00 to 21:00\./);
    await page.getByRole('tab', { name: /REST DAYS/ }).click();
    assert.match(await page.getByTestId('meal-times').textContent(), /Your rest day meals run from 09:00 to 18:00\./);
    // The review has a link to change each part.
    await page.getByRole('button', { name: 'REVIEW', exact: true }).click();
    for (const id of ['targets', 'structure', 'day', 'meals', 'rest']) await page.getByTestId(`review-section-${id}`).waitFor();
    assert.match(await page.getByTestId('review-style').textContent(), /your rest day meals on rest days/);
    await page.getByTestId('review-rest-gap').waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'review.png', fullPage: true });
    await page.getByRole('button', { name: 'Edit structure' }).click();
    await page.getByText('HOW MUCH STRUCTURE DO YOU WANT?').waitFor();
    await page.getByRole('button', { name: '← BACK TO REVIEW' }).click();
    await page.getByText('REVIEW YOUR PLAN').waitFor();
  } else if (scenario === 'targetsuggest' || scenario === 'targetkeep') {
    await openNutrition();
    const card = page.getByTestId('target-suggestion');
    await card.waitFor();
    const proposed = Number((await card.textContent()).match(/works out at ([\d,]+) kcal/)[1].replace(/,/g, ''));
    assert.ok(proposed > 2600, `recalculated ${proposed}`);
    assert.match(await card.textContent(), /178 cm, age \d+, male/);
    if (process.env.SHOT) await page.screenshot({ path: 'suggest.png' });
    if (scenario === 'targetkeep') {
      await card.getByRole('button', { name: 'KEEP MY TARGETS' }).click();
      assert.equal(await page.getByTestId('target-suggestion').count(), 0);
      // Saved with the plan, not only in this browser.
      for (let i = 0; i < 30 && !writes.some(w => w.table === 'nutrition_plans' && /targetSuggestionDismissed/.test(w.body || '')); i++) await page.waitForTimeout(100);
      const saved = JSON.parse(writes.find(w => w.table === 'nutrition_plans' && /targetSuggestionDismissed/.test(w.body || '')).body);
      assert.equal(saved.setup.targetSuggestionDismissed, `2381|${proposed}`);
      assert.equal(saved.setup.weight, 82, 'the rest of the setup is kept');
      await page.reload();
      await page.getByText('DAILY SCORE').waitFor();
      await openNutrition();
      await page.getByTestId('nutrition-today').waitFor();
      assert.equal(await page.getByTestId('target-suggestion').count(), 0, 'stays dismissed');
      // Another device: nothing in this browser, the plan says it was kept.
      tables.nutrition_plans[0].setup = saved.setup;
      await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('track3d-target-suggestion')).forEach(key => localStorage.removeItem(key)));
      await page.reload();
      await page.getByText('DAILY SCORE').waitFor();
      await openNutrition();
      await page.getByTestId('nutrition-today').waitFor();
      assert.equal(await page.getByTestId('target-suggestion').count(), 0, 'stays dismissed on another device');
    } else {
      await card.getByRole('button', { name: 'REVIEW NEW TARGETS →' }).click();
      await page.getByTestId('setup-notice').getByText(`New targets from your profile: ${proposed.toLocaleString('en-GB')} kcal (was 2,381)`, { exact: false }).waitFor();
      await page.getByRole('button', { name: /SAVE PLAN/ }).click();
      await page.getByRole('button', { name: 'EDIT PLAN' }).waitFor();
      assert.equal(planWrite().daily_calories, proposed);
      assert.equal(await page.getByTestId('target-suggestion').count(), 0, 'up to date now');
    }
  } else if (scenario === 'logextra') {
    await openNutrition();
    const extra = page.getByTestId('nutrition-today').getByTestId('log-something-else');
    await extra.getByRole('button', { name: '+ LOG SOMETHING ELSE' }).click();
    if (process.env.SHOT) await page.screenshot({ path: 'extra.png' });
    await extra.getByRole('button', { name: /^Banana/ }).click();
    await extra.getByText('Added Banana · 105 kcal').waitFor();
    let saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(saved.off_plan_food, 'Banana');
    assert.equal(saved.off_plan_calories, 105);
    assert.deepEqual(saved.meals_completed._off_plan, { calories: 105, protein: 1, carbs: 27, fats: 0 });
    // Calories only: a rough split counts towards protein, carbs and fat.
    await extra.getByRole('button', { name: '+ LOG SOMETHING ELSE' }).click();
    await extra.getByLabel('What did you have?').fill('Takeaway');
    await extra.getByLabel('Something else KCAL').fill('900');
    await extra.getByRole('button', { name: 'ADD', exact: true }).click();
    await extra.getByText('Added Takeaway · 900 kcal').waitFor();
    saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(saved.off_plan_food, 'Banana; Takeaway');
    assert.equal(saved.off_plan_calories, 1005);
    assert.equal(saved.total_protein, 35, '1 g from the banana and a rough 34 g from the takeaway');
    await page.getByTestId('offplan-rough').getByText(/900 kcal/).waitFor();
    assert.equal((await page.getByTestId('remaining-calories').textContent()).replace(/[A-Z\s]+$/, ''), '1095');
    // No calories to hand: the coach estimates it, with protein, carbs and fat.
    await extra.getByRole('button', { name: '+ LOG SOMETHING ELSE' }).click();
    await extra.getByLabel('What did you have?').fill('large pizza and two beers');
    await extra.getByRole('button', { name: 'ESTIMATE IT' }).click();
    await extra.getByTestId('something-else-estimate').waitFor();
    await extra.getByRole('button', { name: 'ADD ~2,520 KCAL' }).click();
    await extra.getByText('Added large pizza and two beers · 2,520 kcal').waitFor();
    saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(saved.off_plan_calories, 3525);
    assert.deepEqual(saved.meals_completed._off_plan, { calories: 105 + 2520, protein: 1 + 86, carbs: 27 + 263, fats: 0 + 80 });
    assert.equal(chats.filter(chat => chat.area === 'food_estimate').length, 1);
  } else if (scenario === 'logextradash') {
    const card = page.getByTestId('dashboard-meal-log');
    await card.getByText('LOG AS YOU GO').waitFor();
    await card.getByRole('button', { name: '+ LOG SOMETHING ELSE' }).click();
    await card.getByRole('button', { name: /^Protein shake/ }).click();
    await card.getByText('Added Protein shake · 120 kcal').waitFor();
    const saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(saved.off_plan_food, 'Protein shake');
    assert.equal(saved.off_plan_calories, 120);
    assert.equal(saved.total_protein, 24);
  } else if (scenario === 'editordraft') {
    await openNutrition();
    await page.getByTestId('plan-training').getByRole('button', { name: 'EDIT MEALS' }).first().click();
    await page.getByRole('button', { name: 'Remove Dinner' }).click();
    // Leaving for another tab and coming back keeps the change.
    await page.getByRole('button', { name: /DASHBOARD$/ }).last().click();
    await page.getByText('DAILY SCORE').waitFor();
    await openNutrition();
    const draft = page.getByTestId('setup-draft');
    await draft.waitFor();
    await draft.getByRole('button', { name: 'CONTINUE EDITING →' }).click();
    await page.getByTestId('setup-notice').getByText('Your unsaved changes from earlier are back.').waitFor();
    await page.getByRole('button', { name: 'Remove Lunch' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Remove Dinner' }).count(), 0, 'Dinner is still removed');
    // Closing keeps it too; discarding brings back the saved plan.
    await page.getByRole('button', { name: '✕ CLOSE' }).click();
    await draft.getByRole('button', { name: 'DISCARD CHANGES' }).click();
    assert.equal(await page.getByTestId('setup-draft').count(), 0);
    await page.getByTestId('plan-training').getByRole('button', { name: 'EDIT MEALS' }).first().click();
    await page.getByRole('button', { name: 'Remove Dinner' }).waitFor();
    assert.equal(writes.filter(w => w.table === 'nutrition_plans').length, 0, 'nothing saved without SAVE PLAN');
  } else if (scenario === 'weeklyplanstart') {
    if (todayDow === 0) { console.log('PASS weeklyplanstart (Sunday: the week is still in progress)'); await browser.close(); return; }
    await page.getByTestId('weekly-report-card').getByRole('button', { name: 'OPEN WEEKLY REPORT →' }).click();
    const tile = page.getByTestId('tile-workouts');
    await tile.waitFor();
    const text = (await tile.textContent()).replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /missed/, `the newer plan doesn't count against that week: ${text}`);
    assert.match(text, /No weekly plan to compare against/);
  } else if (scenario === 'habitlink') {
    await page.getByText('Stretch or move').first().waitFor();
    // Finishing "Stretch / Mobility" in the morning ticks the habit.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('track3d-task-done', { detail: { name: 'Stretch / Mobility' } })));
    await page.waitForTimeout(800);
    const saved = writes.filter(w => w.table === 'habit_completions');
    assert.equal(saved.length, 1, 'the matching habit was ticked');
    assert.equal(JSON.parse(saved[0].body).habit_id, 'h2');
  } else if (scenario === 'activitylog') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByTestId('log-activity').click();
    const form = page.getByTestId('activity-form');
    await form.getByRole('button', { name: 'RUN', exact: true }).click();
    await form.getByLabel('Minutes').fill('45');
    await form.getByLabel('Distance in km').fill('5');
    await form.getByRole('button', { name: 'HARD', exact: true }).click();
    if (process.env.SHOT) await page.screenshot({ path: 'activity.png' });
    await form.getByRole('button', { name: /SAVE ACTIVITY/ }).click();
    await page.getByText('Run logged · 45 min · Hard · 5 km').waitFor();
    const row = JSON.parse(writes.filter(w => w.table === 'workout_logs' && w.method === 'POST').at(-1).body);
    assert.equal(row.session_name, 'Run');
    assert.equal(row.duration_mins, 45);
    assert.deepEqual(row.exercises[0].activity, { type: 'run', effort: 'hard', distanceKm: 5, notes: '' });
    await page.getByText('WORKOUT HISTORY').click();
    await page.getByText(/Run · 45 min · Hard · 5 km/).first().waitFor();
    // An activity can go in the weekly plan.
    await page.getByTestId('plan-add-activity').click();
    const planForm = page.getByTestId('plan-activity-form');
    await planForm.getByRole('button', { name: 'HYROX', exact: true }).click();
    await planForm.getByRole('button', { name: freeDay, exact: true }).click();
    await planForm.getByLabel('Planned minutes').fill('60');
    await planForm.getByRole('button', { name: /ADD TO MY PLAN/ }).click();
    await page.locator(`[data-workout-day="${freeDay}"]`).getByText('HYROX · 60 min').waitFor();
    const split = JSON.parse(writes.filter(w => w.table === 'workout_splits').at(-1).body);
    assert.deepEqual(split.sessions.at(-1), { name: 'HYROX', kind: 'activity', activityType: 'hyrox', days: [freeDay], duration_mins: 60, exercises: [], approval: { approved: true } });
  } else if (scenario === 'activitynextup') {
    // A planned activity due today: Next up logs it in one tap.
    await page.getByTestId('next-up-title').filter({ hasText: 'HYROX' }).waitFor();
    assert.match(await page.getByTestId('next-up').textContent(), /Today's activity/);
    await page.getByTestId('next-up-action').click();
    const form = page.getByTestId('activity-form');
    await form.waitFor({ timeout: 10000 });
    assert.equal(await form.getByLabel('Minutes').inputValue(), '60');
    assert.equal(await form.getByRole('button', { name: 'HYROX', exact: true }).getAttribute('aria-pressed'), 'true');
    await form.getByRole('button', { name: /SAVE ACTIVITY/ }).click();
    await page.getByText(/HYROX logged · 60 min · Moderate/).waitFor();
  } else if (scenario === 'smallfixes') {
    // Photos: the empty message fits an account that already checks in.
    await page.getByText('PROGRESS PHOTOS').scrollIntoViewIfNeeded();
    await page.getByText(/No front photos yet\. They.ll show up here after you add photos in a morning check-in\./).waitFor();
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    // One length for the session everywhere: the weekly plan and the preview.
    await page.locator(`[data-workout-day="${dayCodes[todayDow]}"]`).getByText('Upper A · 30 min').waitFor();
    await page.getByRole('button', { name: 'View Upper A exercises' }).click();
    await page.getByTestId('plan-preview').getByText(/· 30 MIN/).waitFor();
    await page.keyboard.press('Escape');
    // Dates read as dates, not 2026-11-30.
    await page.getByText(/REVIEW FROM 30 NOV/).waitFor();
    await page.getByText('WORKOUT HISTORY').click();
    await page.getByText('Upper A').last().click();
    const header = (await page.getByRole('button', { name: 'Close workout history' }).locator('xpath=../..').textContent());
    assert.doesNotMatch(header, /\d{4}-\d{2}-\d{2}/, header);
    await page.getByRole('button', { name: 'Close workout history' }).click();
    await openNutrition();
    await page.getByText('NUTRITION HISTORY').click();
    const history = await page.getByText('NUTRITION HISTORY').locator('xpath=../..').textContent();
    assert.doesNotMatch(history, /\d{4}-\d{2}-\d{2}/, 'nutrition history dates are readable');
  } else if (scenario === 'nutritionorder') {
    await openNutrition();
    // Morning and Fitness stay mounted (hidden), so only visible cards count.
    const first = page.locator('.t3d-main .t3d-card:visible').first();
    await first.waitFor();
    await page.getByTestId('nutrition-today').waitFor();
    const cardInfo = await page.locator('.t3d-main .t3d-card:visible').evaluateAll(cards => cards.slice(0, 4).map(card => `${card.dataset.testid || '-'}:${(card.textContent || '').slice(0, 40)}`));
    assert.equal(cardInfo[0].split(':')[0], 'nutrition-today', `logging is the first card: ${cardInfo.join(' | ')}`);
    if (process.env.SHOT) await page.screenshot({ path: 'nutrition-top.png' });
    await first.getByText('LOG AS YOU GO').waitFor();
    await first.getByRole('button', { name: /DAY REVIEW/ }).waitFor();
    // A rest day with no separate rest day meals still lists the meals.
    await first.getByRole('button', { name: 'REST DAY', exact: true }).click();
    assert.equal(await first.getByRole('button', { name: /went to plan/ }).count(), 3, 'rest day shows the training meals');
    await first.getByRole('button', { name: 'Breakfast went to plan' }).click();
    await first.getByText('SAVED').waitFor();
    const saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(saved.total_calories, 600);
    assert.equal(saved.is_training_day, false);
  } else if (scenario === 'dashlog') {
    const card = page.getByTestId('dashboard-meal-log');
    await card.getByText('LOG AS YOU GO').waitFor();
    const order = await page.locator('.t3d-main .t3d-card .t3d-ctitle').allTextContents();
    assert.ok(order.indexOf('LOG AS YOU GO') === order.indexOf('DO YOUR DAILY HABITS') + 1, `log sits under the habits: ${order.join(' | ')}`);
    await card.getByText('REST DAY MEALS').waitFor();
    if (process.env.SHOT) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'dash-log.png' }); }
    // Two quick ticks: one row for today, then an update to that row.
    await card.getByRole('button', { name: 'Breakfast went to plan' }).click();
    await card.getByRole('button', { name: 'Lunch went to plan' }).click();
    await card.getByText('SAVED').waitFor();
    await page.waitForTimeout(400);
    const logWrites = writes.filter(w => w.table === 'nutrition_logs');
    assert.equal(logWrites.length, 2, JSON.stringify(logWrites.map(w => w.method)));
    assert.equal(logWrites[0].method, 'POST');
    const firstBody = JSON.parse(logWrites[0].body);
    assert.deepEqual(firstBody.meals_completed, { 0: true, _review_complete: false });
    assert.equal(firstBody.total_calories, 600);
    assert.equal(firstBody.off_plan_food, '');
    assert.equal(logWrites[1].method, 'PATCH');
    assert.match(decodeURIComponent(logWrites[1].url), /id=eq\.log-new/);
    assert.equal(JSON.parse(logWrites[1].body).total_calories, 1300);
    await page.getByText(/1,300/).first().waitFor();
  } else if (scenario === 'libraryedit') {
    await openNutrition();
    const rows = page.getByTestId('library-meal');
    await rows.filter({ hasText: 'Protein Pancakes' }).waitFor();
    // Each meal shows once: plan meals are in LOG AS YOU GO, not the library.
    assert.equal(await rows.filter({ hasText: 'Breakfast' }).count(), 0);
    assert.equal(await page.getByText('TRAINING DAY MEALS', { exact: true }).count(), 0, 'no separate meal list');
    await page.getByRole('button', { name: "Breakfast: what's in it" }).click();
    await page.getByTestId('meal-details').getByText('600 kcal').waitFor();
    await page.getByRole('button', { name: 'Edit Protein Pancakes' }).click();
    const nameInput = page.getByPlaceholder('Meal name');
    assert.equal(await nameInput.inputValue(), 'Protein Pancakes');
    const kcal = page.locator('label').filter({ hasText: /^KCAL$/ }).locator('input');
    await kcal.fill('500');
    await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
    await page.waitForTimeout(400);
    let library = JSON.parse(writes.filter(w => w.table === 'nutrition_plans').at(-1).body).meal_library;
    assert.equal(library.find(m => m.name === 'Protein Pancakes').calories, 500);
    assert.equal(library.find(m => m.name === 'Protein Pancakes').id, 'lib1', 'same meal, not a copy');
    assert.equal(library.length, 4);
    await page.getByRole('button', { name: 'Edit Protein Pancakes' }).click();
    await page.getByRole('button', { name: 'DELETE FROM LIBRARY' }).click();
    await page.waitForTimeout(400);
    library = JSON.parse(writes.filter(w => w.table === 'nutrition_plans').at(-1).body).meal_library;
    assert.equal(library.some(m => m.name === 'Protein Pancakes'), false);
    // Plan meals are edited in the meal plan.
    await page.getByRole('button', { name: 'EDIT MEAL PLAN →' }).click();
    await page.getByText('ABOUT YOUR DAY').waitFor();
    await page.getByRole('button', { name: 'Edit Breakfast' }).waitFor();
  } else if (scenario === 'restdaybuild' || scenario === 'restdayai') {
    await openNutrition();
    await page.getByTestId('plan-training').getByRole('button', { name: 'EDIT MEALS' }).first().click();
    const choice = page.getByTestId('rest-day-choice');
    await choice.getByText('On days with no workout, eat:').waitFor();
    await choice.getByRole('button', { name: 'DIFFERENT REST DAY MEALS' }).click();
    const start = page.getByTestId('rest-day-start');
    await start.waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'rest-start.png', fullPage: true });
    if (scenario === 'restdaybuild') {
      await start.getByRole('button', { name: /Copy my training day meals/ }).click();
      await page.getByText('REST DAY MEALS', { exact: true }).waitFor();
      if (process.env.SHOT) await page.screenshot({ path: 'rest-list.png', fullPage: true });
      await page.getByRole('button', { name: 'Remove Dinner' }).click();
      assert.equal(await page.getByRole('button', { name: /^Remove / }).count(), 2);
      // 1,300 kcal is below the 1,350 kcal daily minimum (sex not given), so it has to be raised.
      await page.getByTestId('meals-below-minimum').getByText(/Your rest day meals add up to 1,300 kcal, below the minimum of 1,350 kcal a day when sex isn't given/).waitFor();
      await page.getByRole('button', { name: '+ ADD MEAL' }).click();
      await page.getByPlaceholder('e.g. Chicken & Rice').fill('Fruit & Yoghurt');
      await page.locator('input[placeholder="0"]').first().fill('150');
      await page.getByRole('button', { name: 'ADD MEAL ✓' }).click();
      assert.equal(await page.getByTestId('meals-below-minimum').count(), 0);
    } else {
      await start.getByRole('button', { name: /AI: lighter version of my training day/ }).click();
      await page.getByText('Rest Chicken Salad').waitFor();
      const request = chats.find(c => c.area === 'rest_day_plan').messages[0].content;
      assert.match(request, /REST DAY plan/);
      assert.match(request, /Targets: 1850 kcal/, 'the rest day target: about 12% lighter than 2,100');
      assert.match(request, /Allergies: none reported|ALLERGIES/);
    }
    // The training day tab is one tap away and REVIEW is always there.
    await page.getByRole('tab', { name: 'TRAINING DAYS' }).click();
    await page.getByRole('button', { name: 'Edit Dinner' }).waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'rest-choice.png', fullPage: true });
    await page.getByRole('button', { name: 'REVIEW →' }).click();
    await page.getByText('REVIEW YOUR PLAN').waitFor();
    await page.getByRole('button', { name: /SAVE PLAN/ }).click();
    await page.getByRole('button', { name: 'EDIT PLAN' }).waitFor();
    const saved = JSON.parse(writes.filter(w => w.table === 'nutrition_plans' && JSON.parse(w.body).daily_calories).at(-1).body);
    assert.equal(saved.meals.length, 3);
    assert.deepEqual(saved.rest_day_meals.map(m => m.name).sort(), scenario === 'restdaybuild' ? ['Breakfast', 'Fruit & Yoghurt', 'Lunch'] : ['Rest Chicken Salad', 'Rest Oats', 'Rest Salmon & Veg']);
  } else if (scenario === 'weeklybadge') {
    if (todayDow === 0) { console.log('PASS weeklybadge (Sunday: the week is still in progress)'); await browser.close(); return; }
    const card = page.getByTestId('weekly-report-card');
    await card.getByTestId('weekly-new-badge').waitFor();
    const firstCard = page.locator('.t3d-main .t3d-card').first();
    assert.equal(await firstCard.getAttribute('data-testid'), 'weekly-report-card', 'new report is at the very top');
    await card.getByText('NEW WEEKLY REPORT').waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'weekly-new.png' });
    await card.getByRole('button', { name: 'OPEN WEEKLY REPORT →' }).click();
    await page.getByTestId('weekly-recap').waitFor();
    await page.getByRole('button', { name: '← BACK', exact: true }).click();
    await page.getByTestId('weekly-report-card').waitFor();
    assert.equal(await page.getByTestId('weekly-new-badge').count(), 0, 'no badge once opened');
    assert.notEqual(await page.locator('.t3d-main .t3d-card').first().getAttribute('data-testid'), 'weekly-report-card', 'back in its usual place');
    await page.getByTestId('weekly-report-card').getByText('YOUR WEEK').waitFor();
  } else if (scenario === 'fitnessrest') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    const rest = page.getByTestId('rest-day');
    await rest.getByText('REST DAY', { exact: true }).waitFor();
    await rest.getByText(/Nothing is scheduled today. Rest is part of the plan./).waitFor();
    assert.equal(await page.getByText('RECOMMENDED NEXT SESSION').count(), 0);
    assert.equal(await page.getByRole('button', { name: '▶ START WORKOUT' }).count(), 0, 'no big start button on a rest day');
    // The next day of the plan is the main suggestion (Push A is on Tuesdays; today is Wednesday).
    const next = rest.getByTestId('next-session');
    await next.getByText('NEXT SESSION · TUESDAY').waitFor();
    await next.getByText('Push A', { exact: true }).waitFor();
    // Yesterday's miss (this week) is only a small optional catch-up.
    await rest.getByTestId('catch-up').filter({ hasText: 'Catch up Push A (missed Tuesday)' }).waitFor();
    await next.getByRole('button', { name: 'View Push A exercises' }).click();
    const sheet = page.getByTestId('plan-preview');
    await sheet.getByText('NEXT SESSION', { exact: true }).waitFor();
    assert.match(await sheet.textContent(), /Dumbbell Shoulder Press4 × 10/);
    if (process.env.SHOT) await page.screenshot({ path: 'fitness-rest.png' });
  } else if (scenario === 'fitnesslastweek') {
    // Monday: Friday's Push A was missed last week. It isn't carried over.
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    const rest = page.getByTestId('rest-day');
    await rest.getByText('REST DAY', { exact: true }).waitFor();
    await rest.getByTestId('next-session').getByText('NEXT SESSION · WEDNESDAY').waitFor();
    await rest.getByTestId('next-session').getByText('Pull A', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('catch-up').count(), 0, 'no catch-up from last week');
    assert.doesNotMatch(await rest.textContent(), /Push A/);
  } else if (scenario === 'fitnessmissed') {
    // Wednesday: today's Pull A leads; Monday's missed Push A is a small option.
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByText('Scheduled for today').waitFor();
    await page.getByText('Pull A', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: '▶ START WORKOUT' }).waitFor();
    assert.equal(await page.getByText(/Make-up session/).count(), 0);
    const catchUp = page.getByTestId('catch-up');
    await catchUp.getByText('Missed Push A on Monday?').waitFor();
    await catchUp.getByRole('button', { name: 'Do it today instead' }).click();
    await page.getByText('SET 1 OF 3').waitFor();
    await page.getByText('Bench Press').first().waitFor();
  } else if (scenario === 'repsplit') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: '▶ START WORKOUT' }).click();
    await page.getByText('SET 1 OF 4').waitFor();
    await page.getByText('REP RANGE: 6-8').waitFor();
    assert.equal(await page.getByText(/6-8,6-8/).count(), 0, 'the whole list never shows as one target');
    // No history: aim for the top of the range, shown faintly.
    assert.equal(await page.getByLabel('Reps').getAttribute('placeholder'), '8');
    await page.getByLabel('Weight in kilograms').fill('60');
    for (const target of ['6-8', '8', '10']) {
      await page.getByRole('button', { name: 'Log set' }).click();
      await page.getByText(`REP RANGE: ${target}`).waitFor();
    }
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByText('SET 1 OF 3').waitFor();
    await page.getByText('REP RANGE: 8-10').waitFor();
    // The workout saves in the background: wait for the save with all four sets.
    const withFour = () => writes.filter(w => w.table === 'workout_logs' && w.body && (JSON.parse(w.body).exercises || [])[0]?.sets?.length === 4);
    for (let i = 0; i < 50 && !withFour().length; i++) await page.waitForTimeout(100);
    assert.ok(withFour().length, 'all four sets saved');
    const saved = JSON.parse(withFour().at(-1).body);
    assert.deepEqual(saved.exercises[0].sets.map(set => set.repRange), ['6-8', '6-8', '8', '10']);
  } else if (scenario === 'mealswap') {
    await openNutrition();
    const log = page.getByTestId('nutrition-today');
    // The swap shows at once and saves just after: wait for the save itself.
    const logWrites = () => writes.filter(w => w.table === 'nutrition_logs');
    const nextLogWrite = async count => {
      for (let i = 0; i < 50 && logWrites().length <= count; i++) await page.waitForTimeout(100);
      assert.ok(logWrites().length > count, 'saved');
      return JSON.parse(logWrites().at(-1).body);
    };
    let count = logWrites().length;
    if (process.env.SHOT) { await log.getByRole('button', { name: 'Swap Lunch' }).waitFor(); await page.screenshot({ path: 'swap-closed.png' }); }
    await log.getByRole('button', { name: 'Swap Lunch' }).click();
    const panel = log.getByTestId('swap-panel');
    await panel.getByText('SWAP LUNCH FOR').waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'swap.png' });
    // Library meals are offered, not the planned meal itself.
    assert.equal(await panel.getByTestId('swap-option').filter({ hasText: /^Lunch/ }).count(), 0);
    await panel.getByTestId('swap-option').filter({ hasText: 'Protein Pancakes' }).click();
    await log.getByTestId('meal-swapped').filter({ hasText: 'Swapped for Protein Pancakes · 450 kcal · 35g P' }).waitFor();
    let saved = await nextLogWrite(count);
    assert.deepEqual(saved.meals_completed[1], { completed: true, swap: { name: 'Protein Pancakes', calories: 450, protein: 35, carbs: 50, fats: 9 } });
    assert.equal(saved.total_calories, 450);
    assert.equal(await log.getByRole('button', { name: 'Swap Lunch' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await log.getByRole('button', { name: 'Lunch went to plan' }).getAttribute('aria-pressed'), 'false');
    if (process.env.SHOT) await page.screenshot({ path: 'swap-done.png' });
    // Make your own; it is kept in the library for next time.
    count = logWrites().length;
    await log.getByRole('button', { name: 'Swap Dinner' }).click();
    await panel.getByLabel('Swap meal name').fill('Chicken wrap');
    await panel.getByLabel('Swap meal KCAL').fill('600');
    await panel.getByLabel('Swap meal P (g)').fill('40');
    await panel.getByRole('button', { name: 'SWAP IT IN ✓' }).click();
    await log.getByTestId('meal-swapped').filter({ hasText: 'Swapped for Chicken wrap · 600 kcal · 40g P' }).waitFor();
    saved = await nextLogWrite(count);
    assert.equal(saved.total_calories, 1050);
    assert.equal(saved.total_protein, 75);
    for (let i = 0; i < 20 && !writes.some(w => w.table === 'nutrition_plans' && /Chicken wrap/.test(w.body || '')); i++) await page.waitForTimeout(100);
    const library = JSON.parse(writes.filter(w => w.table === 'nutrition_plans' && /Chicken wrap/.test(w.body || '')).at(-1).body).meal_library;
    assert.deepEqual(library.map(meal => meal.name).sort(), ['Breakfast', 'Chicken wrap', 'Dinner', 'Lunch', 'Protein Pancakes']);
    // Undo: Lunch is not answered any more.
    count = logWrites().length;
    await log.getByRole('button', { name: 'Swap Lunch' }).click();
    await log.getByTestId('swap-panel').getByRole('button', { name: 'UNDO SWAP' }).click();
    saved = await nextLogWrite(count);
    assert.equal(saved.meals_completed[1], undefined);
    assert.equal(saved.total_calories, 600);
    assert.equal(await log.getByTestId('meal-swapped').count(), 1);
  } else if (scenario === 'stalework') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByText('WORKOUT HISTORY').click();
    // The old row closed hours late shows a capped length; yesterday's ends at its last set.
    const history = page.locator('.t3d-card').filter({ hasText: 'WORKOUT HISTORY' });
    await history.getByText('45 mins').first().waitFor();
    await history.getByText('14 mins').first().waitFor();
    assert.equal(await history.getByText('345 mins').count(), 0);
    // Starting today's workout closes yesterday's with the time it really took.
    await page.getByRole('button', { name: '▶ START WORKOUT' }).click();
    await page.getByText('SET 1 OF 3').waitFor();
    const closed = writes.find(w => w.table === 'workout_logs' && w.method === 'PATCH' && /stale1/.test(w.url));
    assert.ok(closed, 'yesterday closed');
    assert.deepEqual(JSON.parse(closed.body), { in_progress: false, duration_mins: 14 });
  } else if (scenario === 'exercisealias') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: '▶ START WORKOUT' }).click();
    await page.getByText('SET 1 OF 3').waitFor();
    // Last time this was logged as "Dumbbell Goblet Squat": 18 kg carries over.
    assert.equal(await page.getByLabel('Weight in kilograms').getAttribute('placeholder'), '18');
    await page.getByText(/LAST TIME/).first().waitFor();
  } else if (scenario === 'weekcount') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByTestId('week-sessions').waitFor();
    assert.equal(await page.getByTestId('week-sessions').textContent(), '2');
    await page.getByText('SESSIONS · 1 ACTIVITY').waitFor();
    if (process.env.SHOT) { await page.getByText('SESSIONS · 1 ACTIVITY').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'weekcount.png' }); }
    // Log an activity, then add one to the plan: the confirmation is for the plan.
    await page.getByTestId('log-activity').click();
    const form = page.getByTestId('activity-form');
    await form.getByRole('button', { name: 'WALK', exact: true }).click();
    await form.getByLabel('Minutes').fill('30');
    await form.getByRole('button', { name: /SAVE ACTIVITY/ }).click();
    await page.getByText('Walk logged · 30 min · Moderate').waitFor();
    await page.getByTestId('plan-add-activity').click();
    const planForm = page.getByTestId('plan-activity-form');
    await planForm.getByRole('button', { name: 'HYROX', exact: true }).click();
    await planForm.getByRole('button', { name: freeDay, exact: true }).click();
    await planForm.getByLabel('Planned minutes').fill('60');
    await planForm.getByRole('button', { name: /ADD TO MY PLAN/ }).click();
    await page.getByTestId('plan-notice').getByText(`HYROX added to your plan on ${freeDay.charAt(0) + freeDay.slice(1).toLowerCase()} · 60 min`).waitFor();
    assert.equal(await page.getByText('Walk logged · 30 min · Moderate').count(), 0, 'the old message is gone');
  } else if (scenario === 'weeklystale') {
    await page.getByRole('button', { name: 'OPEN WEEKLY REPORT →' }).click();
    const recap = page.getByTestId('weekly-recap');
    await recap.waitFor();
    // Figures: two workouts plus the run, no plan to compare against.
    const workoutsTile = recap.getByTestId('tile-workouts');
    await workoutsTile.getByText('No weekly plan to compare against · plus 1 activity (45 min)').waitFor();
    assert.equal((await workoutsTile.textContent()).includes('WORKOUTS COMPLETED2'), true);
    // The old coach text is rewritten for these figures, and saved with them.
    await recap.getByTestId('recap-coach').getByText('You trained twice.').waitFor({ timeout: 10000 });
    assert.equal(await recap.getByText(/half the volume on the table/).count(), 0);
    const saved = writes.filter(w => w.table === 'weekly_reports').at(-1);
    assert.match(JSON.parse(saved.body).patterns, /\n\nFACTS: \w+$/);
    assert.equal(chats.filter(chat => chat.area === 'weekly_summary').length, 1);
    // Streaks as they stood at the end of that week, not this week's.
    await recap.getByTestId('tile-habit-streak').getByText('HABIT STREAK AT WEEK END').waitFor();
    assert.match(await recap.getByTestId('tile-habit-streak').textContent(), /🔥 0d/);
    assert.match(await recap.getByTestId('tile-mornings').textContent(), /streak at week end 2d/);
    if (process.env.SHOT) { await recap.getByTestId('tile-workouts').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'weeklystale.png', animations: 'disabled' }); await recap.getByTestId('recap-coach').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'weeklystale2.png', animations: 'disabled' }); }
  } else if (scenario === 'mealswapdash') {
    const card = page.getByTestId('dashboard-meal-log');
    await card.getByText('LOG AS YOU GO').waitFor();
    await card.getByRole('button', { name: 'Swap Breakfast' }).click();
    await card.getByTestId('swap-option').filter({ hasText: 'Protein Pancakes' }).click();
    await card.getByTestId('meal-swapped').filter({ hasText: 'Swapped for Protein Pancakes · 450 kcal · 35g P' }).waitFor();
    for (let i = 0; i < 50 && !writes.some(w => w.table === 'nutrition_logs'); i++) await page.waitForTimeout(100);
    const saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.equal(saved.meals_completed[0].swap.name, 'Protein Pancakes');
    assert.equal(saved.total_calories, 450);
    // A made-up meal is added to the library from the dashboard too.
    await card.getByRole('button', { name: 'Swap Lunch' }).click();
    await card.getByTestId('swap-panel').getByLabel('Swap meal name').fill('Sushi');
    await card.getByTestId('swap-panel').getByLabel('Swap meal KCAL').fill('500');
    await card.getByTestId('swap-panel').getByRole('button', { name: 'SWAP IT IN ✓' }).click();
    await card.getByTestId('meal-swapped').filter({ hasText: 'Swapped for Sushi · 500 kcal' }).waitFor();
    for (let i = 0; i < 20 && !writes.some(w => w.table === 'nutrition_plans' && /Sushi/.test(w.body || '')); i++) await page.waitForTimeout(100);
    assert.ok(writes.some(w => w.table === 'nutrition_plans' && w.method === 'PATCH' && /Sushi/.test(w.body || '')), 'library saved');
  } else if (scenario === 'headerprofile') {
    await page.getByRole('button', { name: 'PROFILE', exact: true }).click();
    const dialog = page.getByTestId('profile-dialog');
    await dialog.getByLabel('Height (cm)').waitFor();
    await dialog.getByLabel('Height (cm)').fill('176');
    await dialog.getByLabel('Date of birth').fill(bornYearsAgo(31));
    await dialog.getByRole('button', { name: 'MALE', exact: true }).click();
    await dialog.getByRole('button', { name: /^ADVANCED/ }).click();
    if (process.env.SHOT) await page.screenshot({ path: 'profile-dialog.png' });
    await dialog.getByRole('button', { name: 'SAVE PROFILE' }).click();
    await page.getByTestId('profile-dialog').waitFor({ state: 'detached' });
    assert.equal(JSON.parse(writes.filter(w => w.table === 'coach_profiles').at(-1).body).experience_level, 'advanced');
    assert.equal(JSON.parse(writes.filter(w => w.table === 'user_profiles').at(-1).body).height_cm, 176);
    await page.getByTestId('profile-todo').getByText('(done)').waitFor({ state: 'attached' });
  } else if (scenario === 'profiletodo' || scenario === 'profiletodofail') {
    const todo = page.getByTestId('profile-todo');
    await todo.getByText('Complete your profile').waitFor();
    await todo.getByRole('button', { name: 'START →' }).click();
    const form = page.getByTestId('profile-form');
    assert.equal(await form.getByLabel('Height (cm)').inputValue(), '170', 'what the profile has is filled in');
    const save = form.getByRole('button', { name: 'SAVE PROFILE' });
    assert.equal(await save.isDisabled(), true);
    await form.getByLabel('Date of birth').fill(bornYearsAgo(29));
    await form.getByRole('button', { name: 'PREFER NOT TO SAY' }).click();
    await form.getByText(/average of the male and female results/).waitFor();
    // Any part can be saved; the form says what's still missing.
    assert.equal(await save.isDisabled(), false, 'saving part of the profile is fine');
    assert.match(await form.getByTestId('profile-missing').textContent(), /Still to add: training experience/);
    await form.getByRole('button', { name: /^INTERMEDIATE/ }).click();
    if (process.env.SHOT) { await page.waitForTimeout(600); await page.screenshot({ path: 'prof-todo.png' }); }
    await save.click();
    if (scenario === 'profiletodofail') {
      await form.getByText(/the database needs the latest update/).waitFor();
      assert.equal(await page.getByTestId('profile-form').count(), 1, 'form stays open');
    } else {
      await page.getByTestId('profile-form').waitFor({ state: 'detached' });
      const body = JSON.parse(writes.filter(w => w.table === 'user_profiles').at(-1).body);
      assert.equal(body.user_id, user.id);
      assert.equal(body.height_cm, 170);
      assert.equal(body.date_of_birth, bornYearsAgo(29));
      assert.equal(body.sex, 'prefer_not_to_say');
      assert.match(writes.filter(w => w.table === 'user_profiles').at(-1).url, /on_conflict=user_id/);
      const coach = JSON.parse(writes.filter(w => w.table === 'coach_profiles').at(-1).body);
      assert.equal(coach.experience_level, 'intermediate', 'level saved with the profile');
      await todo.getByText('(done)').waitFor({ state: 'attached' });
    }
  } else if (scenario === 'profileprefill' || scenario === 'profilepartial') {
    await openNutrition();
    await openTargets();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    await page.getByLabel('WEIGHT (kg)').fill('70');
    const summary = page.getByTestId('profile-summary');
    if (scenario === 'profileprefill') {
      assert.equal((await summary.textContent()).replace(/\s+/g, ' ').trim(), `From your profile: 175 cm · born 1 Jan ${bornYearsAgo(40).slice(0, 4)} (age 40) · Prefer not to say – edit`);
      assert.equal(await page.getByLabel('HEIGHT (cm)').count(), 0, 'not asked again');
      assert.equal(await page.getByLabel('DATE OF BIRTH').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'PREFER NOT TO SAY' }).count(), 0);
      await page.getByTestId('sex-average-note').waitFor();
      if (process.env.SHOT) await page.screenshot({ path: 'prof-prefill.png', fullPage: true });
      await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
      await page.getByText(/Based on 70 kg, 175 cm, age 40, sex not given \(average of male and female\)/).waitFor();
      await page.waitForTimeout(300);
      assert.equal(writes.filter(w => w.table === 'user_profiles').length, 0, 'nothing changed, nothing saved');
      await page.getByRole('button', { name: '← BACK', exact: true }).click();
      await summary.getByRole('button', { name: 'edit' }).click();
      assert.equal(await page.getByLabel('HEIGHT (cm)').inputValue(), '175');
      assert.equal(await page.getByLabel('DATE OF BIRTH').inputValue(), bornYearsAgo(40));
      assert.equal(await page.getByRole('button', { name: 'PREFER NOT TO SAY' }).count(), 1);
    } else {
      assert.equal((await summary.textContent()).replace(/\s+/g, ' ').trim(), 'From your profile: 182 cm – edit');
      assert.equal(await page.getByLabel('HEIGHT (cm)').count(), 0);
      await page.getByLabel('DATE OF BIRTH').fill(bornYearsAgo(25));
      await page.getByRole('button', { name: 'MALE', exact: true }).click();
      await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
      await page.getByText(/Based on 70 kg, 182 cm, age 25, male/).waitFor();
      await page.waitForTimeout(300);
      const body = JSON.parse(writes.filter(w => w.table === 'user_profiles').at(-1).body);
      assert.equal(body.height_cm, undefined, 'height unchanged, not re-sent');
      assert.equal(body.date_of_birth, bornYearsAgo(25));
      assert.equal(body.sex, 'male');
    }
  } else if (scenario === 'nutritionnocolumn') {
    await openNutrition();
    await openTargets();
    await page.getByLabel('DATE OF BIRTH').fill(bornYearsAgo(34));
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByRole('button', { name: 'NEXT: BUILD MEALS →' }).click();
    await page.getByRole('button', { name: 'REVIEW →' }).click();
    await page.getByRole('button', { name: /SAVE PLAN/ }).click();
    await page.getByRole('button', { name: 'EDIT PLAN' }).waitFor();
    const attempts = writes.filter(w => w.table === 'nutrition_plans' && JSON.parse(w.body).daily_calories);
    assert.equal(attempts.length, 2);
    assert.ok(JSON.parse(attempts[0].body).setup);
    assert.equal(JSON.parse(attempts[1].body).setup, undefined, 'saved again without the setup column');
    assert.equal(JSON.parse(attempts[1].body).goal, 'Lose fat');
  } else if (scenario === 'nutritionedit') {
    await openNutrition();
    await openTargets();
    assert.equal(await page.getByLabel('WEIGHT (kg)').inputValue(), '82');
    assert.equal(await page.getByLabel('HEIGHT (cm)').inputValue(), '180', 'height from the last setup');
    // The old setup stored an age, not a date of birth, so only that is asked.
    assert.equal(await page.getByLabel('DATE OF BIRTH').inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).isDisabled(), true);
    await page.getByLabel('DATE OF BIRTH').fill(bornYearsAgo(34));
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByText(/Based on 82 kg, 180 cm, age 34, male · Lose fat · Lightly active/).waitFor();
    // What was entered is saved back to the profile (the save may land just after the text).
    for (let i = 0; i < 30 && !writes.some(w => w.table === 'user_profiles'); i++) await page.waitForTimeout(100);
    const profileSave = writes.filter(w => w.table === 'user_profiles').map(w => JSON.parse(w.body)).at(-1);
    assert.deepEqual({ ...profileSave, updated_at: undefined }, { user_id: user.id, height_cm: 180, date_of_birth: bornYearsAgo(34), sex: 'male', updated_at: undefined });
    await page.getByRole('button', { name: 'NEXT: BUILD MEALS →' }).click();
    assert.equal(await page.getByLabel('Wake-up time').inputValue(), '06:15');
    assert.equal(await page.getByLabel('Allergies or intolerances').inputValue(), 'peanuts');
    await page.getByRole('button', { name: 'REVIEW →' }).click();
    await page.getByRole('button', { name: /SAVE PLAN/ }).click();
    await page.getByRole('button', { name: 'EDIT PLAN' }).waitFor();
    // The old meals now miss the new protein target, and the page says so.
    assert.match((await page.getByTestId('plan-target-gap').textContent()).replace(/\s+/g, ' '), /Your training day meals add up to 2,100 kcal and 135 g protein: 45 g protein under your targets of 2,000 kcal and 180 g protein\./);
    const saved = planWrite();
    assert.equal(saved.goal, 'Lose fat', 'goal kept, not Maintain');
    assert.equal(saved.setup.weight, 82);
    assert.equal(saved.setup.answers.allergies, 'peanuts');
    // Mifflin-St Jeor 1780 x 1.375 = 2448, minus 0.5% of 82 kg a week (451/day) = 1997
    assert.equal(saved.daily_calories, 2000);
    assert.equal(saved.protein_target, 180);
  } else if (scenario === 'nutritionlegacy') {
    await openNutrition();
    await openTargets();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    assert.equal(await page.getByLabel('WEIGHT (kg)').inputValue(), '79.5', 'weight from last weigh-in');
    await page.getByText('Weight from your last morning check-in.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).isDisabled(), true, 'needs height, age, sex');
    await page.getByLabel('HEIGHT (cm)').fill('175');
    await page.getByLabel('DATE OF BIRTH').fill(bornYearsAgo(40));
    await page.getByRole('button', { name: 'FEMALE' }).click();
    if (process.env.SHOT) await page.screenshot({ path: 'nut-goals.png', fullPage: true });
    const activity = await page.getByTestId('activity-option').first().textContent();
    assert.match(activity, /Desk job/, 'activity levels are described');
    assert.match(activity, /≈ [\d,]+ kcal/, 'each level shows its calories');
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByText(/Based on 79.5 kg, 175 cm, age 40, female · Lose fat/).waitFor();
  } else if (scenario === 'nutritionai') {
    await openNutrition();
    await page.getByRole('button', { name: 'SET UP MY NUTRITION' }).click();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    await page.getByLabel('WEIGHT (kg)').fill('80');
    await page.getByLabel('HEIGHT (cm)').fill('180');
    await page.getByLabel('DATE OF BIRTH').fill(bornYearsAgo(30));
    await page.getByRole('button', { name: 'MALE', exact: true }).click();
    await page.getByRole('button', { name: /^LEAN BULK/ }).click();
    await page.getByRole('button', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    // Targets and structure are on their own screen; build methods are not.
    await page.getByText('HOW MUCH STRUCTURE DO YOU WANT?').waitFor();
    assert.equal(await page.getByText('AI build my meal plan').count(), 0);
    await page.getByRole('button', { name: /SAME MEALS DAILY/ }).click();
    await page.getByRole('button', { name: 'NEXT: BUILD MEALS →' }).click();
    assert.equal(await page.getByLabel('Wake-up time').inputValue(), '05:30', 'wake time from the morning routine');
    await page.getByText(/Meals will run from 06:30 to 18:30/).waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'nut-meals.png', fullPage: true });
    await page.getByText('AI build my meal plan').click();
    await page.getByText('QUESTION 1 OF 5').waitFor();
    await page.getByText('Any food allergies or intolerances?').waitFor();
    assert.equal(await page.getByRole('button', { name: 'NEXT →' }).isDisabled(), true, 'allergy answer required');
    await page.getByPlaceholder(/peanuts, lactose/).last().fill('lactose');
    await page.getByRole('button', { name: 'NEXT →' }).click();
    await page.getByRole('button', { name: 'No restrictions' }).click();
    await page.getByText('Any foods you dislike or want to avoid?').waitFor();
    await page.getByRole('button', { name: 'NEXT →' }).click();
    await page.getByRole('button', { name: 'NEXT →' }).click();
    await page.getByRole('button', { name: 'About 30 minutes' }).click();
    await page.getByText('OPTIONAL').waitFor();
    await page.getByRole('button', { name: 'SKIP — BUILD MY PLAN' }).click();
    await page.getByText('Oat Porridge').waitFor();
    const builds = chats.filter(c => c.area === 'meal_plan_build');
    assert.equal(builds.length, 2, 'dairy plan sent back once');
    const msgs = builds[1].messages;
    assert.match(msgs[0].content, /ALLERGIES — the user is allergic or intolerant to: lactose/);
    assert.match(msgs[0].content, /Goal: Lean bulk/);
    assert.match(msgs[0].content, /wakes at 05:30; use these meal times in order: 06:30, 12:30, 18:30/);
    assert.match(msgs[0].content, /Any dietary preference\? No restrictions/);
    assert.doesNotMatch(msgs[0].content, /tracking nutrition|meals per day do you prefer|days per week do you train/);
    assert.match(msgs.at(-1).content, /allergic or intolerant to: Greek Yoghurt Bowl/, 'dairy plan sent back');
    assert.equal(await page.getByText('Greek Yoghurt Bowl').count(), 0);
    const cards = await page.locator('body').textContent();
    assert.match(cards, /Oat Porridge · 06:30/);
    // A tweak that adds cheese is caught and flagged.
    await page.getByPlaceholder('Describe your changes...').fill('add a cheese omelette');
    await page.getByRole('button', { name: 'APPLY' }).click();
    await page.getByText(/Contains foods you listed as allergies/).first().waitFor();
    const tweaks = chats.filter(c => c.area === 'meal_plan_tweak');
    assert.match(tweaks[0].messages[0].content, /ALLERGIES — the user is allergic or intolerant to: lactose/, 'tweaks see allergies');
    assert.ok(await page.getByTestId('meal-allergy').count() >= 1);
    await page.getByRole('button', { name: 'REVIEW →' }).click();
    await page.getByTestId('review-allergy').waitFor();
    if (process.env.SHOT) await page.screenshot({ path: 'nut-review.png', fullPage: true });
    const save = page.getByRole('button', { name: /SAVE PLAN/ });
    assert.equal(await save.isDisabled(), true, 'save blocked until checked');
    await page.getByLabel('I have checked these are safe for me').check();
    await save.click();
    await page.getByRole('button', { name: 'EDIT PLAN' }).waitFor();
    const saved = planWrite();
    assert.equal(saved.goal, 'Lean bulk');
    assert.equal(saved.setup.answers.allergies, 'lactose');
    assert.equal(saved.setup.wakeTime, '05:30');
  } else if (scenario === 'nutritionhistory') {
    await page.getByRole('button', { name: /NUTRITION$/ }).last().click();
    await page.getByText('NUTRITION HISTORY').click();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByText("This page couldn't load").count(), 0);
    const historyText = await page.locator('body').textContent();
    assert.match(historyText, /2\/3|2 of 3|2 meals/i, 'completed meals counted');
  } else if (scenario === 'roundup' || scenario === 'roundupfail') {
    await page.getByRole('button', { name: /END OF DAY CHECK-IN/ }).click();
    const next = () => page.getByRole('button', { name: /^(NEXT →|SEE MY ROUNDUP →)$/ }).click();
    await next();
    await page.getByRole('button', { name: '🙂' }).click(); await next();
    await page.getByRole('button', { name: '🔋' }).click(); await next();
    await next();
    await page.getByRole('button', { name: /Mostly/ }).click(); await next();
    if (scenario === 'roundup') {
      await page.getByText('AI DAILY ROUNDUP').waitFor();
      await page.getByText(/Solid day: two meals on plan/).waitFor();
      const prompt = chats.at(-1).messages[0].content;
      assert.match(prompt, /Nutrition: 1300 kcal, 85g protein, 2 meals on plan, off plan: large pepperoni pizza, two beers/);
      assert.match(prompt, /Calendar: calendar score 7\/10/, 'debrief and calendar not swapped');
    } else {
      await page.getByText("Couldn't write your roundup.").waitFor();
      assert.equal(await page.getByText('AI DAILY ROUNDUP').count(), 0, 'no AI heading over canned text');
      assert.equal(await page.getByText(/Keep pushing/).count(), 0);
      chatFails = false;
      await page.getByRole('button', { name: 'TRY AGAIN' }).click();
      await page.getByText('AI DAILY ROUNDUP').waitFor();
      await page.getByText(/Solid day/).waitFor();
    }
  } else if (scenario === 'weeklysavefail') {
    await page.getByRole('button', { name: 'OPEN WEEKLY REPORT →' }).click();
    await page.getByTestId('weekly-recap').waitFor();
    await page.getByText(/couldn't be saved, so it will be written again/).waitFor({ timeout: 10000 });
    assert.equal(await page.getByText(/schema cache|public\.weekly_reports/).count(), 0, 'no raw database message');
  } else if (scenario === 'painresolve') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    await page.getByRole('button', { name: 'CHAT WITH FITNESS COACH' }).click();
    const input = page.getByPlaceholder('Ask anything...');
    await input.fill('Sharp pain in my left shoulder on that last rep.');
    await input.press('Enter');
    await page.getByText(/Pain noted — the coach won't load that area/).waitFor();
    await page.getByRole('button', { name: 'PAIN RESOLVED' }).click();
    await page.getByText(/Pain marked as resolved/).waitFor();
    const update = writes.find(w => w.table === 'pain_reports' && w.method === 'PATCH');
    assert(update, 'pain report updated');
    assert.equal(JSON.parse(update.body).status, 'resolved');
    assert(decodeURIComponent(update.url).includes('status=neq.resolved'));
    assert.equal(await page.getByRole('button', { name: 'PAIN RESOLVED' }).count(), 0);
  } else if (scenario === 'coachstyle') {
    await page.getByRole('button', { name: 'REVIEW MY DAY SO FAR' }).click();
    await page.getByText(/Solid day/).waitFor();
    const sent = chats.at(-1);
    assert.equal(sent.area, 'dashboard');
    assert.equal(sent.system, undefined, 'no client-written prompt');
    assert.match(sent.context, /User data today/);
    // No settings in the coach: style and level are set once, in the profile.
    assert.equal(await page.getByTestId('coach-settings').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'BACK ME' }).count(), 0);
    await page.getByRole('button', { name: 'PROFILE', exact: true }).click();
    const dialog = page.getByTestId('profile-dialog');
    await dialog.getByText('PROFILE & COACH SETTINGS').waitFor();
    await dialog.getByLabel('Height (cm)').fill('180');
    await dialog.getByLabel('Date of birth').fill('1990-01-01');
    await dialog.getByRole('button', { name: 'MALE', exact: true }).click();
    await dialog.getByRole('button', { name: /^INTERMEDIATE/ }).click();
    await dialog.getByRole('button', { name: /^BACK ME/ }).click();
    await dialog.getByRole('button', { name: 'SAVE PROFILE' }).click();
    await page.getByTestId('profile-dialog').waitFor({ state: 'detached' });
    await page.getByTestId('coach-note').filter({ hasText: 'Coach style: BACK ME' }).waitFor();
    const profileWrites = writes.filter(w => w.table === 'coach_profiles').map(w => JSON.parse(w.body));
    assert(profileWrites.some(b => b.personality === 'supportive'), 'style saved');
    // Notes are shown, never sent to the coach.
    const input = page.getByPlaceholder('Ask anything...').first();
    await input.fill('How much protein should I eat?');
    await input.press('Enter');
    await page.waitForTimeout(800);
    assert(chats.at(-1).messages.every(m => m.role === 'user' || m.role === 'assistant'), 'no notes sent');
    // The change is passed on with the next message so the coach can't repeat itself.
    assert.match(chats.at(-1).messages.at(-1).content, /^\(Coach style: BACK ME\. Answer in this style and level, in fresh words\.\)\nHow much protein should I eat\?$/);
    await input.fill('And on rest days?');
    await input.press('Enter');
    await page.waitForTimeout(800);
    assert.equal(chats.at(-1).messages.at(-1).content, 'And on rest days?', 'only once');
  } else if (scenario === 'setuplevel') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: '📋 BUILD MY SPLIT' }).click();
    await page.getByText('YOUR TRAINING EXPERIENCE').waitFor();
    await page.getByRole('button', { name: 'BEGINNER', exact: true }).click();
    await page.waitForTimeout(500);
    const saved = writes.filter(w => w.table === 'coach_profiles').map(w => JSON.parse(w.body));
    assert(saved.some(b => b.experience_level === 'beginner'), 'level saved during setup');
  } else if (scenario === 'reviewskip') {
    await page.getByRole('button', { name: /NUTRITION$/ }).last().click();
    await page.getByRole('button', { name: /DAY REVIEW/ }).click();
    await page.getByText('Snack').first().waitFor();
    assert.equal(await page.getByText(/MEAL 4 OF 4/).count() + await page.getByText('Snack').count() > 0, true, 'starts at the unanswered meal');
    assert.equal(await page.getByText('Breakfast', { exact: true }).filter({ visible: true }).count(), 0, 'logged meals not asked again');
    assert.equal(await page.getByText('MEAL 4 OF 4').count(), 1);
    await page.locator('.t3d-tick-btn').click();
    await page.getByTestId('already-noted').waitFor();
    assert.match(await page.getByTestId('already-noted').textContent(), /Dinner — large pepperoni pizza and two beers/);
    await page.getByRole('button', { name: '✓ Nothing else' }).click();
    const box = page.getByTestId('total-excludes');
    await box.waitFor();
    assert.match(await box.textContent(), /Total excludes: large pepperoni pizza and two beers/);
    assert.equal(await page.getByText(/UNDER TARGET/).count(), 0, 'not called under target');
    await box.getByRole('button', { name: 'ESTIMATE IT' }).click();
    await page.getByTestId('food-estimate').waitFor();
    const estimateText = await page.getByTestId('food-estimate').textContent();
    assert.match(estimateText, /Estimate: 2,160–2,880 kcal, 72–99 g protein/);
    const sent = chats.find(c => c.area === 'food_estimate');
    assert.match(sent.messages[0].content, /large pepperoni pizza and two beers/);
    await page.getByRole('button', { name: /ADD ~2,520 KCAL TO TODAY/ }).click();
    await page.getByText(/Added 2,520 kcal, 86 g protein, 263 g carbs and 80 g fat/).waitFor();
    assert.equal(await page.getByTestId('total-excludes').count(), 0);
    await page.getByRole('button', { name: 'SAVE & FINISH' }).click();
    await page.waitForTimeout(500);
    const saved = JSON.parse(writes.filter(w => w.table === 'nutrition_logs').at(-1).body);
    assert.deepEqual(saved.meals_completed._off_plan, { calories: 2520, protein: 86, carbs: 263, fats: 80 }, 'off-plan macros saved with the calories they cover');
    assert.equal(saved.total_calories, 4070);
    assert.equal(saved.total_protein, 191, 'off-plan protein counts');
  } else if (scenario === 'dashexcludes') {
    await page.getByTestId('kcal-excludes').waitFor();
    assert.match(await page.getByTestId('kcal-excludes').textContent(), /Excludes: large pepperoni pizza and two beers/);
    await page.getByRole('button', { name: 'REVIEW MY DAY SO FAR' }).click();
    await page.getByText(/Solid day/).waitFor();
    const context = chats.at(-1).context;
    assert.match(context, /Push A lifts: Bench Press: 2 sets, best 80kg × 6/);
    assert.match(context, /Push A PBs: Bench Press 80kg × 6 \(Weight PB\)/);
    assert.match(context, /app target 2100 kcal, 135g protein/);
    assert.match(context, /no calories entered[^\n]*large pepperoni pizza and two beers/);
  } else if (scenario === 'changeplanhint') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    await page.getByRole('button', { name: 'CHAT WITH FITNESS COACH' }).click();
    const input = page.getByPlaceholder('Ask anything...');
    // A question first, then the minimised chat, which shows the last two messages.
    await input.fill('How many reps next?');
    await input.press('Enter');
    await page.getByText('Next set: 10 reps.').waitFor();
    await page.getByRole('button', { name: 'MINIMISE' }).click();
    await input.fill('Swap this exercise permanently for incline press');
    await input.press('Enter');
    // The button shows in the minimised chat too, and takes the request along.
    await page.getByRole('button', { name: 'OPEN CHANGE PLAN' }).click();
    const request = page.getByPlaceholder('Tell the coach what you want to change...');
    await request.waitFor();
    assert.equal(await request.inputValue(), 'Swap this exercise permanently for incline press');
    assert.equal(await page.getByText(/programme_exercise_id/).count(), 0);
  } else if (scenario === 'planchangebutton') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    const ask = page.getByPlaceholder('Ask a question about your current plan...');
    await ask.fill('Add lunges to my plan permanently');
    await ask.press('Enter');
    await page.getByText(/Tap OPEN CHANGE PLAN to send it your request/).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.getByPlaceholder('Tell the coach what you want to change...').count(), 0, 'Change Plan not opened by itself');
    await page.getByRole('button', { name: 'OPEN CHANGE PLAN' }).click();
    await page.getByText(/chest gets 7 direct sets/).waitFor();
  } else if (scenario === 'planmarkdown') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await page.getByPlaceholder('Tell the coach what you want to change...').fill('Can you change the reps on Shoulder Press to 8-10?');
    await page.getByRole('button', { name: 'SEND' }).click();
    await page.getByText(/chest gets 7 direct sets/).waitFor();
    assert.equal(await page.getByText(/\*\*/).count(), 0, 'no raw markdown');
  } else if (scenario === 'streamchat' || scenario === 'streamerror') {
    await page.getByRole('button', { name: 'REVIEW MY DAY SO FAR' }).click();
    if (scenario === 'streamchat') {
      await page.getByText('Streamed: you have logged 1,300 kcal of your 2,100 kcal target.').waitFor();
      assert.equal(chats.at(-1).stream, true);
    } else {
      await page.getByText(/Coach provider failed: stream error/).waitFor();
      assert.equal(await page.getByText('Partial reply that gets cut', { exact: true }).count(), 0, 'cut-off text is not left as the reply');
    }
  } else if (scenario === 'streamcoach') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    await page.getByRole('button', { name: 'CHAT WITH FITNESS COACH' }).click();
    const input = page.getByPlaceholder('Ask anything...');
    await input.fill('What next?');
    await input.press('Enter');
    await page.getByText('Next set: 10 reps at 20kg, then rest 90 seconds.').waitFor();
    const sent = chats.filter(c => c.coach).at(-1);
    assert.equal(sent.stream, true);
    assert.deepEqual(sent.clientContext.programme.map(s => s.name), ['Push A'], 'only today\'s session');
    assert.equal(sent.clientContext.recentLegacyWorkouts, undefined, 'no 14-workout history between sets');
  } else {
    throw new Error('unknown scenario ' + scenario);
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message.split('\n').slice(0, 6).join(' / ')); process.exit(1); });
