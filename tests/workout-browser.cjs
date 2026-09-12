// Run against `npm run start -- --port 3100`; all remote services are mocked.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'workout-test@example.invalid', aud: 'authenticated', role: 'authenticated' };
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.test';
  const session = { name: 'Test Workout', days: ['MON','TUE','WED','THU','FRI','SAT','SUN'], exercises: [{ name: 'Test Press', sets: 4, reps: ['12–15','12–15','12–15','12–15'], tempo: '3-0-1-0' }] };
  const prior = { id: 'prior', session_name: session.name, created_at: new Date(Date.now() - 7 * 86400000).toISOString(), date: '2026-09-03', exercises: [{ name: 'Test Press', sets: Array.from({ length: 4 }, () => ({ weight: '20', reps: '12' })) }] };
  let failSave = true, saved = null;
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }));
  }, { user, token });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/chat') return route.fulfill({ json: { content: [{ text: '**Good work.** Keep the next set controlled.' }] } });
      return route.continue();
    }
    if (!url.pathname.includes('/rest/v1/') && !url.pathname.includes('/auth/v1/')) return route.abort();
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: user });
    const table = url.pathname.split('/').pop();
    if (table === 'workout_logs' && request.method() === 'POST') {
      if (failSave) return route.fulfill({ status: 503, json: { message: 'Test offline failure' } });
      saved = request.postDataJSON();
      return route.fulfill({ status: 201, json: saved });
    }
    if (table === 'workout_splits') return route.fulfill({ json: { id: 'test-split', sessions: [session] } });
    if (table === 'workout_logs') return route.fulfill({ json: url.searchParams.has('id') ? null : [prior] });
    return route.fulfill({ json: request.headers().accept?.includes('vnd.pgrst.object') ? null : [] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:3100');
  await page.getByRole('button', { name: /FITNESS$/ }).last().click();
  await page.locator('.t3d-card').filter({ has: page.getByText('REST TIMER', { exact: true }) }).getByRole('button', { name: 'OFF', exact: true }).click();
  await page.getByRole('button', { name: /START WORKOUT/ }).click();
  await page.getByRole('button', { name: 'Edit Test Press' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'tempo', exact: true }).fill('3-1-1-0');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('TEMPO: 3-1-1-0').waitFor();
  await page.getByRole('button', { name: 'CHAT WITH FITNESS COACH' }).click();
  await page.locator('strong').filter({ hasText: 'Good work.' }).waitFor();
  const replaceColor = await page.getByRole('button', { name: 'REPLACE', exact: true }).evaluate(el => getComputedStyle(el).color);
  const endColor = await page.getByRole('button', { name: 'END WORKOUT', exact: true }).evaluate(el => getComputedStyle(el).color);
  assert.notEqual(replaceColor, endColor);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('spinbutton', { name: 'Reps', exact: true }).fill(String(13 + (i === 3 ? 2 : 0)));
    await page.getByRole('spinbutton', { name: 'Weight in kilograms' }).fill('22.5');
    await page.getByRole('button', { name: 'Log set', exact: true }).click();
    if (i === 0) {
      await page.reload();
      await page.getByRole('button', { name: /ACTIVE WORKOUT/ }).click();
      await page.getByText('REST', { exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'SKIP', exact: true }).click();
  }
  await page.getByText('4 of 4 prescribed sets completed', { exact: false }).waitFor();
  assert.equal(await page.locator('.workout-progress').count(), 8);
  await page.getByRole('spinbutton', { name: 'Reps', exact: true }).fill('12');
  await page.getByRole('spinbutton', { name: 'Weight in kilograms' }).fill('23');
  await page.reload();
  await page.getByRole('button', { name: /ACTIVE WORKOUT/ }).click();
  await page.getByText('4 of 4 prescribed sets completed', { exact: false }).waitFor();
  assert.equal(await page.getByRole('spinbutton', { name: 'Reps', exact: true }).inputValue(), '12');
  assert.equal(await page.getByRole('spinbutton', { name: 'Weight in kilograms' }).inputValue(), '23');
  const inputBox = await page.getByRole('spinbutton', { name: 'Weight in kilograms' }).boundingBox();
  assert(inputBox.width >= 130 && inputBox.height >= 100, JSON.stringify(inputBox));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: 'Log set', exact: true }).click();
  await page.getByText('EXTRA 5 ✓', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit logged set', exact: true }).last().click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'weight', exact: true }).fill('24');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'SKIP', exact: true }).click();
  require('node:fs').mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/workout-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'END WORKOUT', exact: true }).click();
  await page.getByText('You completed 4 of 4 prescribed sets', { exact: false }).waitFor();
  await page.getByRole('textbox', { name: 'Workout feedback' }).fill('Good session; allow longer rest next time.');
  await page.getByRole('button', { name: 'SAVE WORKOUT & FEEDBACK' }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not save' }).waitFor();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('http://localhost:3100');
  await reopened.getByRole('button', { name: /ACTIVE WORKOUT/ }).click();
  assert.equal(await reopened.getByRole('textbox', { name: 'Workout feedback' }).inputValue(), 'Good session; allow longer rest next time.');
  failSave = false;
  await reopened.getByRole('button', { name: 'SAVE WORKOUT & FEEDBACK' }).click();
  await reopened.getByRole('button', { name: /START WORKOUT/ }).waitFor();
  assert.equal(saved.exercises[0].sets.length, 5);
  assert.equal(saved.exercises[0].sets[3].reps, '15');
  assert.equal(saved.exercises[0].sets[4].weight, '24');
  assert.equal(saved.exercises[0].workout_feedback, 'Good session; allow longer rest next time.');
  assert.equal(await reopened.evaluate(id => JSON.parse(localStorage.getItem('track3d-session-drafts:' + id + ':fitness')).data, user.id), null);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile sizing, progress indicators, final/extra sets, refresh recovery, pending input, failed-save recovery, feedback and complete saved records.');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
