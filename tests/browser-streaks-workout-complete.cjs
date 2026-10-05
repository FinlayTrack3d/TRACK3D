// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-streaks-workout-complete.cjs <scenario>   (all remote services are mocked)
// Browser checks for the streaks / Workout Complete batch.
// Scenarios: habits, morning, complete, done
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'habits';
const londonKey = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.t';
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }));
  }, { user, token });
  const today = londonKey(0);
  const todayCode = ['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()];
  const routine = { user_id: user.id, wake_time: '06:00', day_groups: [], tasks: [
    { id: 'sleep', name: "Log last night's sleep", type: 'sleep', icon: '😴', duration: 1, scheduledTime: '06:00' },
    { id: 'checkin', name: 'TRACK3D Morning Check-in', type: 'tick', icon: '📱', duration: 2, scheduledTime: '06:01' } ] };
  // Habits: Water done 3 days before today, not yet today; Walk done yesterday and today;
  // Read done 2 days ago only (missed yesterday); a future-dated row must be ignored.
  const habits = [
    { id: 'h1', user_id: user.id, name: 'Drink water', category: 'health', streak: 0, created_at: '2026-01-01' },
    { id: 'h2', user_id: user.id, name: 'Walk', category: 'fitness', streak: 0, created_at: '2026-01-02' },
    { id: 'h3', user_id: user.id, name: 'Read', category: 'growth', streak: 0, created_at: '2026-01-03' },
  ];
  const completions = [
    ...[-1, -2, -3].map(o => ({ habit_id: 'h1', date: londonKey(o) })),
    ...[0, -1].map(o => ({ habit_id: 'h2', date: londonKey(o) })),
    { habit_id: 'h3', date: londonKey(-2) },
    { habit_id: 'h3', date: londonKey(1) },
  ];
  const checkins = scenario === 'morning' ? [
    { user_id: user.id, date: londonKey(-1), score: 8, data: { sleep: '7h' } },
    { user_id: user.id, date: londonKey(-2), score: 7, data: { sleep: '7h', roughCheckin: true } },
    { user_id: user.id, date: londonKey(-3), score: 7, data: { sleep: '7h' } },
    { user_id: user.id, date: londonKey(-5), score: 7, data: { sleep: '7h' } },
  ] : [];
  const split = { id: 's', user_id: user.id, programme_started_at: '2026-09-01T00:00:00Z', sessions: [{ name: 'Push B', days: [todayCode, 'SAT'].filter((d, i, a) => a.indexOf(d) === i), exercises: [
    { name: 'Bench Press', sets: 2, reps: ['6-8', '6-8'] },
    { name: 'Shoulder Press', sets: 1, reps: ['8-10'] },
  ], approval: { approved: true } }, { name: 'Pull A', days: ['THU'], exercises: [{ name: 'Row', sets: 1, reps: ['8-12'] }], approval: { approved: true } }] };
  const pastLogs = [
    { id: 'old1', session_name: 'Push B', date: londonKey(-8), in_progress: false, total_volume: 1500, duration_mins: 40, created_at: `${londonKey(-8)}T08:00:00Z`,
      exercises: [{ name: 'Bench Press', sets: [{ weight: '75', reps: '8' }, { weight: '75', reps: '7' }] }, { name: 'Shoulder Press', sets: [{ weight: '30', reps: '8' }] }] },
  ];
  if (scenario === 'done') pastLogs.unshift({ id: 'todaylog', session_name: 'Push B', date: today, in_progress: false, total_volume: 2000, duration_mins: 45, created_at: new Date().toISOString(), exercises: [] });
  const writes = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { content: [{ text: 'Good session.' }], reply: 'Good session.' } });
      return route.continue();
    }
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    if (url.pathname.includes('/storage/')) return route.fulfill({ json: {} });
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    const table = url.pathname.split('/').pop();
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    if (req.method() !== 'GET') {
      writes.push({ table, method: req.method(), body: req.postData() });
      if (table === 'workout_logs' && req.method() === 'POST') return route.fulfill({ status: 201, json: single ? { id: 'newlog' } : [{ id: 'newlog' }] });
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    let rows = [];
    if (table === 'habits' && scenario === 'habits') rows = habits;
    if (table === 'habit_completions' && scenario === 'habits') {
      const lte = url.searchParams.get('date');
      rows = completions;
      // Honour the date filters the app sends (gte / lte / eq).
      for (const value of url.searchParams.getAll('date')) {
        const [op, key] = value.split('.');
        rows = rows.filter(r => op === 'gte' ? r.date >= key : op === 'lte' ? r.date <= key : op === 'eq' ? r.date === key : true);
      }
      void lte;
    }
    if (table === 'morning_routines') rows = [routine];
    if (table === 'morning_checkins') rows = checkins;
    if (table === 'workout_splits') rows = [split];
    if (table === 'workout_logs') {
      rows = pastLogs;
      const inProgress = url.searchParams.get('in_progress');
      if (inProgress === 'eq.true') rows = [];
    }
    // PostgREST or=(in_progress.eq.false,date.lt.X): finished, or from an earlier day.
    const orFilter = url.searchParams.get('or');
    const earlierDay = orFilter && /in_progress\.eq\.false,date\.lt\.(\d{4}-\d{2}-\d{2})/.exec(orFilter);
    if (earlierDay) rows = rows.filter(r => !r.in_progress || String(r.date) < earlierDay[1]);
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3123/app');
  await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 }).catch(() => {});

  if (scenario === 'habits') {
    await page.getByRole('button', { name: /HABITS$/ }).last().click();
    await page.getByText('Drink water').first().waitFor();
    const streakFor = async name => (await page.locator('.t3d-hstreak').nth(habits.findIndex(h => h.name === name)).textContent()).trim();
    assert.match(await streakFor('Drink water'), /\b3d$/, 'water: 3 days carried, today not done yet');
    assert.match(await streakFor('Walk'), /\b2d$/, 'walk: yesterday + today');
    assert.match(await streakFor('Read'), /\b0d$/, 'read: missed yesterday, future row ignored');
    // Ticking today adds one straight away and is saved.
    await page.getByRole('button', { name: 'Complete Drink water' }).click();
    await page.waitForTimeout(300);
    assert.match(await streakFor('Drink water'), /\b4d$/, 'water after ticking today');
    assert(writes.some(w => w.table === 'habit_completions' && w.method === 'POST' && w.body.includes(today)), 'tick saved');
    console.log('habits streaks:', await streakFor('Drink water'), await streakFor('Walk'), await streakFor('Read'));
  } else if (scenario === 'morning') {
    await page.getByRole('button', { name: /MORNING$/ }).last().click();
    const pill = page.getByTestId('morning-streak');
    await pill.waitFor();
    const text = await pill.textContent();
    assert.match(text, /3-DAY MORNING STREAK/);
    assert.match(text, /FINISH TODAY/);
    console.log('morning pill:', text.trim());
  } else if (scenario === 'complete') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    const log = async (weight, reps) => {
      await page.getByLabel('Weight in kilograms').fill(String(weight));
      await page.getByLabel('Reps', { exact: true }).fill(String(reps));
      await page.getByRole('button', { name: 'Log set' }).click();
      await page.waitForTimeout(150);
    };
    await log(80, 6);   // Bench weight PB, +5kg vs last time
    await log(80, 5);
    await log(30, 10);  // Shoulder press same weight, +2 reps; rep PB
    await page.getByText('WORKOUT COMPLETE').waitFor({ timeout: 10000 });
    const pbs = await page.getByTestId('complete-pbs').textContent();
    const better = await page.getByTestId('complete-improvements').textContent();
    const week = await page.getByTestId('complete-week').textContent();
    console.log('PBs:', pbs); console.log('Better:', better); console.log('Week:', week);
    assert.match(pbs, /2 NEW PBS/);
    assert.match(pbs, /Bench Press.*80kg × 6 · Weight PB/);
    assert.match(pbs, /Shoulder Press.*10 reps @ 30kg · Rep PB/);
    assert.match(better, /Bench Press\+5kg \(75 → 80kg\)/);
    assert.match(better, /Shoulder Press\+2 reps @ 30kg/);
    const planned = new Set([...split.sessions[0].days, 'THU']).size;
    assert.match(week, new RegExp(`1 / ${planned}`));
    const saved = writes.filter(w => w.table === 'workout_logs').pop();
    const finalWrite = writes.filter(w => w.table === 'workout_logs' && w.body?.includes('"in_progress":false')).pop(); console.log('final write:', finalWrite?.method, (finalWrite?.body || '').slice(0, 300)); assert(finalWrite?.body.includes('"type":"weight_pb"'), 'PB saved with workout');
    await page.getByText('SETS COMPLETED').waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: require('node:os').tmpdir() + '/complete.png', fullPage: true });
  } else if (scenario === 'done') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByText('DONE FOR TODAY ✓').waitFor();
    await page.getByText('Push B completed').waitFor();
    assert.equal(await page.getByText('RECOMMENDED NEXT SESSION').count(), 0);
    await page.screenshot({ path: require('node:os').tmpdir() + '/done.png' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message); process.exit(1); });
