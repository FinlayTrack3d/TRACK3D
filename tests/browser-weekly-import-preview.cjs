// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-weekly-import-preview.cjs <scenario>   (all remote services are mocked)
// Browser checks: Weekly Report 2.0, Import My Plan, plan preview.
// Scenarios: weekly, weeklynew, import, importedit, importfile, preview
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'weekly';
const londonKey = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + offset * 86400000));
const shift = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
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
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const thisMonday = shift(today, -((dow + 6) % 7));
  const weekStart = dow === 0 ? thisMonday : shift(thisMonday, -7);
  const day = n => shift(weekStart, n);
  const todayCode = ['SUN','MON','TUE','WED','THU','FRI','SAT'][dow];
  const pb = { type: 'weight_pb', label: 'Weight PB' };

  const withData = scenario === 'weekly';
  const hasPlan = ['weekly', 'preview', 'importedit'].includes(scenario);
  let split = hasPlan ? { id: 's', user_id: user.id, programme_started_at: scenario === 'preview' ? new Date().toISOString() : '2026-09-01T00:00:00Z', sessions: [
    { name: 'Push B', days: [todayCode], notes: 'Keep 2 reps in reserve', exercises: [{ name: 'Bench Press', sets: 3, reps: ['6-8', '6-8', '6-8'], rest_seconds: 150 }, { name: 'Cable Fly', sets: 2, reps: ['12-15', '12-15'] }], approval: { approved: true } },
    { name: 'Pull A', days: [todayCode === 'THU' ? 'FRI' : 'THU'], exercises: [{ name: 'Row', sets: 3, reps: ['8-12', '8-12', '8-12'] }], approval: { approved: true } },
  ] } : null;
  const tables = {
    workout_logs: withData ? [
      { id: 'a', date: day(0), total_volume: 6000, duration_mins: 50, in_progress: false, session_name: 'Push B', exercises: [{ name: 'Bench Press', sets: [{ weight: '82.5', reps: '6', personalBest: pb }] }] },
      { id: 'b', date: day(3), total_volume: 5000, duration_mins: 45, in_progress: false, session_name: 'Pull A', exercises: [] },
      { id: 'c', date: shift(weekStart, -5), total_volume: 10000, duration_mins: 90, in_progress: false, session_name: 'Push B', exercises: [] },
    ] : [],
    habits: withData ? [{ id: 'h1', user_id: user.id, name: 'Drink water', category: 'health', created_at: '2026-01-01T00:00:00Z' }] : [],
    habit_completions: withData ? [0, 1, 2, 3, 4, 5].map(n => ({ habit_id: 'h1', date: day(n) })) : [],
    morning_checkins: withData ? [0, 1, 2, 4].map(n => ({ user_id: user.id, date: day(n), score: 8, data: { weight: n === 0 ? '81' : n === 4 ? '80.2' : undefined } })) : [],
    morning_routines: withData ? [{ user_id: user.id, wake_time: '06:00', tasks: [], day_groups: [] }] : [],
    nutrition_logs: withData ? [{ date: day(0), total_calories: 2450, total_protein: 175 }, { date: day(1), total_calories: 3100, total_protein: 120 }] : [],
    nutrition_plans: withData ? [{ daily_calories: 2500, protein_target: 180, meals: [] }] : [],
  };
  const writes = [];
  const chatBodies = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/chat') {
        const body = req.postData() || '';
        chatBodies.push(body);
        if (body.includes('weekly recap')) return route.fulfill({ json: { content: [{ text: JSON.stringify({ biggest_win: 'You hit a Bench Press PB at 82.5kg.', focus: 'Log nutrition on at least five days.', verdict: 'Solid, consistent week. Keep the habit streak going.' }) }] } });
        if (body.includes('convert a training programme')) return route.fulfill({ json: { content: [{ text: 'Here you go:\n' + JSON.stringify({
          plan_name: 'Coach Sam block 1', notes: 'Add a rep each week before adding weight.',
          sessions: [
            { name: 'Push A', days: ['Monday'], notes: null, exercises: [{ name: 'Incline Dumbbell Press', sets: 3, reps: '8-10', rest_seconds: 120, tempo: null, notes: null }, { name: 'Machine Chest Press', sets: 3, reps: '10', rest_seconds: null, tempo: null, notes: null }, { name: 'Cable Fly', sets: null, reps: '12-15', rest_seconds: null, tempo: null, notes: 'Squeeze at the top' }] },
            { name: 'Pull A', days: [], notes: null, exercises: [{ name: 'Lat Pulldown', sets: 3, reps: '10-12', rest_seconds: 90, tempo: null, notes: null }] },
          ],
          uncertain: [{ where: 'Pull A', issue: 'No day given for this session.' }],
        }) }] } });
        return route.fulfill({ json: { content: [{ text: 'OK.' }] } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { reply: 'OK.' } });
      return route.continue();
    }
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    if (url.pathname.includes('/storage/')) return route.fulfill({ json: {} });
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    const table = url.pathname.split('/').pop();
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    if (req.method() !== 'GET') {
      writes.push({ table, method: req.method(), body: req.postData() });
      if (table === 'workout_splits') {
        split = { ...(split || {}), ...JSON.parse(req.postData()) };
        return route.fulfill({ status: 201, json: single ? split : [split] });
      }
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    let rows = table === 'workout_splits' ? (split ? [split] : []) : (tables[table] || []);
    if (table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = [];
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3123/app');

  if (scenario === 'weekly' || scenario === 'weeklynew') {
    const card = page.getByTestId('weekly-report-card');
    await card.waitFor({ timeout: 20000 });
    if (scenario === 'weeklynew') {
      await card.getByText('Nothing tracked for this week yet').waitFor();
      await card.getByRole('button', { name: 'OPEN WEEKLY REPORT →' }).click();
      await page.getByText('Nothing was tracked this week').waitFor();
      assert.equal(await page.getByText('GENERATE WEEKLY REPORT').count(), 0);
      assert.equal(chatBodies.filter(b => b.includes('weekly recap')).length, 0, 'no AI call without data');
      console.log('new user: empty state shown, no AI call');
    } else {
      await card.getByText('2/2').waitFor();
      console.log('teaser:', (await card.textContent()).replace(/\s+/g, ' '));
      await card.getByRole('button', { name: 'OPEN WEEKLY REPORT →' }).click();
      await page.getByTestId('weekly-recap').waitFor();
      const tile = async id => (await page.getByTestId(id).textContent()).replace(/\s+/g, ' ');
      assert.match(await tile('tile-workouts'), /2 \/ 2.*Every planned session done/);
      assert.match(await tile('tile-pbs'), /NEW PBS1/);
      assert.match(await tile('tile-volume'), /11,000kg.*\+10% vs previous week \(10,000kg\)/);
      assert.match(await tile('tile-habits'), /86%.*6 of 7/);
      assert.match(await tile('tile-mornings'), /4 \/ 7/);
      assert.match(await tile('tile-nutrition'), /ON TARGET1 \/ 7/);
      assert.match(await tile('tile-weight'), /-0\.8kg/);
      assert.match((await page.getByTestId('recap-pbs').textContent()), /Bench Press82\.5kg × 6 · Weight PB/);
      const coach = page.getByTestId('recap-coach');
      await coach.getByText('You hit a Bench Press PB at 82.5kg.').waitFor({ timeout: 10000 });
      await coach.getByText('FOCUS FOR NEXT WEEK').waitFor();
      const facts = chatBodies.find(b => b.includes('weekly recap'));
      assert(facts.includes('Workouts completed: 2 of 2 planned'), 'AI given real facts');
      const saved = writes.find(w => w.table === 'weekly_reports');
      assert(saved, 'summary saved');
      const savedBody = JSON.parse(saved.body);
      assert.equal(savedBody.report_date, shift(weekStart, 6));
      assert.match(savedBody.patterns, /^BIGGEST WIN: You hit/);
      await page.waitForTimeout(800);
      await page.screenshot({ path: require('node:os').tmpdir() + '/weekly.png', fullPage: true });
      // Previous week: no data there, so no invented numbers.
      await page.getByRole('button', { name: 'Previous week' }).click();
      await page.getByTestId('tile-volume').waitFor();
      assert.match(await tile('tile-workouts'), /1 \/ 2/);
      assert.match(await tile('tile-volume'), /First tracked week/);
      await page.getByRole('button', { name: '← BACK' }).click();
      await page.getByTestId('weekly-report-card').waitFor();
    }
  } else if (scenario === 'import' || scenario === 'importedit') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    if (scenario === 'import') {
      await page.getByRole('button', { name: '📥 IMPORT MY PLAN' }).click();
    } else {
      await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
      await page.getByRole('button', { name: 'Have a new plan from your own coach? Import it instead' }).click();
    }
    await page.getByTestId('import-input').waitFor();
    await page.getByLabel("Your coach's plan").fill('Push A (Monday)\nIncline DB Press - 3 x 8-10, 2 min rest\nMachine Chest Press - 3 x 10\nCable Fly - 12-15, squeeze\n\nPull A\nLat Pulldown 3x10-12 90s');
    await page.getByRole('button', { name: 'INTERPRET MY PLAN →' }).click();
    await page.getByTestId('import-review').waitFor({ timeout: 10000 });
    assert.equal(writes.filter(w => w.table === 'workout_splits').length, 0, 'nothing saved before confirmation');
    const flags = await page.getByTestId('import-flags').textContent();
    console.log('flags:', flags);
    assert.match(flags, /Pull A:.*No day given/);
    assert.match(flags, /Cable Fly: Sets not stated - set to 3/);
    const review = await page.getByTestId('import-review').textContent();
    assert.match(review, /Incline Dumbbell Press.*Rest 120s.*3 sets · 8-10\/8-10\/8-10 reps/);
    assert.match(review, /Squeeze at the top/);
    assert.match(review, /NO DAY SET/);
    if (scenario === 'import') {
      await page.screenshot({ path: require('node:os').tmpdir() + '/import-review.png', fullPage: true });
      await page.getByRole('button', { name: 'SAVE THIS PLAN ✓' }).click();
      await page.getByText('YOUR WEEKLY PLAN').waitFor({ timeout: 10000 });
      const saved = JSON.parse(writes.filter(w => w.table === 'workout_splits').pop().body);
      assert.equal(saved.split_name, 'Coach Sam block 1');
      assert.deepEqual(saved.sessions.map(s => s.name), ['Push A', 'Pull A']);
      assert.deepEqual(saved.sessions[0].days, ['MON']);
      assert.equal(saved.sessions[0].programme_notes, 'Add a rep each week before adding weight.');
      assert.equal(saved.sessions[0].exercises[0].rest_seconds, 120);
      assert(saved.sessions.every(s => s.approval?.approved), 'saved as approved like the AI builder');
    } else {
      assert.match(review, /Saving this replaces your current plan/);
      await page.getByRole('button', { name: 'EDIT BEFORE SAVING' }).click();
      await page.getByText('IMPORTED PLAN · Check each session').waitFor();
      assert.equal(await page.locator('input.t3d-input').first().inputValue(), 'Push A');
      await page.getByRole('button', { name: 'CANCEL IMPORT' }).click();
      await page.getByText('YOUR WEEKLY PLAN').waitFor();
      await page.getByText('Push B').first().waitFor();
      assert.equal(writes.filter(w => w.table === 'workout_splits').length, 0, 'cancelled import saved nothing');
    }
  } else if (scenario === 'importfile') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: '📥 IMPORT MY PLAN' }).click();
    await page.getByTestId('import-file').setInputFiles({ name: 'plan.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK') });
    await page.getByText(/export a spreadsheet or Google Sheet as CSV/i).waitFor();
    await page.getByTestId('import-file').setInputFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.from('Day,Exercise,Sets,Reps\nPush A,Bench Press,3,8-10\n') });
    await page.getByText('Loaded plan.csv').waitFor();
    assert.match(await page.getByLabel("Your coach's plan").inputValue(), /Push A,Bench Press,3,8-10/);
  } else if (scenario === 'preview') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByText('YOUR WEEKLY PLAN').waitFor();
    const start = page.getByRole('button', { name: /START WORKOUT/ }).first();
    await start.waitFor();
    await page.waitForTimeout(1000);
    const writesBefore = writes.length; // Fitness load runs its own stale-workout cleanup
    // Today's eye
    await page.getByRole('button', { name: 'View Push B exercises' }).click();
    const sheet = page.getByTestId('plan-preview');
    await sheet.waitFor();
    const sheetText = await sheet.textContent();
    assert.match(sheetText, /TODAY'S WORKOUT/);
    assert.match(sheetText, /Bench Press.*Rest 150s.*3 sets · 6-8\/6-8\/6-8 reps/);
    assert.match(sheetText, /Keep 2 reps in reserve/);
    const box = await sheet.boundingBox();
    assert(box.y >= 0 && box.y + box.height <= 844 + 1, `sheet inside viewport: ${JSON.stringify(box)}`);
    await page.screenshot({ path: require('node:os').tmpdir() + '/preview-today.png' });
    await sheet.getByRole('button', { name: 'CLOSE ✕' }).click();
    assert.equal(await page.getByTestId('plan-preview').count(), 0);
    // Weekly eye
    await page.getByRole('button', { name: "View this week's programme" }).click();
    const weekText = await page.getByTestId('plan-preview').textContent();
    assert.match(weekText, /THIS WEEK'S PROGRAMME/);
    assert.match(weekText, /Push B/); assert.match(weekText, /Pull A/); assert.match(weekText, /Row/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('plan-preview').count(), 0);
    // Viewing changed nothing.
    assert.deepEqual(writes.slice(writesBefore), [], 'preview wrote nothing');
    assert.equal(await page.getByText('ACTIVE WORKOUT').count(), 0);
    await start.waitFor();
    await page.screenshot({ path: require('node:os').tmpdir() + '/preview-home.png' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message); process.exit(1); });
