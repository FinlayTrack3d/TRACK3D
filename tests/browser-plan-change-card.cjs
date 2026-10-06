// Browser regression checks. Run against a production build: npm run start -- --port 3123
// then: node tests/browser-plan-change-card.cjs <scenario>   (all remote services are mocked)
// Browser checks for the Proposed change card: a change the coach proposes
// shows directly under its message with before → after lines, APPROVE & SAVE
// and DISCARD; it scrolls into view and stays in sight while it waits.
// Scenarios: cardremove, carddiscard, cardreplace, coachcard, workoutcard
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const scenario = process.argv[2] || 'cardremove';
const BASE = 'http://localhost:3123';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 't@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400, aud: 'authenticated' }) + '.t';
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('track3d-auth', JSON.stringify({ access_token: token, refresh_token: 't', expires_at: Math.floor(Date.now() / 1000) + 30 * 86400, token_type: 'bearer', user }));
  }, { user, token });

  const approved = { approved: true };
  const sets = (n, reps) => Array.from({ length: n }, () => reps);
  let split = { id: 's', user_id: user.id, programme_started_at: '2026-09-01T08:00:00Z', sessions: [
    { name: 'Push A', days: ['SAT'], exercises: [{ name: 'Bench Press', sets: 4, reps: sets(4, '8-10') }], approval: approved },
    { name: 'Pull A', days: ['SUN'], exercises: [{ name: 'Row', sets: 3, reps: sets(3, '8-12') }], approval: approved },
    { name: 'Legs', days: ['TUE'], exercises: [{ name: 'Squat', sets: 3, reps: sets(3, '5') }], approval: approved },
    { name: 'Push B', days: ['WED'], exercises: [{ name: 'Overhead Press', sets: 3, reps: sets(3, '6-8') }], approval: approved },
    { name: 'Pull B', days: ['THU'], exercises: [{ name: 'Pull Up', sets: 3, reps: sets(3, '6-10') }], approval: approved },
    { name: 'Full Body Pump & Conditioning', days: ['FRI'], exercises: [{ name: 'Thrusters', sets: 3, reps: sets(3, '12') }], approval: approved },
  ] };
  // The fitness coach is in the workout screen: one session, every day.
  const everyDay = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  if (scenario === 'coachcard') split.sessions = [{ ...split.sessions[0], days: everyDay }];
  if (scenario === 'workoutcard') split.sessions = [{ name: 'Push A', days: everyDay, approval: approved, exercises: [
    { name: 'Bench Press', sets: 4, reps: sets(4, '8-10') },
    { name: 'Shoulder Press', sets: 3, reps: sets(3, '10') },
    { name: 'Cable Fly', sets: 3, reps: sets(3, '12-15') },
  ] }];
  const planRequests = [];
  const coachRequests = [];
  const coachActions = [];
  const splitWrites = [];

  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'localhost') {
      if (url.pathname === '/api/plan-change') {
        const body = JSON.parse(req.postData() || '{}');
        planRequests.push(body);
        const last = body.messages.at(-1).content;
        if (/full body removed/i.test(last)) return route.fulfill({ json: { message: "I'd take Full Body Pump & Conditioning out of Friday, leaving five sessions: Push A (Sat), Pull A (Sun), Legs (Tue), Push B (Wed), Pull B (Thu). Tap APPROVE & SAVE to save it.", recommendation: 'targeted', changes: [{ kind: 'remove_session', sessionName: 'Full Body Pump & Conditioning', reason: 'Not wanted' }] } });
        if (/fewer bench/i.test(last)) return route.fulfill({ json: { message: "I'd drop Bench Press to 3 sets. Tap APPROVE & SAVE to save it.", recommendation: 'targeted', changes: [{ kind: 'update_prescription', sessionName: 'Push A', exerciseName: 'Bench Press', sets: 3, reps: '8-10', reason: 'Recovery' }] } });
        if (/only 2/i.test(last)) return route.fulfill({ json: { message: "Then 2 sets of Bench Press. Tap APPROVE & SAVE to save it.", recommendation: 'targeted', changes: [{ kind: 'update_prescription', sessionName: 'Push A', exerciseName: 'Bench Press', sets: 2, reps: '8-10', reason: 'Recovery' }] } });
        return route.fulfill({ json: { message: 'Not yet. It is waiting in the Proposed change card: tap APPROVE & SAVE to save it.', recommendation: 'clarify', changes: [] } });
      }
      if (url.pathname === '/api/coach') {
        const body = JSON.parse(req.postData() || '{}');
        coachRequests.push(body);
        // Plan changes by name, as the workout coach proposes them.
        const planChange = (id, message, changes) => route.fulfill({ json: { message, insights: [], activePain: false, conversationId: 'c1', actions: [
          { id, action_type: 'propose_plan_change', scope: 'permanent', status: 'pending_approval', payload: { type: 'propose_plan_change', scope: 'permanent', reason: 'Shorter session.', changes } },
        ] } });
        if (/cable fly/i.test(body.message)) return planChange('act-plan-1', "I'd take Cable Fly out of Push A and make Bench Press 3 sets from next time. Tap APPROVE & SAVE to save it.", [
          { kind: 'remove_exercise', sessionName: 'Push A', exerciseName: 'Cable Fly' },
          { kind: 'update_prescription', sessionName: 'Push A', exerciseName: 'Bench Press', sets: 3 },
        ]);
        if (/shoulder press/i.test(body.message)) return planChange('act-plan-2', "I'd take Shoulder Press out of Push A. Tap APPROVE & SAVE to save it.", [{ kind: 'remove_exercise', sessionName: 'Push A', exerciseName: 'Shoulder Press' }]);
        if (/dumbbell/i.test(body.message)) return route.fulfill({ json: { message: "I'd swap Bench Press for Dumbbell Press in Push A from now on.", insights: [], activePain: false, conversationId: 'c1', actions: [
          { id: 'act-1', action_type: 'propose_permanent_exercise_swap', scope: 'permanent', status: 'pending_approval', payload: { type: 'propose_permanent_exercise_swap', programmeExerciseId: 'Bench Press', replacementExerciseId: 'dumbbell-press', replacementExerciseName: 'Dumbbell Press', reason: 'Easier on your shoulders.', scope: 'permanent' } },
        ] } });
        return route.fulfill({ json: { message: 'Train Push A on Saturday. Ask me anything.', insights: [], actions: [], activePain: false, conversationId: 'c1' } });
      }
      if (url.pathname === '/api/coach-action') {
        coachActions.push(JSON.parse(req.postData() || '{}'));
        return route.fulfill({ json: { ok: true } });
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
      if (table === 'workout_splits') {
        const body = JSON.parse(req.postData() || '{}');
        splitWrites.push(body);
        split = { ...split, ...body };
        return route.fulfill({ status: 201, json: single ? split : [split] });
      }
      return route.fulfill({ status: 201, json: single ? {} : [] });
    }
    let rows = [];
    if (table === 'workout_splits') rows = [split];
    if (table === 'user_profiles') rows = [{ user_id: user.id, health_consent_at: '2026-10-06T08:00:00.000Z', health_consent_version: '2026-10-06' }];
    if (table === 'workout_logs' && url.searchParams.get('in_progress') === 'eq.true') rows = [];
    return route.fulfill({ json: single ? (rows[0] || null) : rows });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}/app`);
  await page.getByText('DAILY SCORE').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /FITNESS$/ }).last().click();

  // The card follows the coach message it belongs to and is on screen.
  const cardState = async (card, message) => card.evaluate((element, text) => {
    const log = element.parentElement;
    const box = element.getBoundingClientRect();
    const area = log.getBoundingClientRect();
    return {
      underMessage: Boolean(element.previousElementSibling?.textContent.includes(text)),
      inView: box.top >= area.top - 1 && box.bottom <= area.bottom + 1 && box.top >= 0 && box.bottom <= innerHeight,
      sticky: getComputedStyle(element).position === 'sticky',
    };
  }, message);
  const ask = async text => {
    await page.getByPlaceholder('Tell the coach what you want to change...').fill(text);
    await page.getByRole('button', { name: 'SEND' }).click();
  };

  if (scenario === 'cardremove') {
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await ask('i want full body removed fully');
    const card = page.getByTestId('proposed-change');
    await card.getByText('Proposed change').waitFor();
    await card.getByText('FRI: Full Body Pump & Conditioning → Rest').waitFor();
    await card.getByRole('button', { name: 'APPROVE & SAVE' }).waitFor();
    await card.getByRole('button', { name: 'DISCARD' }).waitFor();
    await page.waitForTimeout(600);
    let state = await cardState(card, "I'd take Full Body Pump");
    assert.deepEqual(state, { underMessage: true, inView: true, sticky: true }, 'card under the message, scrolled into view');
    if (process.env.SHOT) await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'card-pending.png') });
    // Still waiting while the chat goes on: not cleared, still in sight.
    await ask('is this saved?');
    await page.getByText('Not yet. It is waiting in the Proposed change card').waitFor();
    assert.deepEqual(planRequests.at(-1).pendingChanges, ['FRI: Full Body Pump & Conditioning → Rest'], 'the coach is told what is waiting');
    assert.equal(planRequests.at(-1).messages.every(m => Object.keys(m).sort().join() === 'content,role'), true, 'only text goes to the coach');
    // Approving in words points to the card instead of asking the coach.
    const before = planRequests.length;
    await ask('i approve');
    await page.getByText("That change isn't saved yet. Tap APPROVE & SAVE on the Proposed change card to save it, or DISCARD to keep your plan as it is.").waitFor();
    assert.equal(planRequests.length, before, 'no coach request for "i approve"');
    await page.waitForTimeout(600);
    state = await cardState(card, "I'd take Full Body Pump");
    assert.equal(state.inView && state.sticky, true, 'still in sight after more messages: ' + JSON.stringify(state));
    assert.equal(await page.getByTestId('proposed-change').count(), 1);
    if (process.env.SHOT) await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'card-sticky.png') });
    assert.equal(splitWrites.length, 0, 'nothing saved before approval');
    await card.getByRole('button', { name: 'APPROVE & SAVE' }).click();
    await card.getByText('Saved to your plan ✓').waitFor();
    await page.getByText('Saved: those changes are now in your plan').waitFor();
    assert.deepEqual(splitWrites.at(-1).sessions.map(s => s.name), ['Push A', 'Pull A', 'Legs', 'Push B', 'Pull B']);
    assert.equal(await card.getAttribute('data-status'), 'saved');
    assert.equal((await cardState(card, "I'd take Full Body Pump")).sticky, false, 'no longer pinned');
    assert.equal(await card.getByRole('button', { name: 'APPROVE & SAVE' }).count(), 0);
    if (process.env.SHOT) await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'card-saved.png') });
  } else if (scenario === 'carddiscard') {
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await ask('fewer bench sets please');
    const card = page.getByTestId('proposed-change');
    await card.getByText('Push A · Bench Press: 4 × 8-10 → 3 × 8-10').waitFor();
    await card.getByRole('button', { name: 'DISCARD' }).click();
    await card.getByText("Discarded: your plan hasn't changed.").waitFor();
    await page.getByText('OK, your plan stays as it is.').waitFor();
    assert.equal(splitWrites.length, 0, 'nothing saved');
    // Closing and reopening starts afresh once nothing is waiting.
    await page.getByRole('button', { name: 'CLOSE', exact: true }).click();
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    assert.equal(await page.getByTestId('proposed-change').count(), 0);
  } else if (scenario === 'cardreplace') {
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await ask('fewer bench sets please');
    await page.getByText('Push A · Bench Press: 4 × 8-10 → 3 × 8-10').waitFor();
    // Closing the chat keeps a change that is still waiting.
    await page.getByRole('button', { name: 'CLOSE', exact: true }).click();
    await page.getByRole('button', { name: 'CHANGE PLAN' }).click();
    await page.getByText('Push A · Bench Press: 4 × 8-10 → 3 × 8-10').waitFor();
    await ask('actually only 2');
    await page.getByText('Push A · Bench Press: 4 × 8-10 → 2 × 8-10').waitFor();
    const cards = page.getByTestId('proposed-change');
    assert.equal(await cards.count(), 2);
    await cards.first().getByText("Replaced by the newer proposal below. This one wasn't saved.").waitFor();
    assert.equal(await cards.first().getByRole('button', { name: 'APPROVE & SAVE' }).count(), 0);
    await cards.last().getByRole('button', { name: 'APPROVE & SAVE' }).click();
    await cards.last().getByText('Saved to your plan ✓').waitFor();
    assert.equal(splitWrites.at(-1).sessions[0].exercises[0].sets, 2);
  } else if (scenario === 'coachcard') {
    // The fitness coach's permanent changes use the same card.
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    await page.getByRole('button', { name: 'CHAT WITH FITNESS COACH' }).click();
    const input = page.getByPlaceholder('Ask anything...');
    await input.fill('Swap bench for dumbbell press for good');
    await input.press('Enter');
    const card = page.getByTestId('proposed-change');
    await card.getByText('Push A: Bench Press → Dumbbell Press').waitFor();
    await card.getByText('Easier on your shoulders.').waitFor();
    await page.waitForTimeout(600);
    const state = await cardState(card, "I'd swap Bench Press for Dumbbell Press");
    assert.deepEqual(state, { underMessage: true, inView: true, sticky: true }, 'coach card under its message, in view');
    if (process.env.SHOT) await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'coach-card.png') });
    // Another message doesn't clear a change that is still waiting.
    await input.fill('Thanks');
    await input.press('Enter');
    await page.getByText('Train Push A on Saturday. Ask me anything.').waitFor();
    assert.equal(await card.getAttribute('data-status'), 'pending', 'still waiting after another message');
    await card.getByRole('button', { name: 'APPROVE & SAVE' }).click();
    await card.getByText('Saved to your plan ✓').waitFor();
    assert.equal(splitWrites.at(-1).sessions[0].exercises[0].name, 'Dumbbell Press');
    assert.deepEqual(coachActions.at(-1), { actionId: 'act-1', decision: 'approve' });
  } else if (scenario === 'workoutcard') {
    // A plan change asked for during a workout: the card shows in the workout
    // chat; approving saves the plan and updates today's workout.
    await page.getByRole('button', { name: /START WORKOUT/ }).first().click();
    await page.getByText('EXERCISE 1 OF 3').waitFor();
    await page.getByLabel('Weight in kilograms').fill('60');
    await page.getByRole('button', { name: 'Log set' }).click();
    await page.getByText('SET 2 OF 4').waitFor();
    await page.getByRole('button', { name: 'CHAT WITH FITNESS COACH' }).click();
    await page.getByRole('button', { name: 'MINIMISE' }).click();
    const input = page.getByPlaceholder('Ask anything...');
    await input.fill('Take cable fly out of my plan and make bench 3 sets');
    await input.press('Enter');
    const card = page.getByTestId('proposed-change');
    await card.getByText('Push A: Cable Fly 3 × 12-15 → removed').waitFor();
    await card.getByText('Push A · Bench Press: 4 × 8-10 → 3 × 8-10').waitFor();
    // The minimised chat opens, so the whole card is in sight.
    await page.getByRole('button', { name: 'MINIMISE' }).waitFor();
    await page.waitForTimeout(600);
    assert.deepEqual(await cardState(card, "I'd take Cable Fly out of Push A"), { underMessage: true, inView: true, sticky: true }, 'card under its message, in view');
    assert.deepEqual(coachRequests.at(-1).clientContext.savedPlan, [{ name: 'Push A', days: everyDay, exercises: [{ name: 'Bench Press', prescription: '4 × 8-10' }, { name: 'Shoulder Press', prescription: '3 × 10' }, { name: 'Cable Fly', prescription: '3 × 12-15' }] }], 'the coach sees the plan by name');
    if (process.env.SHOT) await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'workout-card.png') });
    // Approving in words points to the card instead of asking the coach.
    const before = coachRequests.length;
    await input.fill('i approve');
    await input.press('Enter');
    await page.getByText("That change isn't saved yet. Tap APPROVE & SAVE on the Proposed change card to save it, or DISCARD to keep your plan as it is.").waitFor();
    assert.equal(coachRequests.length, before, 'no coach request for "i approve"');
    assert.equal(splitWrites.length, 0, 'nothing saved before approval');
    await card.getByRole('button', { name: 'APPROVE & SAVE' }).click();
    await card.getByText('Saved to your plan ✓').waitFor();
    await page.getByText("Saved: those changes are now in your plan. Today's workout is updated too.").waitFor();
    assert.deepEqual(splitWrites.at(-1).sessions[0].exercises.map(e => `${e.name} ${e.sets}`), ['Bench Press 3', 'Shoulder Press 3']);
    assert.deepEqual(coachActions.at(-1), { actionId: 'act-plan-1', decision: 'approve' });
    // Today's workout follows: Cable Fly is gone, Bench Press is 3 sets, set 1 is still logged.
    await page.getByRole('button', { name: 'MINIMISE' }).click();
    await page.getByText('EXERCISE 1 OF 2').waitFor();
    await page.getByText('SET 2 OF 3').waitFor();
    await page.getByText('1 SET COMPLETE ✓').waitFor();
    // Another proposal can be discarded; the plan stays as it is.
    await page.getByRole('button', { name: 'OPEN', exact: true }).click();
    await input.fill('drop shoulder press for good');
    await input.press('Enter');
    const second = page.getByTestId('proposed-change').last();
    await second.getByText('Push A: Shoulder Press 3 × 10 → removed').waitFor();
    await second.getByRole('button', { name: 'DISCARD' }).click();
    await second.getByText("Discarded: your plan hasn't changed.").waitFor();
    assert.deepEqual(coachActions.at(-1), { actionId: 'act-plan-2', decision: 'reject' });
    assert.equal(splitWrites.length, 1, 'nothing more saved');
    // Kept with the chat, so the cards stay under their messages after a reload.
    const kept = await page.evaluate(id => JSON.parse(localStorage.getItem(`track3d-coach-fitness-${id}`)).actions.map(action => `${action.id} ${action.status}`), user.id);
    assert.deepEqual(kept, ['act-plan-1 applied', 'act-plan-2 rejected']);
  } else {
    throw new Error('unknown scenario ' + scenario);
  }
  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('PASS', scenario);
})().catch(e => { console.error('FAIL', scenario, e.message.split('\n').slice(0, 6).join(' / ')); process.exit(1); });
