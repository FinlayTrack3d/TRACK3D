// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-review-fixes.cjs <scenario>   (all remote services are mocked)
// Browser checks for review fixes 3-6. Scenarios:
//  movefail, editfail, approvefail, aisavefail, aisaveok, routinefail, routineok, rollover, tz,
//  photodelete, pastscore, createdat, habitretry, emptyworkout, importbig, question
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'movefail';
const shiftKey = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const londonKey = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + offset * 86400000));
(async () => {
  const browser = await chromium.launch({ headless: true });
  // tz: the device is in Los Angeles (Mon 5 Oct, 20:00) while London is already Tue 6 Oct.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(scenario === 'tz' ? { timezoneId: 'America/Los_Angeles' } : {}) });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400, aud: 'authenticated' }) + '.t';
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user }));
  }, { user, token });
  // rollover runs on a fake clock: Tue 6 Oct 2026, 23:50 in London.
  const fakeStart = new Date('2026-10-06T22:50:00Z');
  const tzStart = new Date('2026-10-06T03:00:00Z');
  const today = ['rollover', 'tz'].includes(scenario) ? '2026-10-06' : londonKey(0);
  const todayCode = ['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()];
  const otherDay = todayCode === 'THU' ? 'FRI' : 'THU';
  const approved = scenario !== 'approvefail';
  let split = scenario.startsWith('aisave') ? null : { id: 's', user_id: user.id, programme_started_at: new Date().toISOString(), sessions: [
    { name: 'Push B', days: [todayCode], exercises: [{ name: 'Bench Press', sets: 2, reps: ['6-8', '6-8'] }], ...(approved ? { approval: { approved: true, reviewAfter: '2026-12-01' } } : {}) },
    { name: 'Pull A', days: [otherDay], exercises: [{ name: 'Row', sets: 2, reps: ['8-12', '8-12'] }], ...(approved ? { approval: { approved: true, reviewAfter: '2026-12-01' } } : {}) },
  ] };
  const routine = { user_id: user.id, wake_time: '06:00', day_groups: [], tasks: [
    { id: 'sleep', name: "Log last night's sleep", type: 'sleep', icon: '😴', duration: 1, scheduledTime: '06:00' },
    { id: 'custom-1', name: 'Walk the dog', type: 'tick', icon: '▸', duration: 20, scheduledTime: '06:01' },
    { id: 'checkin', name: 'TRACK3D Morning Check-in', type: 'tick', icon: '📱', duration: 2, scheduledTime: '06:21' } ] };
  const failSplit = ['movefail', 'editfail', 'approvefail', 'aisavefail'].includes(scenario);
  const writes = [];
  const reads = [];
  const storageCalls = [];
  let habitDeleteFails = scenario === 'habitretry';
  const yesterday = shiftKey(today, -1);
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/chat') {
        const ex = name => ({ name, sets: 3, reps: ['8-12','8-12','8-12'], tempo: '3-0-1-0', rest_seconds: 90, warmup_sets: 1, notes: '' });
        return route.fulfill({ json: { content: [{ text: JSON.stringify({ split_name: 'AI Plan', notes: 'n', sessions: [{ name: 'Full Body', days: ['MON'], duration_mins: 40, reasoning: 'r', exercises: [ex('Press'), ex('Row')] }] }) }] } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { content: [{ text: 'OK.' }] } });
      return route.continue();
    }
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    if (url.pathname.includes('/storage/')) {
      storageCalls.push({ method: req.method(), path: url.pathname, body: req.postData() });
      if (url.pathname.includes('/object/list/')) return route.fulfill({ json: [{ name: 'front.jpg' }, { name: 'side.jpg' }] });
      return route.fulfill({ json: [] });
    }
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    const table = url.pathname.split('/').pop();
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    if (req.method() !== 'GET') {
      writes.push({ table, method: req.method(), body: req.postData(), url: req.url() });
      if (table === 'habits' && req.method() === 'DELETE' && habitDeleteFails) return route.fulfill({ status: 500, json: { message: 'delete failed' } });
      if (table === 'workout_logs' && req.method() === 'POST') return route.fulfill({ status: 201, json: single ? { id: 'w1' } : [{ id: 'w1' }] });
      if (table === 'workout_splits' && failSplit) return route.fulfill({ status: 500, json: { message: 'database unavailable' } });
      if (table === 'morning_routines' && scenario === 'routinefail') return route.fulfill({ status: 500, json: { message: 'database unavailable' } });
      if (table === 'workout_splits') { split = { ...(split || {}), ...JSON.parse(req.postData()) }; return route.fulfill({ status: 201, json: single ? split : [split] }); }
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    reads.push(decodeURIComponent(req.url()));
    let rows = [];
    if (table === 'workout_splits') rows = split ? [split] : [];
    if (table === 'morning_routines' && (scenario.startsWith('routine') || ['tz', 'photodelete', 'pastscore', 'createdat'].includes(scenario))) rows = [routine];
    if (table === 'morning_checkins' && ['photodelete', 'pastscore'].includes(scenario)) rows = [{ user_id: user.id, date: yesterday, score: 6, data: { sleep: '7h', 'custom-1': false, checkin: true, photos: { front: `${user.id}/${yesterday}/front.jpg`, side: 'skipped', back: 'skipped' } } }];
    if (table === 'habits' && scenario === 'habitretry') rows = [{ id: 'h1', user_id: user.id, name: 'Drink water', category: 'health', created_at: '2026-01-01T00:00:00Z' }, { id: 'h2', user_id: user.id, name: 'Read', category: 'growth', created_at: '2026-01-01T00:00:00Z' }];
    if (table === 'workout_logs' && scenario === 'emptyworkout' && url.searchParams.get('in_progress') !== 'eq.true') rows = [{ id: 'old', date: today, session_name: 'Pull A', total_volume: 4000, duration_mins: 40, in_progress: false, exercises: [], created_at: new Date().toISOString() }];
    if (table === 'nutrition_plans' && scenario === 'tz') rows = [{ user_id: user.id, daily_calories: 2500, protein_target: 180, meals: [{ name: 'Breakfast', calories: 600, protein: 40 }], rest_day_meals: [], meal_library: [], weekly_meal_plan: {} }];
    if (table === 'nutrition_logs' && scenario === 'tz') rows = [{ user_id: user.id, date: '2026-10-06', total_calories: 2500, total_protein: 180 }];
    if (table === 'morning_checkins' && scenario === 'tz') rows = [{ user_id: user.id, date: '2026-10-04', score: 7, data: {} }, { user_id: user.id, date: '2026-10-05', score: 8, data: {} }];
    if (table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = [];
    // PostgREST or=(in_progress.eq.false,date.lt.X): finished, or from an earlier day.
    const orFilter = url.searchParams.get('or');
    const earlierDay = orFilter && /in_progress\.eq\.false,date\.lt\.(\d{4}-\d{2}-\d{2})/.exec(orFilter);
    if (earlierDay) rows = rows.filter(r => !r.in_progress || String(r.date) < earlierDay[1]);
    // Everyone here has already agreed to health data storage (on their profile).
    if (table === 'user_profiles' && req.method() === 'GET') rows = (rows.length ? rows : [{ user_id: '11111111-1111-4111-8111-111111111111' }]).map(row => ({ health_consent_at: '2026-10-06T08:00:00.000Z', health_consent_version: '2026-10-06', ...row }));
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });
  const page = await context.newPage();
  if (scenario === 'rollover') await page.clock.install({ time: fakeStart });
  if (scenario === 'tz') await page.clock.install({ time: tzStart });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto('http://localhost:3123/app');
  await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 }).catch(() => {});
  const planRow = day => page.locator(`[data-workout-day="${day}"]`);

  if (scenario === 'movefail') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByText('YOUR WEEKLY PLAN').waitFor();
    await page.getByRole('button', { name: `Move Push B from ${todayCode}` }).click();
    const target = todayCode === 'SAT' ? 'SUN' : 'SAT';
    await planRow(target).click();
    await page.getByText(/Push B was not moved: .*database unavailable.*Your plan has not changed/).waitFor();
    assert.match(await planRow(todayCode).textContent(), /Push B/, 'move undone after failed save');
    assert.doesNotMatch(await planRow(target).textContent(), /Push B/);
  } else if (scenario === 'editfail') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: 'EDIT SESSIONS' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'SAVE ✓' }).click();
    await page.getByRole('dialog').getByText(/Your changes were not saved: .*database unavailable/).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1, 'modal stays open');
  } else if (scenario === 'approvefail') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: 'REVIEW & LOCK IN PLAN' }).click();
    await page.getByRole('button', { name: /APPROVE FULL 8-WEEK SPLIT/ }).click();
    await page.getByRole('dialog').getByText(/Approval not saved: .*database unavailable/).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'CLOSE' }).click();
    await page.getByText('REVIEW & LOCK IN PLAN').waitFor();
    assert.equal(await page.getByText(/8-WEEK COMMITMENT APPROVED/).count(), 0, 'not shown as approved');
  } else if (scenario.startsWith('aisave')) {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /AI BUILD MY PROGRAMME/ }).click();
    const next = () => page.getByRole('button', { name: /^(NEXT →|BUILD MY PROGRAMME)$/ }).click();
    await page.getByRole('button', { name: /Build muscle/ }).click(); await next();
    await page.getByRole('button', { name: /New to training/ }).click(); await next();
    await page.getByRole('button', { name: /^1 day$/ }).click(); await next();
    await page.getByRole('button', { name: 'MON', exact: true }).click(); await next();
    await page.locator('textarea').fill('40 minutes'); await next();
    await page.getByRole('button', { name: /Dumbbells only/ }).click(); await next();
    await page.getByRole('button', { name: /Let the coach choose/ }).click(); await next();
    await page.getByRole('button', { name: /Not sure – let the coach choose/ }).click();
    await page.locator('input.t3d-input').last().fill('balanced'); await next();
    await page.locator('input.t3d-input').last().fill('none'); await next();
    await page.getByText(/YOUR AI COACH PROGRAMME/).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'SAVE PLAN' }).click();
    if (scenario === 'aisavefail') {
      await page.getByText(/Your programme could not be saved: .*database unavailable/).waitFor();
      assert.equal(await page.getByText('YOUR WEEKLY PLAN').count(), 0, 'stayed on the builder');
    } else {
      await page.getByText('YOUR WEEKLY PLAN').waitFor();
      const saved = JSON.parse(writes.filter(w => w.table === 'workout_splits').pop().body);
      assert.equal(saved.split_name, 'AI Plan');
      assert(saved.sessions[0].approval?.approved);
    }
  } else if (scenario === 'rollover') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    const logSet = async (weight, reps) => {
      await page.getByLabel('Weight in kilograms').fill(String(weight));
      await page.getByLabel('Reps', { exact: true }).fill(String(reps));
      await page.getByRole('button', { name: 'Log set' }).click();
    };
    await logSet(60, 8);
    await page.waitForTimeout(500);
    assert(writes.some(w => w.table === 'workout_logs' && w.method === 'POST'), 'workout row created');
    // Cross midnight with the workout still open.
    await page.clock.fastForward('20:00');
    await page.waitForTimeout(1500);
    await page.clock.fastForward('00:06');
    await page.waitForTimeout(1500);
    // Crossing midnight writes nothing: older unfinished workouts are closed
    // only when a new workout starts, and never the one in progress.
    const cleanup = writes.filter(w => w.table === 'workout_logs' && w.method === 'PATCH' && w.body === '{"in_progress":false}');
    assert.equal(cleanup.length, 0, 'no cleanup just because the date changed');
    await logSet(60, 7);
    await page.waitForTimeout(800);
    const latest = writes.filter(w => w.table === 'workout_logs' && w.method === 'PATCH' && w.body.includes('"exercises"')).pop();
    const body = JSON.parse(latest.body);
    assert.equal(body.date, '2026-10-06', 'the workout keeps the day it started');
    // That was the session's last set: it finishes normally, after midnight.
    assert.equal(body.in_progress, false);
    assert(latest.url.includes('id=eq.w1'), 'the same workout row was finished');
    await page.getByText('WORKOUT COMPLETE').waitFor();
    assert.match(await page.getByText(/SETS COMPLETED/).locator('..').textContent(), /2/);
  } else if (scenario === 'tz') {
    assert.equal(await page.evaluate(() => new Date().getDate()), 5, 'device clock is on 5 Oct');
    await page.getByText('DAILY SCORE').waitFor();
    await page.waitForTimeout(1500);
    // Dashboard 7-day activity starts 6 days before the London date.
    assert(reads.some(u => u.includes('/morning_checkins?') && u.includes('date=gte.2026-09-30')), 'activity uses home date: ' + reads.filter(u => u.includes('morning_checkins')).join(' | '));
    assert(!reads.some(u => u.includes('date=gte.2026-09-29')), 'no device-date window');
    // End of Day reads today's records by the London date.
    await page.getByRole('button', { name: /END OF DAY CHECK-IN/ }).click();
    await page.waitForTimeout(1500);
    const eodReads = reads.filter(u => /daily_goals|nutrition_logs|workout_logs/.test(u) && u.includes('date=eq.'));
    assert(eodReads.length && eodReads.every(u => u.includes('date=eq.2026-10-06')), 'EOD uses home date: ' + eodReads.join(' | '));
    // Morning chart: the last day shown is Tuesday (London), not Monday.
    await page.goto('http://localhost:3123/app');
    await page.getByRole('button', { name: /MORNING$/ }).last().click();
    await page.waitForTimeout(1500);
    const labels = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.children.length === 0 && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(el.textContent.trim())).map(el => el.textContent.trim()));
    console.log('chart labels:', labels.join(','));
    assert(labels.length >= 7, 'chart shown');
    assert.equal(labels.slice(-1)[0], 'Tue', 'chart ends on the London day');
    await page.getByRole('button', { name: /NUTRITION$/ }).last().click();
    await page.waitForTimeout(2000);
    const nutritionLabels = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.children.length === 0 && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(el.textContent.trim())).map(el => el.textContent.trim()));
    console.log('nutrition labels:', nutritionLabels.join(','));
    assert(nutritionLabels.length >= 7, 'nutrition week shown');
    assert.equal(nutritionLabels.slice(-1)[0], 'Tue', 'nutrition week ends on the London day');
  } else if (scenario === 'routinefail' || scenario === 'routineok') {
    await page.getByRole('button', { name: /MORNING$/ }).last().click();
    await page.getByRole('button', { name: 'EDIT ROUTINE' }).click();
    await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
    if (scenario === 'routinefail') {
      await page.getByText(/Your routine could not be saved: .*database unavailable/).first().waitFor();
      assert.equal(await page.getByText('✓ Routine saved').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'SAVE CHANGES' }).count(), 1, 'stayed in the editor');
    } else {
      await page.getByText('✓ Routine saved').waitFor();
    }
  } else if (scenario === 'photodelete') {
    await page.getByRole('button', { name: /MORNING$/ }).last().click();
    await page.getByText('MORNING HISTORY').click();
    await page.getByText('Completed', { exact: true }).first().click();
    await page.getByRole('button', { name: 'DELETE THIS DAY' }).click();
    await page.getByRole('button', { name: 'DELETE', exact: true }).click();
    await page.waitForTimeout(1000);
    assert(writes.some(w => w.table === 'morning_checkins' && w.method === 'DELETE'), 'row deleted');
    const list = storageCalls.find(c => c.path.includes('/object/list/checkin-photos'));
    assert(list && JSON.parse(list.body).prefix === `${user.id}/${yesterday}`, 'listed the day folder: ' + JSON.stringify(storageCalls));
    const remove = storageCalls.find(c => c.method === 'DELETE');
    assert.deepEqual(JSON.parse(remove.body).prefixes, [`${user.id}/${yesterday}/front.jpg`, `${user.id}/${yesterday}/side.jpg`]);
  } else if (scenario === 'pastscore') {
    await page.getByRole('button', { name: /MORNING$/ }).last().click();
    await page.getByText('MORNING HISTORY').click();
    await page.getByText('Completed', { exact: true }).first().click();
    await page.getByRole('button', { name: 'EDIT THIS DAY' }).click();
    await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
    await page.waitForTimeout(1000);
    const saved = writes.filter(w => w.table === 'morning_checkins' && w.method === 'POST').pop();
    const body = JSON.parse(saved.body);
    assert.equal(body.date, yesterday);
    assert.equal(body.score, 6, 'older past entry keeps its original score');
    assert.equal(body.data.scoreBasis, undefined, 'no basis invented for a past day');
  } else if (scenario === 'createdat') {
    await page.getByRole('button', { name: /MORNING$/ }).last().click();
    await page.getByRole('button', { name: /START MY MORNING NOW/ }).click();
    const yes = page.getByRole('button', { name: 'YES, START NOW' });
    if (await yes.isVisible().catch(() => false)) await yes.click();
    await page.getByRole('textbox', { name: 'Hours slept' }).fill('7h');
    await page.getByRole('textbox', { name: 'Hours slept' }).press('Enter');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'END MORNING' }).click();
    await page.getByRole('button', { name: 'END AND SAVE' }).click();
    await page.getByText('MORNING COMPLETE').waitFor();
    await page.waitForTimeout(800);
    const saves = writes.filter(w => w.table === 'morning_checkins' && w.method === 'POST').map(w => JSON.parse(w.body));
    assert(saves.length >= 2, 'autosave and final save: ' + saves.length);
    assert.ok(saves[0].created_at, 'first write sets created_at');
    assert(saves.slice(1).every(b => b.created_at === undefined), 'later writes keep it');
    const final = saves.at(-1);
    assert(Array.isArray(final.data.scoreBasis) && final.data.scoreBasis.some(step => step.id === 'custom-1'), 'score basis saved');
    assert.equal(await page.getByText('scoreBasis').count(), 0, 'basis not shown to the user');
  } else if (scenario === 'habitretry') {
    await page.getByRole('button', { name: /HABITS$/ }).last().click();
    await page.getByRole('button', { name: 'Remove Read' }).click();
    await page.getByText(/Your habits could not be saved: delete failed/).waitFor();
    habitDeleteFails = false;
    const before = writes.filter(w => w.table === 'habits' && w.method === 'DELETE').length;
    await page.getByRole('button', { name: 'RETRY' }).click();
    await page.waitForTimeout(800);
    const deletes = writes.filter(w => w.table === 'habits' && w.method === 'DELETE').slice(before);
    assert.equal(deletes.length, 1, 'retry re-sends the failed delete');
    assert(deletes[0].url.includes('id=eq.h2'));
    assert.equal(await page.getByText(/could not be saved/).count(), 0, 'error cleared');
    await page.getByRole('button', { name: 'RETRY' }).count();
  } else if (scenario === 'emptyworkout') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: /Repeat Push B|START WORKOUT/ }).first().click();
    await page.getByRole('button', { name: 'END WORKOUT' }).click();
    await page.getByRole('button', { name: 'END ANYWAY' }).click();
    await page.getByText('WORKOUT COMPLETE').waitFor();
    const week = await page.getByTestId('complete-week').textContent();
    assert.match(week, /1 \/ 2/, 'empty workout not counted: ' + week);
  } else if (scenario === 'importbig') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await page.getByRole('button', { name: /Import it instead/ }).click();
    await page.getByTestId('import-file').setInputFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.alloc(600 * 1024, 'a') });
    await page.getByText(/That file is too large \(600 KB\)\. The limit is 512 KB/).waitFor();
    assert.equal(await page.getByLabel("Your coach's plan").inputValue(), '');
  } else if (scenario === 'question') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByPlaceholder(/Ask a question about your current/).fill('Should I add a set to bench press?');
    await page.getByRole('button', { name: 'ASK', exact: true }).click();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByText('Plan changes are made in Change Plan').count(), 0, 'question was not routed to Change Plan');
    assert.equal(await page.getByTestId('proposed-change').count(), 0, 'no change proposed for a question');
  } else {
    throw new Error('unknown scenario ' + scenario);
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message.split('\n')[0]); process.exit(1); });
