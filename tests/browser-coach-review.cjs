// Browser regression checks for the AI coach review. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-coach-review.cjs <scenario>   (all remote services are mocked)
// Browser checks for the AI coach review (sections F-J). Scenarios:
//  nutritionhistory, roundup, roundupfail, weeklysavefail, painresolve, coachstyle, setuplevel,
//  reviewskip, dashexcludes, changeplanhint, planmarkdown
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
  const meals = [{ name: 'Breakfast', calories: 600, protein: 40, carbs: 60, fats: 20 }, { name: 'Lunch', calories: 700, protein: 45, carbs: 80, fats: 20 }, { name: 'Dinner', calories: 800, protein: 50, carbs: 90, fats: 25 }, ...(scenario === 'reviewskip' ? [{ name: 'Snack', calories: 250, protein: 20, carbs: 20, fats: 8 }] : [])];
  const tables = {
    nutrition_plans: [{ user_id: user.id, daily_calories: 2100, protein_target: 135, carbs_target: 230, fats_target: 65, meals, rest_day_meals: [], meal_library: [], weekly_meal_plan: {}, goal: 'maintain' }],
    nutrition_logs: [
      { id: 'n1', user_id: user.id, date: today, total_calories: 1300, total_protein: 85, meals_completed: { 0: true, 1: true, 2: { completed: false, note: 'large pepperoni pizza and two beers' }, _review_complete: scenario !== 'reviewskip' }, off_plan_food: scenario === 'reviewskip' || scenario === 'dashexcludes' ? '' : 'large pepperoni pizza, two beers', off_plan_calories: null },
      { id: 'n0', user_id: user.id, date: yesterday, total_calories: 2050, total_protein: 130, meals_completed: [true, true, true] },
    ],
    daily_debrief: [{ overall_score: 7, task_scores: {} }],
    calendar_tasks: [{ title: 'Gym', status: 'done' }, { title: 'Emails', status: 'pending' }],
    workout_logs: scenario === 'dashexcludes' ? [{ id: 'w1', user_id: user.id, date: today, session_name: 'Push A', in_progress: false, total_volume: 3000, duration_mins: 50, exercises: [{ name: 'Bench Press', sets: [{ weight: '80', reps: '6', personalBest: { type: 'weight_pb', label: 'Weight PB' } }, { weight: '80', reps: '5' }] }] }] : [],
    workout_splits: ['painresolve', 'changeplanhint', 'planmarkdown'].includes(scenario) ? [{ id: 's', user_id: user.id, programme_started_at: new Date().toISOString(), sessions: [{ name: 'Push A', days: [['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()]], exercises: [{ name: 'Dumbbell Shoulder Press', sets: 4, reps: ['10','10','10','10'] }], approval: { approved: true } }] }] : [],
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
        if (body.area === 'food_estimate') return route.fulfill({ json: { content: [{ text: JSON.stringify({ items: [{ name: 'Large pepperoni pizza', amount: '1 large (as stated)', calories_low: 1800, calories_high: 2400, protein_low: 70, protein_high: 95 }, { name: 'Beer', amount: '2 (as stated)', calories_low: 360, calories_high: 480, protein_low: 2, protein_high: 4 }] }) }] } });
        if (body.area === 'weekly_summary') return route.fulfill({ json: { content: [{ text: '{"biggest_win":"You trained twice.","focus":"Log meals.","verdict":"First tracked week."}' }] } });
        return route.fulfill({ json: { content: [{ text: 'Solid day: two meals on plan and a workout. Tomorrow, plan dinner before 6pm.' }] } });
      }
      if (url.pathname === '/api/coach') {
        const body = JSON.parse(req.postData() || '{}');
        chats.push({ coach: true, ...body });
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
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    if (table === 'weekly_reports' && scenario === 'weeklysavefail') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.weekly_reports' in the schema cache" } });
    let rows = tables[table] || [];
    if (table === 'nutrition_logs') {
      const eq = url.searchParams.get('date');
      if (eq?.startsWith('eq.')) rows = rows.filter(r => r.date === eq.slice(3));
    }
    if (table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = [];
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
  } else if (scenario === 'coachstyle') {
    await page.getByRole('button', { name: 'REVIEW MY DAY SO FAR' }).click();
    await page.getByText(/Solid day/).waitFor();
    const sent = chats.at(-1);
    assert.equal(sent.area, 'dashboard');
    assert.equal(sent.system, undefined, 'no client-written prompt');
    assert.match(sent.context, /User data today/);
    const settings = page.getByTestId('coach-settings').first();
    await settings.getByRole('button', { name: 'BACK ME' }).click();
    await page.getByTestId('coach-note').filter({ hasText: 'Coach style: BACK ME' }).waitFor();
    await settings.getByRole('button', { name: 'ADVANCED' }).click();
    await page.getByTestId('coach-note').filter({ hasText: 'Level: ADVANCED' }).waitFor();
    const profileWrites = writes.filter(w => w.table === 'coach_profiles').map(w => JSON.parse(w.body));
    assert(profileWrites.some(b => b.personality === 'supportive'), 'style saved');
    assert(profileWrites.some(b => b.experience_level === 'advanced'), 'level saved');
    // Notes are shown, never sent to the coach.
    const input = page.getByPlaceholder('Ask anything...').first();
    await input.fill('How much protein should I eat?');
    await input.press('Enter');
    await page.waitForTimeout(800);
    assert(chats.at(-1).messages.every(m => m.role === 'user' || m.role === 'assistant'), 'no notes sent');
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
    await page.getByText(/Added 2,520 kcal/).waitFor();
    assert.equal(await page.getByTestId('total-excludes').count(), 0);
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
    await input.fill('Swap this exercise permanently for incline press');
    await input.press('Enter');
    await page.getByRole('button', { name: 'OPEN CHANGE PLAN' }).click();
    await page.getByPlaceholder('Tell the coach what you want to change...').waitFor();
    assert.equal(await page.getByText(/programme_exercise_id/).count(), 0);
  } else if (scenario === 'planmarkdown') {
    await page.getByRole('button', { name: /FITNESS$/ }).last().click();
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await page.getByPlaceholder('Tell the coach what you want to change...').fill('Can you change the reps on Shoulder Press to 8-10?');
    await page.getByRole('button', { name: 'SEND' }).click();
    await page.getByText(/chest gets 7 direct sets/).waitFor();
    assert.equal(await page.getByText(/\*\*/).count(), 0, 'no raw markdown');
  } else {
    throw new Error('unknown scenario ' + scenario);
  }
  assert.deepEqual(errors, []);
  console.log('PASS', scenario);
  await browser.close();
})().catch(e => { console.error('FAIL', scenario, e.message.split('\n').slice(0, 6).join(' / ')); process.exit(1); });
