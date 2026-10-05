// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-review-fixes.cjs <scenario>   (all remote services are mocked)
// Browser checks for review fixes 3-6. Scenarios:
//  movefail, editfail, approvefail, aisavefail, aisaveok, routinefail, routineok
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'movefail';
const londonKey = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + offset * 86400000));
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
    if (url.pathname.includes('/storage/')) return route.fulfill({ json: {} });
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    const table = url.pathname.split('/').pop();
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    if (req.method() !== 'GET') {
      writes.push({ table, method: req.method(), body: req.postData(), url: req.url() });
      if (table === 'workout_splits' && failSplit) return route.fulfill({ status: 500, json: { message: 'database unavailable' } });
      if (table === 'morning_routines' && scenario === 'routinefail') return route.fulfill({ status: 500, json: { message: 'database unavailable' } });
      if (table === 'workout_splits') { split = { ...(split || {}), ...JSON.parse(req.postData()) }; return route.fulfill({ status: 201, json: single ? split : [split] }); }
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    let rows = [];
    if (table === 'workout_splits') rows = split ? [split] : [];
    if (table === 'morning_routines' && scenario.startsWith('routine')) rows = [routine];
    if (table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = [];
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });
  const page = await context.newPage();
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
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message.split('\n')[0]); process.exit(1); });
