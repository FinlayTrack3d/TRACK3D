// Browser regression checks for the AI coach review. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-coach-review.cjs <scenario>   (all remote services are mocked)
// Browser checks for the AI coach review (sections F-J). Scenarios:
//  nutritionhistory, roundup, roundupfail, weeklysavefail, painresolve
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'roundup';
const shiftKey = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const londonKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400, aud: 'authenticated' }) + '.t';
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user }));
  }, { user, token });
  const today = londonKey();
  const yesterday = shiftKey(today, -1);
  const meals = [{ name: 'Breakfast', calories: 600, protein: 40, carbs: 60, fats: 20 }, { name: 'Lunch', calories: 700, protein: 45, carbs: 80, fats: 20 }, { name: 'Dinner', calories: 800, protein: 50, carbs: 90, fats: 25 }];
  const tables = {
    nutrition_plans: [{ user_id: user.id, daily_calories: 2100, protein_target: 135, carbs_target: 230, fats_target: 65, meals, rest_day_meals: [], meal_library: [], weekly_meal_plan: {}, goal: 'maintain' }],
    nutrition_logs: [
      { id: 'n1', user_id: user.id, date: today, total_calories: 1300, total_protein: 85, meals_completed: { 0: true, 1: true, 2: { completed: false, note: 'large pepperoni pizza and two beers' }, _review_complete: true }, off_plan_food: 'large pepperoni pizza, two beers', off_plan_calories: null },
      { id: 'n0', user_id: user.id, date: yesterday, total_calories: 2050, total_protein: 130, meals_completed: [true, true, true] },
    ],
    daily_debrief: [{ overall_score: 7, task_scores: {} }],
    calendar_tasks: [{ title: 'Gym', status: 'done' }, { title: 'Emails', status: 'pending' }],
    workout_splits: scenario === 'painresolve' ? [{ id: 's', user_id: user.id, programme_started_at: new Date().toISOString(), sessions: [{ name: 'Push A', days: [['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()]], exercises: [{ name: 'Dumbbell Shoulder Press', sets: 4, reps: ['10','10','10','10'] }], approval: { approved: true } }] }] : [],
  };
  const writes = [];
  const chats = [];
  let chatFails = scenario === 'roundupfail';
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/chat') {
        const body = JSON.parse(req.postData() || '{}');
        chats.push(body);
        if (chatFails) return route.fulfill({ status: 502, json: { error: 'Coach provider failed (529): Overloaded' } });
        if ((body.system || '').includes('weekly recap')) return route.fulfill({ json: { content: [{ text: '{"biggest_win":"You trained twice.","focus":"Log meals.","verdict":"First tracked week."}' }] } });
        return route.fulfill({ json: { content: [{ text: 'Solid day: two meals on plan and a workout. Tomorrow, plan dinner before 6pm.' }] } });
      }
      if (url.pathname === '/api/coach') {
        const body = JSON.parse(req.postData() || '{}');
        chats.push({ coach: true, ...body });
        return route.fulfill({ json: /pain/i.test(body.message) ? { message: 'Stop that exercise for today — get it checked by a physio or doctor if it continues.', insights: [], actions: [], activePain: true, safetyStop: true, conversationId: 'c1' } : { message: 'Next set: 10 reps.', insights: [], actions: [], activePain: false, conversationId: 'c1' } });
      }
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
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    if (table === 'weekly_reports' && scenario === 'weeklysavefail') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.weekly_reports' in the schema cache" } });
    let rows = tables[table] || [];
    if (table === 'nutrition_logs') {
      const eq = url.searchParams.get('date');
      if (eq?.startsWith('eq.')) rows = rows.filter(r => r.date === eq.slice(3));
    }
    if (scenario === 'weeklysavefail' && table === 'workout_logs') rows = [{ id: 'w', date: shiftKey(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - 5), total_volume: 2180, duration_mins: 1, in_progress: false, exercises: [] }];
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:3123/app');
  await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });

  if (scenario === 'nutritionhistory') {
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
  } else {
    throw new Error('unknown scenario ' + scenario);
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message.split('\n')[0]); process.exit(1); });
