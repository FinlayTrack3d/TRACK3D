// Browser checks for the AI coach review (sections F-J). Scenarios:
//  nutritionhistory, roundup, roundupfail, weeklysavefail, painresolve, coachstyle, setuplevel,
//  nutritionedit, nutritionnocolumn, nutritionlegacy, nutritionai,
//  reviewskip, dashexcludes, changeplanhint, planmarkdown, streamchat, streamcoach, streamerror
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
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
    nutrition_plans: scenario === 'nutritionai' ? [] : [{ user_id: user.id, daily_calories: 2100, protein_target: 135, carbs_target: 230, fats_target: 65, meals, rest_day_meals: [], meal_library: [], weekly_meal_plan: {},
      goal: scenario === 'nutritionlegacy' ? 'Cut (lose fat)' : ['nutritionedit', 'nutritionnocolumn'].includes(scenario) ? 'Lose fat' : 'maintain',
      ...(['nutritionedit', 'nutritionnocolumn'].includes(scenario) ? { setup: { mode: 'guided', weight: 82, height: 180, age: 34, sex: 'Male', activityLevel: 'Lightly active', goal: 'Lose fat', mealsPerDay: 3, wakeTime: '06:15', answers: { allergies: 'peanuts', diet_type: 'No restrictions' } } } : {}) }],
    ...(scenario === 'nutritionlegacy' ? { morning_checkins: [{ date: yesterday, score: 7, data: { weight: '79.5' } }] } : {}),
    ...(scenario === 'nutritionai' ? { morning_routines: [{ user_id: user.id, wake_time: '05:30', tasks: [] }] } : {}),
    nutrition_logs: [
      { id: 'n1', user_id: user.id, date: today, total_calories: 1300, total_protein: 85, meals_completed: { 0: true, 1: true, 2: { completed: false, note: 'large pepperoni pizza and two beers' }, _review_complete: scenario !== 'reviewskip' }, off_plan_food: scenario === 'reviewskip' || scenario === 'dashexcludes' ? '' : 'large pepperoni pizza, two beers', off_plan_calories: null },
      { id: 'n0', user_id: user.id, date: yesterday, total_calories: 2050, total_protein: 130, meals_completed: [true, true, true] },
    ],
    daily_debrief: [{ overall_score: 7, task_scores: {} }],
    calendar_tasks: [{ title: 'Gym', status: 'done' }, { title: 'Emails', status: 'pending' }],
    workout_logs: scenario === 'dashexcludes' ? [{ id: 'w1', user_id: user.id, date: today, session_name: 'Push A', in_progress: false, total_volume: 3000, duration_mins: 50, exercises: [{ name: 'Bench Press', sets: [{ weight: '80', reps: '6', personalBest: { type: 'weight_pb', label: 'Weight PB' } }, { weight: '80', reps: '5' }] }] }] : [],
    workout_splits: ['painresolve', 'changeplanhint', 'planmarkdown', 'streamcoach'].includes(scenario) ? [{ id: 's', user_id: user.id, programme_started_at: new Date().toISOString(), sessions: [{ name: 'Push A', days: [['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(`${today}T12:00:00Z`).getUTCDay()]], exercises: [{ name: 'Dumbbell Shoulder Press', sets: 4, reps: ['10','10','10','10'] }], approval: { approved: true } }] }] : [],
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
        if (body.stream && scenario === 'streamchat') return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-coach-stream': '1' }, body: 'Streamed: you have logged 1,300 kcal of your 2,100 kcal target.' });
        if (body.stream && scenario === 'streamerror') return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-coach-stream': '1' }, body: 'Partial reply that gets cut\u0000ERROR:Coach provider failed: stream error' });
        if (body.area === 'food_estimate') return route.fulfill({ json: { content: [{ text: JSON.stringify({ items: [{ name: 'Large pepperoni pizza', amount: '1 large (as stated)', calories_low: 1800, calories_high: 2400, protein_low: 70, protein_high: 95 }, { name: 'Beer', amount: '2 (as stated)', calories_low: 360, calories_high: 480, protein_low: 2, protein_high: 4 }] }) }] } });
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
      if (table === 'nutrition_plans' && scenario === 'nutritionnocolumn' && /"setup"/.test(req.postData() || '')) return route.fulfill({ status: 400, json: { code: 'PGRST204', message: "Could not find the 'setup' column of 'nutrition_plans' in the schema cache" } });
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    if (table === 'weekly_reports' && scenario === 'weeklysavefail') return route.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.weekly_reports' in the schema cache" } });
    let rows = tables[table] || [];
    if (table === 'nutrition_logs' || table === 'morning_checkins') {
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

  const openNutrition = async () => {
    await page.getByRole('button', { name: /NUTRITION$/ }).last().click();
  };
  const planWrite = () => { const w = writes.filter(w => w.table === 'nutrition_plans' && w.method !== 'GET' && JSON.parse(w.body).daily_calories).at(-1); return w && JSON.parse(w.body); };
  if (scenario === 'nutritionnocolumn') {
    await openNutrition();
    await page.getByRole('button', { name: 'EDIT PLAN' }).click();
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
    await page.getByRole('button', { name: 'EDIT PLAN' }).click();
    assert.equal(await page.getByLabel('WEIGHT (kg)').inputValue(), '82');
    assert.equal(await page.getByLabel('HEIGHT (cm)').inputValue(), '180');
    assert.equal(await page.getByLabel('AGE').inputValue(), '34');
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByText(/Based on 82 kg, 180 cm, age 34 · Lose fat · Lightly active/).waitFor();
    await page.getByRole('button', { name: 'NEXT: BUILD MEALS →' }).click();
    assert.equal(await page.getByLabel('Wake-up time').inputValue(), '06:15');
    assert.equal(await page.getByLabel('Allergies or intolerances').inputValue(), 'peanuts');
    await page.getByRole('button', { name: 'REVIEW →' }).click();
    await page.getByRole('button', { name: /SAVE PLAN/ }).click();
    await page.getByRole('button', { name: 'EDIT PLAN' }).waitFor();
    const saved = planWrite();
    assert.equal(saved.goal, 'Lose fat', 'goal kept, not Maintain');
    assert.equal(saved.setup.weight, 82);
    assert.equal(saved.setup.answers.allergies, 'peanuts');
    // Mifflin-St Jeor 1780 x 1.375 = 2448, minus 0.5% of 82 kg a week (451/day) = 1997
    assert.equal(saved.daily_calories, 2000);
    assert.equal(saved.protein_target, 180);
  } else if (scenario === 'nutritionlegacy') {
    await openNutrition();
    await page.getByRole('button', { name: 'EDIT PLAN' }).click();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    assert.equal(await page.getByLabel('WEIGHT (kg)').inputValue(), '79.5', 'weight from last weigh-in');
    await page.getByText('Weight from your last morning check-in.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).isDisabled(), true, 'needs height, age, sex');
    await page.getByLabel('HEIGHT (cm)').fill('175');
    await page.getByLabel('AGE').fill('40');
    await page.getByRole('button', { name: 'FEMALE' }).click();
    if (process.env.SHOT) await page.screenshot({ path: 'nut-goals.png', fullPage: true });
    const activity = await page.getByTestId('activity-option').first().textContent();
    assert.match(activity, /Desk job/, 'activity levels are described');
    assert.match(activity, /≈ [\d,]+ kcal/, 'each level shows its calories');
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByText(/Based on 79.5 kg, 175 cm, age 40 · Lose fat/).waitFor();
  } else if (scenario === 'nutritionai') {
    await openNutrition();
    await page.getByRole('button', { name: 'SET UP MY NUTRITION' }).click();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    await page.getByLabel('WEIGHT (kg)').fill('80');
    await page.getByLabel('HEIGHT (cm)').fill('180');
    await page.getByLabel('AGE').fill('30');
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
    await page.getByText(/Meals run from 06:30 to 18:30/).waitFor();
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
