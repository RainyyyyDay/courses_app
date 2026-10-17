const assert = require('node:assert/strict');
const path = require('node:path');

const sched = require(path.join(__dirname, '..', 'back', 'db', 'reviewScheduling.js'));

function todayText() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(text, days) {
  const time = Date.parse(text + 'T00:00:00Z') + days * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

function testReviewSchedulingUnit() {
  // 日期与工具
  assert.equal(sched.isValidDate('2026-02-28'), true);
  assert.equal(sched.isValidDate('2026-02-30'), false);
  assert.equal(sched.toDate(sched.toDay('2026-12-31') + 1), '2027-01-01');
  assert.throws(() => sched.toDay('bad'));

  // 参数先验
  assert.equal(sched.profileFor({ strategy: 'memory' }).key, 'memory');
  assert.equal(sched.profileFor({ mistakeType: 'knowledge' }).key, 'memory');
  assert.equal(sched.profileFor({ mistakeType: 'thinking' }).key, 'reasoning');
  assert.equal(sched.profileFor({}).key, 'balanced');

  // 保持率与间隔
  assert.equal(sched.retrievability(10, 0), 1);
  assert.ok(Math.abs(sched.retrievability(10, 10) - 0.9) < 1e-9);
  assert.ok(sched.retrievability(10, 25) < sched.retrievability(10, 10));
  assert.equal(sched.intervalFor(10, 0.9), 10);
  assert.ok(sched.intervalFor(10, 0.95) < sched.intervalFor(10, 0.85));

  // 评分：档位越高间隔越长；Again 收缩并累计 lapses
  const base = {
    stability: 10, difficulty: 5, reps: 2, lapses: 0, state: 'review',
    lastGrade: 3, lastReviewDate: '2026-01-01', dueDate: '2026-01-11',
  };
  const again = sched.applyGrade(base, 1, '2026-01-11');
  const hard = sched.applyGrade(base, 2, '2026-01-11');
  const good = sched.applyGrade(base, 3, '2026-01-11');
  const easy = sched.applyGrade(base, 4, '2026-01-11');
  assert.ok(again.scheduledDays <= hard.scheduledDays && hard.scheduledDays <= good.scheduledDays && good.scheduledDays <= easy.scheduledDays, 'grade 越高间隔越长');
  assert.equal(again.lapses, 1);
  assert.equal(again.reps, 3);
  assert.equal(again.state, 'relearning');
  assert.ok(again.dueDate > '2026-01-11' || again.scheduledDays === 1);
  assert.throws(() => sched.applyGrade(base, 5, '2026-01-11'));

  // 排期：顺序无关、确定性、考试日边界、容量上限
  const items = [
    { type: 'material', id: 1, groupKey: 'A' },
    { type: 'material', id: 2, groupKey: 'A' },
    { type: 'note', id: 3, groupKey: 'B' },
    { type: 'mistake', id: 4, groupKey: 'B', mistakeType: 'knowledge' },
    { type: 'mistake', id: 5, groupKey: 'C', mistakeType: 'thinking' },
  ];
  const options = {
    items, states: {}, today: '2026-03-01', examDate: '2026-03-21',
    capacity: { dailyMinutes: 30, dailyMaxItems: 10 }, profile: sched.PROFILES.memory,
  };
  const plan = sched.planOccurrences(options);
  const reversed = sched.planOccurrences({ ...options, items: [...items].reverse() });
  assert.deepEqual(plan.occurrences, reversed.occurrences, '输入顺序不影响结果');
  assert.deepEqual(plan.days, reversed.days);
  assert.ok(plan.occurrences.length > 0);
  for (const day of plan.days) {
    assert.ok(day.date < '2026-03-21', '考试当天不排');
    assert.ok(day.minutes <= 30, '每日分钟上限');
    assert.ok(day.items.length <= 10, '每日条数上限');
    const firstRepeat = day.items.findIndex(item => item.reason !== 'new' && item.roundNo !== 1);
    if (firstRepeat >= 0) {
      assert.ok(day.items.slice(firstRepeat).every(item => item.reason !== 'new' && item.roundNo !== 1), '首轮分块在复轮之前');
    }
  }
  assert.equal(plan.feasibility.feasible, true);

  // 容量极小时不可行，但不丢项
  const tight = sched.planOccurrences({ ...options, capacity: { dailyMinutes: 5, dailyMaxItems: 1 } });
  assert.equal(tight.feasibility.feasible, false);
  assert.ok(tight.feasibility.warnings.length > 0);
  assert.equal(tight.occurrences.length + tight.unscheduled.length, plan.occurrences.length, '不可行时也不丢项');

  // 逾期项立刻进入今天；考试日边界
  const overdue = sched.planOccurrences({
    ...options,
    states: { 'material:1': { stability: 20, difficulty: 5, reps: 2, lapses: 0, state: 'review', lastGrade: 3, lastReviewDate: '2026-01-01', dueDate: '2026-01-15' } },
    items: [{ type: 'material', id: 1 }],
  });
  assert.equal(overdue.occurrences[0].date, '2026-03-01', '逾期项排到今天');
  assert.ok(overdue.occurrences.every(row => row.date < '2026-03-21'));

  // 非法考试日
  assert.throws(() => sched.planOccurrences({ items, today: '2026-03-01', examDate: '2026-03-01' }));
  console.log('PASS review scheduling: pure functions, determinism, exam boundary, capacity, interleaving, no dropped items');
}

async function testReviewSchedulingApi({ base, course }) {
  let sequence = 0;
  async function request(method, endpoint, body, status = 200) {
    const response = await fetch(base + endpoint, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const json = await response.json();
    assert.equal(response.status, status, `${method} ${endpoint}: ${JSON.stringify(json)}`);
    return json;
  }

  const today = todayText();
  const mistake = await request('POST', `/courses/${course.id}/mistakes`, {
    title: '排期测试题', content: '排期测试题面', answerContent: '排期测试答案', mistakeType: 'knowledge',
  }, 201);

  const initial = await request('GET', `/courses/${course.id}/review-items/mistake/${mistake.id}/state`);
  assert.equal(initial.state, 'new');
  assert.equal(initial.reps, 0);
  assert.equal(initial.dueDate, null);

  const graded = await request('POST', `/courses/${course.id}/review-items/mistake/${mistake.id}/grade`, { grade: 3, reviewDate: today });
  assert.equal(graded.reps, 1);
  assert.ok(graded.stability > 0);
  assert.ok(graded.dueDate > today);
  assert.equal(graded.lastGrade, 3);

  const reread = await request('GET', `/courses/${course.id}/review-items/mistake/${mistake.id}/state`);
  assert.equal(reread.dueDate, graded.dueDate);
  assert.equal(reread.reps, 1);

  await request('POST', `/courses/${course.id}/review-items/mistake/${mistake.id}/grade`, { grade: 5 }, 400);
  await request('POST', `/courses/${course.id}/review-items/mistake/${mistake.id}/grade`, { reviewDate: '2026-02-30' }, 400);
  await request('GET', `/courses/${course.id}/review-items/bad/${mistake.id}/state`, undefined, 400);
  await request('GET', `/courses/999999/review-items/mistake/${mistake.id}/state`, undefined, 404);

  // 同一会话项目重复提交只记一次（幂等）
  const session = await request('POST', `/courses/${course.id}/review-sessions`, {
    requestId: 'scheduling-' + (++sequence), sourceType: 'mistake', selectedItems: [{ type: 'mistake', id: mistake.id }],
  }, 201);
  const sessionItemId = session.items[0].id;
  const first = await request('POST', `/courses/${course.id}/review-items/mistake/${mistake.id}/grade`, { grade: 4, sessionItemId, reviewDate: today });
  const second = await request('POST', `/courses/${course.id}/review-items/mistake/${mistake.id}/grade`, { grade: 4, sessionItemId, reviewDate: today });
  assert.equal(second.duplicate, true);
  assert.equal(second.reps, first.reps);
  const eventCount = (await request('GET', `/courses/${course.id}/review-items/mistake/${mistake.id}/state`)).reps;
  assert.equal(eventCount, 2);

  // 真实复习流程 → 自动记分（知识类：清楚 + 正确映射为 Good）
  const flow = await request('POST', `/courses/${course.id}/mistakes`, {
    title: '流程记分题', content: '流程题面', answerContent: '流程答案', mistakeType: 'knowledge',
  }, 201);
  const flowSession = await request('POST', `/courses/${course.id}/review-sessions`, {
    requestId: 'scheduling-flow-' + (++sequence), sourceType: 'mistake', selectedItems: [{ type: 'mistake', id: flow.id }],
  }, 201);
  const flowItem = flowSession.items[0].id;
  const flowPath = `/courses/${course.id}/mistakes/${flow.id}/review`;
  let progress = await request('POST', `${flowPath}?sessionItemId=${flowItem}`, { action: 'start', requestId: 'flow-start', expectedVersion: 0 });
  progress = await request('POST', `${flowPath}/events?sessionItemId=${flowItem}`,
    { action: 'recall', recall: 'clear', requestId: 'flow-recall', expectedVersion: progress.version });
  progress = await request('POST', `${flowPath}/events?sessionItemId=${flowItem}`,
    { action: 'judge', correct: true, requestId: 'flow-judge', expectedVersion: progress.version });
  assert.equal(progress.stage, 'completed');
  const flowState = await request('GET', `/courses/${course.id}/review-items/mistake/${flow.id}/state`);
  assert.equal(flowState.reps, 1, '真实复习流程应自动记一次分');
  assert.equal(flowState.lastGrade, 3, '清楚 + 正确 = Good');
  assert.ok(flowState.dueDate > today);

  // 计划排期预览：所有出现日都在考试日之前
  const plan = await request('POST', `/courses/${course.id}/review-plans`, {
    name: '排期预览计划', startDate: today, examDate: addDays(today, 14),
    selectedItems: [{ type: 'mistake', id: mistake.id }],
  }, 201);
  const schedule = await request('GET', `/courses/${course.id}/review-plans/${plan.id}/schedule`);
  assert.equal(schedule.planId, plan.id);
  assert.ok(Array.isArray(schedule.days));
  assert.ok(schedule.occurrences.length > 0);
  const examDate = addDays(today, 14);
  for (const row of schedule.occurrences) assert.ok(row.date < examDate, '排期不能落在考试日');
  for (const day of schedule.days) assert.ok(day.minutes <= schedule.dailyMinutes);
  assert.equal(typeof schedule.feasibility.feasible, 'boolean');

  console.log('PASS review scheduling API: state/grade persistence, validation, session idempotency, plan schedule preview');
}

module.exports = { testReviewSchedulingUnit, testReviewSchedulingApi };
