// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-privacy-account.cjs <scenario>   (all remote services are mocked)
// Browser checks for privacy and safety: health data consent at sign-up and
// for existing users, withdrawing it, Download my data, Delete my account,
// calorie minimums and no requests to other sites. Scenarios:
//  consentsignup, consentgate, consentcopy, consentwithdraw, exportdata,
//  deleteaccount, calorieminimum, weeklyloss, calorieexisting, aiminimum, nothirdparty
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const scenario = process.argv[2] || 'consentgate';
const BASE = 'http://localhost:3123';
const CONSENT = { health_consent_at: '2026-10-06T08:00:00.000Z', health_consent_version: '2026-10-06' };
const londonKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const shiftKey = (key, days) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const today = londonKey();
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z', user_metadata: {} };
  if (scenario === 'consentcopy') user.user_metadata = { ...CONSENT, health_consent_at: '2026-10-06T07:30:00.000Z' };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400, aud: 'authenticated' }) + '.t';
  const signedIn = scenario !== 'consentsignup';
  if (signedIn) {
    await context.addInitScript(({ user, token }) => {
      if (sessionStorage.getItem('test-started')) return;
      sessionStorage.setItem('test-started', '1');
      localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user }));
      localStorage.setItem('track3d-weight-unit', 'kg');
      localStorage.setItem(`track3d-coach-fitness-${user.id}`, JSON.stringify({ started: true, messages: [] }));
    }, { user, token });
  }

  // The database, as the app sees it.
  const consentOnProfile = !['consentgate', 'consentcopy'].includes(scenario);
  const tables = {
    user_profiles: [{ user_id: user.id, height_cm: ['calorieminimum', 'weeklyloss'].includes(scenario) ? null : '178.0', date_of_birth: ['calorieminimum', 'weeklyloss'].includes(scenario) ? null : '1990-01-01', sex: ['calorieminimum', 'weeklyloss'].includes(scenario) ? null : scenario === 'calorieexisting' ? 'female' : 'male', ...(consentOnProfile ? CONSENT : {}) }],
    morning_checkins: [{ user_id: user.id, date: shiftKey(today, -1), score: 8, data: { weight: '80', sleep: '7h' } }],
    workout_logs: [{ id: 1, user_id: user.id, date: shiftKey(today, -2), session_name: 'Upper A', in_progress: false, total_volume: 3000, duration_mins: 50, exercises: [] }],
    nutrition_logs: [],
    nutrition_plans: [],
    habits: [{ id: 'h1', user_id: user.id, name: 'Read 10 pages', category: 'daily', created_at: '2026-01-01T00:00:00Z' }],
    habit_completions: [],
  };
  if (scenario === 'calorieexisting') tables.nutrition_plans = [{ user_id: user.id, daily_calories: 1000, protein_target: 90, carbs_target: 80, fats_target: 35, goal: 'Lose fat', updated_at: '2026-10-01T10:00:00Z',
    meals: [{ name: 'Eggs', calories: 300, protein: 25, carbs: 5, fats: 20, mealType: 'fixed', repeatDaily: true }, { name: 'Chicken Salad', calories: 400, protein: 40, carbs: 20, fats: 10, mealType: 'fixed', repeatDaily: true }, { name: 'Fish & Veg', calories: 300, protein: 25, carbs: 30, fats: 5, mealType: 'fixed', repeatDaily: true }],
    rest_day_meals: [], meal_library: [], weekly_meal_plan: {}, setup: { mode: 'custom', sex: 'Female', mealsPerDay: 3, goal: 'Lose fat' } }];
  const exportData = {
    exported_at: '2026-10-06T10:00:00Z',
    account: { id: user.id, email: user.email, created_at: user.created_at, user_metadata: CONSENT },
    tables: { morning_checkins: tables.morning_checkins, workout_logs: tables.workout_logs, nutrition_logs: [{ user_id: user.id, date: shiftKey(today, -1), total_calories: 2100 }], habits: tables.habits, user_profiles: tables.user_profiles, habit_completions: [] },
  };
  const photos = { [`${user.id}/2026-10-01/front.jpg`]: Buffer.from('front-photo-bytes'), [`${user.id}/2026-10-01/side.jpg`]: Buffer.from('side-photo-bytes'), [`${user.id}/2026-10-02/front.jpg`]: Buffer.from('second-day') };

  const requests = [];
  const writes = [];
  const rpcs = [];
  const authCalls = [];
  const storageCalls = [];
  const chats = [];
  let exports = 0;
  context.on('request', req => requests.push(req.url()));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/chat') {
        const body = JSON.parse(req.postData() || '{}');
        chats.push(body);
        if (['meal_plan_build', 'meal_plan_tweak'].includes(body.area)) {
          const first = body.messages[0].content;
          const [, kcal, protein] = first.match(/Targets: (\d+) kcal,? (?:and )?(\d+) ?g protein/);
          // A tweak asking for 800 kcal always comes back below the minimum.
          const total = body.area === 'meal_plan_tweak' ? 800 : Number(kcal);
          const per = Math.round(total / 3);
          const meals = [
            { name: body.area === 'meal_plan_tweak' ? 'Tiny Breakfast' : 'Oat Porridge', time: '08:00', ingredients: [{ name: 'Oats', weight: 60, unit: 'g' }], calories: per, protein: Math.round(protein / 3), carbs: 40, fats: 10 },
            { name: 'Chicken & Rice', time: '13:00', ingredients: [{ name: 'Chicken breast', weight: 150, unit: 'g' }], calories: per, protein: Math.round(protein / 3), carbs: 50, fats: 12 },
            { name: 'Salmon & Potatoes', time: '19:00', ingredients: [{ name: 'Salmon', weight: 180, unit: 'g' }], calories: total - 2 * per, protein: Number(protein) - 2 * Math.round(protein / 3), carbs: 45, fats: 20 },
          ];
          return route.fulfill({ json: { content: [{ text: JSON.stringify({ meals }) }] } });
        }
        return route.fulfill({ json: { content: [{ text: 'OK.' }] } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { content: [{ text: 'OK.' }] } });
      return route.continue();
    }
    if (url.pathname.includes('/auth/v1/')) {
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      authCalls.push({ method: req.method(), path: url.pathname, body });
      if (url.pathname.endsWith('/signup')) return route.fulfill({ json: { id: '22222222-2222-4222-8222-222222222222', email: body.email, aud: 'authenticated', role: 'authenticated', user_metadata: body.data || {}, created_at: new Date().toISOString(), identities: [{ id: 'i' }] } });
      if (url.pathname.endsWith('/logout')) return route.fulfill({ status: scenario === 'deleteaccount' ? 404 : 204, ...(scenario === 'deleteaccount' ? { json: { code: 404, msg: 'User not found' } } : { body: '' }) });
      if (req.method() === 'PUT' && url.pathname.endsWith('/user')) {
        user.user_metadata = { ...user.user_metadata, ...(body?.data || {}) };
        return route.fulfill({ json: user });
      }
      return route.fulfill({ json: user });
    }
    if (url.pathname.includes('/storage/v1/')) {
      storageCalls.push({ method: req.method(), path: url.pathname, body: req.postData() });
      if (url.pathname.includes('/object/list/')) {
        const { prefix } = JSON.parse(req.postData());
        const inside = Object.keys(photos).filter(key => key.startsWith(`${prefix}/`)).map(key => key.slice(prefix.length + 1));
        const folders = [...new Set(inside.filter(rest => rest.includes('/')).map(rest => rest.split('/')[0]))].map(name => ({ name, id: null, metadata: null }));
        const files = inside.filter(rest => !rest.includes('/')).map(name => ({ name, id: `id-${name}`, metadata: { size: 10 } }));
        return route.fulfill({ json: [...folders, ...files] });
      }
      if (req.method() === 'DELETE') {
        const { prefixes } = JSON.parse(req.postData());
        prefixes.forEach(key => delete photos[key]);
        return route.fulfill({ json: prefixes.map(name => ({ name })) });
      }
      const key = decodeURIComponent(url.pathname.split('/object/checkin-photos/')[1] || '');
      if (req.method() === 'GET' && photos[key]) return route.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg' }, body: photos[key] });
      return route.fulfill({ status: 404, json: { message: 'Object not found' } });
    }
    if (!url.pathname.includes('/rest/v1/')) return route.abort();
    const name = url.pathname.split('/').pop();
    if (url.pathname.includes('/rpc/')) {
      const body = JSON.parse(req.postData() || '{}');
      rpcs.push({ name, body });
      if (name === 'set_health_consent') {
        const stamp = '2026-10-06T10:00:00+00:00';
        Object.assign(tables.user_profiles[0], body.p_given ? { health_consent_at: stamp, health_consent_version: body.p_version, health_consent_withdrawn_at: null } : { health_consent_withdrawn_at: stamp });
        return route.fulfill({ json: stamp });
      }
      if (name === 'export_my_data') {
        exports += 1;
        return route.fulfill({ json: exports === 1 ? exportData : { error: 'export_limit', available_at: '2026-10-07T10:00:00+00:00' } });
      }
      if (name === 'delete_my_account') {
        if (body.p_password !== 'right-password') return route.fulfill({ json: 'wrong_password' });
        if (body.p_check_only) return route.fulfill({ json: 'ok' });
        return route.fulfill({ json: Object.keys(photos).length ? 'photos_remaining' : 'deleted' });
      }
      return route.fulfill({ status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${name}` } });
    }
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    if (req.method() !== 'GET') {
      writes.push({ table: name, method: req.method(), body: req.postData() });
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    let rows = tables[name] || [];
    const dateParam = url.searchParams.get('date');
    if (dateParam?.startsWith('eq.')) rows = rows.filter(row => String(row.date) === dateParam.slice(3));
    if (name === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = [];
    if (single && rows.length !== 1) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } });
    return route.fulfill({ json: single ? rows[0] : rows });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const openProfile = async () => {
    await page.getByRole('button', { name: 'PROFILE', exact: true }).click();
    await page.getByTestId('account-section').waitFor();
  };
  const openNutrition = async () => { await page.getByRole('button', { name: /NUTRITION$/ }).last().click(); };

  if (scenario === 'consentsignup') {
    // Sign-up can't finish without the separate consent box, and the consent
    // (time and version) goes with the new account.
    await page.goto(`${BASE}/signup`);
    const box = page.getByRole('checkbox', { name: /I agree to TRACK3D storing my health information \(weight, body photos, food, training\) to provide coaching\./ });
    await box.waitFor();
    assert.equal(await box.isChecked(), false, 'not ticked in advance');
    await page.getByLabel('Email address').fill('new@example.invalid');
    await page.getByLabel('Password (8+ characters)').fill('a-long-password');
    await page.getByLabel('Confirm password').fill('a-long-password');
    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).last().click();
    await page.waitForTimeout(800);
    assert.equal(authCalls.filter(c => c.path.endsWith('/signup')).length, 0, 'no sign-up without the tick');
    assert.equal(await box.evaluate(el => el.validity.valueMissing), true, 'the box is required');
    // Even with the browser check bypassed, the form refuses.
    await box.evaluate(el => el.removeAttribute('required'));
    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).last().click();
    await page.getByText('To create an account, tick the box to agree to TRACK3D storing your health information.').waitFor();
    assert.equal(authCalls.filter(c => c.path.endsWith('/signup')).length, 0, 'still no sign-up');
    await box.check();
    const before = Date.now();
    await page.getByRole('button', { name: 'CREATE ACCOUNT' }).last().click();
    await page.getByText('Check your email to confirm your account.').waitFor();
    const signup = authCalls.find(c => c.path.endsWith('/signup'));
    assert.equal(signup.body.data.health_consent_version, '2026-10-06');
    const at = Date.parse(signup.body.data.health_consent_at);
    assert.ok(at >= before - 5000 && at <= Date.now() + 5000, 'consent time recorded');
    if (process.env.SHOT) await page.screenshot({ path: path.join(os.tmpdir(), 'signup-consent.png'), fullPage: true });
  } else if (scenario === 'consentgate' || scenario === 'consentcopy') {
    await page.goto(`${BASE}/app`);
    if (scenario === 'consentcopy') {
      // Consent ticked at sign-up (in the account) is copied to the profile, keeping its time.
      await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      const copy = writes.find(w => w.table === 'user_profiles');
      assert.ok(copy, 'consent copied to the profile');
      const body = JSON.parse(copy.body);
      assert.equal(body.health_consent_at, '2026-10-06T07:30:00.000Z');
      assert.equal(body.health_consent_version, '2026-10-06');
      assert.equal(await page.getByTestId('consent-gate').count(), 0);
    } else {
      // An existing user without consent sees it once, before anything else.
      await page.getByTestId('consent-gate').waitFor({ timeout: 20000 });
      await page.getByText('YOUR HEALTH INFORMATION').waitFor();
      if (process.env.SHOT) await page.screenshot({ path: path.join(os.tmpdir(), 'consent-gate.png'), fullPage: true });
      assert.equal(await page.getByText('DAILY SCORE').count(), 0, 'the app is not shown');
      assert.equal(requests.filter(u => /\/rest\/v1\/(morning_checkins|workout_logs|nutrition_logs)/.test(u)).length, 0, 'no health data loaded before consent');
      const agree = page.getByRole('button', { name: 'AGREE AND CONTINUE' });
      assert.equal(await agree.isDisabled(), true, 'needs the tick');
      await page.getByTestId('health-consent-checkbox').check();
      await agree.click();
      await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
      const call = rpcs.find(r => r.name === 'set_health_consent');
      assert.deepEqual(call.body, { p_version: '2026-10-06', p_given: true });
      const update = authCalls.find(c => c.method === 'PUT');
      assert.equal(update.body.data.health_consent_version, '2026-10-06');
      assert.equal(update.body.data.health_consent_at, '2026-10-06T10:00:00+00:00', 'database time');
      // Recorded: the next visit goes straight in.
      await page.reload();
      await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
      assert.equal(await page.getByTestId('consent-gate').count(), 0, 'asked once');
    }
  } else if (scenario === 'consentwithdraw') {
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openProfile();
    await page.getByTestId('account-consent').getByText(/You agreed on 6 October 2026/).waitFor();
    await page.getByRole('button', { name: 'WITHDRAW CONSENT' }).click();
    await page.getByRole('button', { name: 'WITHDRAW MY CONSENT' }).click();
    await page.getByTestId('consent-gate').waitFor();
    await page.getByText(/You withdrew your consent on 6 October 2026/).waitFor();
    assert.deepEqual(rpcs.find(r => r.name === 'set_health_consent').body, { p_version: '2026-10-06', p_given: false });
    assert.equal(authCalls.find(c => c.method === 'PUT').body.data.health_consent_withdrawn_at, '2026-10-06T10:00:00+00:00');
    // Download and delete stay available without consent.
    await page.getByRole('button', { name: 'DOWNLOAD MY DATA' }).waitFor();
    await page.getByRole('button', { name: 'DELETE MY ACCOUNT' }).waitFor();
  } else if (scenario === 'exportdata') {
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openProfile();
    if (process.env.SHOT) await page.getByTestId('profile-dialog').screenshot({ path: path.join(os.tmpdir(), 'account-section.png') });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOWNLOAD MY DATA' }).click()]);
    assert.match(download.suggestedFilename(), /^track3d-data-\d{4}-\d{2}-\d{2}\.zip$/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track3d-export-'));
    const file = path.join(dir, 'export.zip');
    await download.saveAs(file);
    const listing = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({n: z.read(n).decode("utf-8", "replace") for n in z.namelist()}))', file]).toString());
    for (const name of ['README.txt', 'account.json', 'data/morning_checkins.json', 'data/workout_logs.json', 'data/nutrition_logs.json', 'data/habits.json', 'data/user_profiles.json', 'data/habit_completions.json', 'photos/2026-10-01/front.jpg', 'photos/2026-10-01/side.jpg', 'photos/2026-10-02/front.jpg']) assert.ok(name in listing, `missing ${name}`);
    assert.equal(JSON.parse(listing['data/morning_checkins.json'])[0].data.weight, '80');
    assert.equal(JSON.parse(listing['data/workout_logs.json'])[0].session_name, 'Upper A');
    assert.equal(JSON.parse(listing['data/habits.json'])[0].name, 'Read 10 pages');
    assert.equal(JSON.parse(listing['data/user_profiles.json'])[0].health_consent_version, '2026-10-06');
    assert.equal(JSON.parse(listing['account.json']).email, user.email);
    assert.equal(listing['photos/2026-10-01/side.jpg'], 'side-photo-bytes');
    assert.match(listing['README.txt'], /morning_checkins\.json: Morning check-ins .*1 row/);
    assert.match(listing['README.txt'], /3 photos/);
    await page.getByTestId('download-status').getByText(/Downloaded track3d-data-.*: 6 tables and 3 photos\./).waitFor();
    fs.rmSync(dir, { recursive: true, force: true });
    // One a day: the second request is turned down by the database.
    await page.getByRole('button', { name: 'DOWNLOAD MY DATA' }).click();
    await page.getByTestId('download-status').getByText(/You can download your data once a day\. Your next download is available from \d\d:\d\d on Wednesday 7 October\./).waitFor();
    assert.equal(exports, 2);
  } else if (scenario === 'deleteaccount') {
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openProfile();
    await page.getByRole('button', { name: 'DELETE MY ACCOUNT' }).click();
    const confirm = page.getByRole('button', { name: 'DELETE MY ACCOUNT FOREVER' });
    await page.getByLabel('Your password').fill('wrong-password');
    assert.equal(await confirm.isDisabled(), true, 'needs DELETE typed');
    await page.getByLabel('Type DELETE to confirm').fill('delete');
    assert.equal(await confirm.isDisabled(), true, 'exactly DELETE');
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    if (process.env.SHOT) await page.getByTestId('profile-dialog').screenshot({ path: path.join(os.tmpdir(), 'delete-form.png') });
    await confirm.click();
    await page.getByTestId('delete-status').getByText("That password isn't right. Nothing has been deleted.").waitFor();
    assert.equal(storageCalls.filter(c => c.method === 'DELETE').length, 0, 'nothing deleted after a wrong password');
    assert.equal(Object.keys(photos).length, 3);
    await page.getByLabel('Your password').fill('right-password');
    await confirm.click();
    await page.waitForURL(/\/login\?deleted=1$/, { timeout: 20000 });
    await page.getByText('Your account and data have been deleted.').waitFor();
    if (process.env.SHOT) await page.screenshot({ path: path.join(os.tmpdir(), 'deleted.png') });
    const deletes = rpcs.filter(r => r.name === 'delete_my_account');
    assert.deepEqual(deletes.map(r => r.body.p_check_only), [true, true, false], 'checked, checked, then deleted');
    assert.equal(Object.keys(photos).length, 0, 'every photo removed through storage');
    const removeCall = storageCalls.findIndex(c => c.method === 'DELETE');
    assert.ok(removeCall >= 0);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert.deepEqual(keys.filter(key => key.toLowerCase().startsWith('track3d')), [], `nothing of the account left in the browser: ${keys}`);
  } else if (scenario === 'calorieminimum') {
    // Typing 1,000 kcal in "Enter my own targets" is blocked, with an explanation.
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openNutrition();
    await page.getByRole('button', { name: 'SET UP MY NUTRITION' }).click();
    await page.getByRole('button', { name: /ENTER MY OWN TARGETS/ }).click();
    await page.getByLabel('CALORIES').fill('1000');
    await page.getByLabel('PROTEIN (g)').fill('100');
    const use = page.getByRole('button', { name: 'USE THESE TARGETS →' });
    const alert = page.getByTestId('calorie-minimum');
    await alert.getByText(/1,000 kcal a day is below TRACK3D's minimum of 1,350 kcal when sex isn't given \(1,200 for women, 1,500 for men\)/).waitFor();
    await alert.getByText(/Beat \(beateatingdisorders\.org\.uk\)/).waitFor();
    assert.equal(await use.isDisabled(), true, 'blocked');
    await page.getByRole('button', { name: 'FEMALE', exact: true }).click();
    await alert.getByText(/1,000 kcal a day is below TRACK3D's minimum of 1,200 kcal for women/).waitFor();
    assert.equal(await use.isDisabled(), true, 'still blocked');
    if (process.env.SHOT) await page.screenshot({ path: path.join(os.tmpdir(), 'calorie-minimum.png'), fullPage: true });
    await page.getByLabel('CALORIES').fill('1250');
    await use.waitFor();
    assert.equal(await alert.count(), 0);
    assert.equal(await use.isDisabled(), false, '1,250 kcal is allowed for a woman');
  } else if (scenario === 'weeklyloss') {
    // Losing more than 1% of body weight a week is warned about; below the minimum is blocked.
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openNutrition();
    await page.getByRole('button', { name: 'SET UP MY NUTRITION' }).click();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    await page.getByLabel('WEIGHT (kg)').fill('80');
    await page.getByLabel('HEIGHT (cm)').fill('180');
    await page.getByLabel('DATE OF BIRTH').fill(`${Number(today.slice(0, 4)) - 30}-01-01`);
    await page.getByRole('button', { name: 'MALE', exact: true }).click();
    await page.getByRole('button', { name: /^LOSE FAT/ }).click();
    await page.getByRole('button', { name: /^VERY ACTIVE/ }).click();
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByText('HOW MUCH STRUCTURE DO YOU WANT?').waitFor();
    assert.equal(await page.getByTestId('weekly-loss-warning').count(), 0, 'the recommended target is a safe pace');
    await page.getByRole('button', { name: 'CUSTOMISE' }).click();
    await page.getByPlaceholder('Kcal').fill('1600');
    await page.getByTestId('weekly-loss-warning').getByText(/At 1,600 kcal a day you'd lose about 1\.\d kg a week, 1\.\d% of your body weight \(maintenance is about 3,0\d\d kcal\)\. Losing more than 1% a week/).waitFor();
    const next = page.getByRole('button', { name: 'NEXT: BUILD MEALS →' });
    assert.equal(await next.isDisabled(), false, 'a warning, not a block');
    await page.getByPlaceholder('Kcal').fill('1400');
    await page.getByTestId('calorie-minimum').getByText(/1,400 kcal a day is below TRACK3D's minimum of 1,500 kcal for men/).waitFor();
    assert.equal(await next.isDisabled(), true, 'below the minimum is blocked');
  } else if (scenario === 'calorieexisting') {
    // A plan saved below the minimum is flagged, and can't be saved again until raised.
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openNutrition();
    await page.getByTestId('plan-below-minimum').getByText(/1,000 kcal a day is below TRACK3D's minimum of 1,200 kcal for women/).waitFor();
    await page.getByRole('button', { name: 'EDIT PLAN', exact: true }).click();
    await page.getByText('REVIEW YOUR PLAN').waitFor();
    await page.getByTestId('review-calorie-minimum').getByText(/Raise this before saving\./).waitFor();
    assert.equal(await page.getByRole('button', { name: /SAVE PLAN/ }).isDisabled(), true, 'save blocked');
    if (process.env.SHOT) await page.screenshot({ path: path.join(os.tmpdir(), 'review-minimum.png'), fullPage: true });
    // Raising the target clears the target problem; the meals (1,000 kcal) still block saving.
    await page.getByRole('button', { name: 'Edit targets' }).click();
    await page.getByText('ENTER YOUR DAILY TARGETS').waitFor();
    await page.getByLabel('CALORIES').fill('1600');
    await page.getByRole('button', { name: 'USE THESE TARGETS →' }).click();
    await page.getByRole('button', { name: '← BACK TO REVIEW' }).click();
    await page.getByTestId('review-calorie-minimum').getByText(/Your meals add up to 1,000 kcal, below the minimum of 1,200 kcal a day for women/).waitFor();
    assert.equal(await page.getByRole('button', { name: /SAVE PLAN/ }).isDisabled(), true, 'meals below the minimum block saving');
    assert.equal(writes.filter(w => w.table === 'nutrition_plans').length, 0);
  } else if (scenario === 'aiminimum') {
    // AI meal plans and tweaks never go below the minimum.
    await page.goto(`${BASE}/app`);
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    await openNutrition();
    await page.getByRole('button', { name: 'SET UP MY NUTRITION' }).click();
    await page.getByRole('button', { name: /STEP-BY-STEP SETUP/ }).click();
    await page.getByLabel('WEIGHT (kg)').fill('80');
    await page.getByRole('button', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'CALCULATE MY TARGETS →' }).click();
    await page.getByRole('button', { name: /SAME MEALS DAILY/ }).click();
    await page.getByRole('button', { name: 'NEXT: BUILD MEALS →' }).click();
    await page.getByText('AI build my meal plan').click();
    await page.getByPlaceholder(/peanuts, lactose/).last().fill('none');
    await page.getByRole('button', { name: 'NEXT →' }).click();
    await page.getByRole('button', { name: 'No restrictions' }).click();
    await page.getByText('Any foods you dislike or want to avoid?').waitFor();
    await page.getByRole('button', { name: 'NEXT →' }).click();
    await page.getByRole('button', { name: 'NEXT →' }).click();
    await page.getByRole('button', { name: 'About 30 minutes' }).click();
    await page.getByText('OPTIONAL').waitFor();
    await page.getByRole('button', { name: 'SKIP — BUILD MY PLAN' }).click();
    await page.getByText('Oat Porridge').waitFor();
    const build = chats.find(c => c.area === 'meal_plan_build');
    assert.match(build.messages[0].content, /Minimum daily calories: 1500 kcal\. The plan must add up to at least this, even if asked for less\./);
    await page.getByPlaceholder('Describe your changes...').fill('make it 800 calories');
    await page.getByRole('button', { name: 'APPLY' }).click();
    await page.getByText("That change would take your plan below your minimum of 1,500 kcal a day, so it wasn't made. Your plan is unchanged.").waitFor();
    const tweaks = chats.filter(c => c.area === 'meal_plan_tweak');
    assert.equal(tweaks.length, 3, 'asked again twice');
    assert.match(tweaks.at(-1).messages.at(-1).content, /Your plan adds up to 800 kcal, below the minimum of 1500 kcal a day\./);
    assert.equal(await page.getByText('Tiny Breakfast').count(), 0, 'the plan is unchanged');
    await page.getByText('Oat Porridge').waitFor();
  } else if (scenario === 'nothirdparty') {
    // No analytics or other sites: only this site and the database.
    for (const route of ['/', '/signup', '/login', '/privacy', '/app']) {
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState('networkidle');
    }
    await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
    const hosts = [...new Set(requests.map(u => new URL(u).hostname))];
    assert.deepEqual(hosts.filter(host => !['localhost', 'placeholder.supabase.co'].includes(host)), [], `other sites contacted: ${hosts}`);
    assert.ok(requests.some(u => /localhost.*\.woff2$/.test(u)), 'fonts served from this site');
    const loaded = await page.evaluate(async () => [(await document.fonts.load('700 12px Orbitron')).length, (await document.fonts.load('400 12px Inter')).length]);
    assert.ok(loaded[0] > 0 && loaded[1] > 0, `fonts available: ${loaded}`);
    await page.goto(`${BASE}/privacy`);
    await page.getByRole('heading', { name: 'Cookies and storage on your device' }).waitFor();
    await page.getByText(/doesn't use analytics, advertising or tracking cookies/).waitFor();
    await page.getByRole('heading', { name: 'Health information and your consent' }).waitFor();
    await page.getByText(/ico\.org\.uk\/make-a-complaint/).waitFor();
  } else throw new Error(`unknown scenario ${scenario}`);

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('PASS', scenario);
})().catch(error => { console.error('FAIL', scenario, error.message.split('\n').slice(0, 6).join(' | ')); process.exit(1); });
