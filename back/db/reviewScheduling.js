/*
 * db/reviewScheduling.js
 * 备考总复习的排期引擎：纯函数，不读数据库、不取当前时间（日期由调用方传入）。
 *
 * 记忆模型（FSRS 的 stability 语义，公式做了可解释的简化）：
 *   S = 保持率降到 90% 所需的天数
 *   R(t) = 0.9 ^ (t / S)
 * 评分只更新 S / D / reps / lapses；排期只读这些数。
 * 以后要换成 FSRS 官方权重，只需替换 applyGrade / retrievability 两个函数，
 * review_item_states 的字段（stability / difficulty / reps / lapses）可以原样保留。
 *
 * 设计说明见 docs/review-scheduling-design.md。
 */

const DAY_MS = 86400000;
const GRADE = Object.freeze({ again: 1, hard: 2, good: 3, easy: 4 });
const MIN_STABILITY = 0.5;
const MAX_STABILITY = 1095; // 3 年
const RETENTION_BASE = 0.9;

const PROFILES = Object.freeze({
  memory: { key: 'memory', targetRetention: 0.92, repsTarget: 5, estimatedMinutes: 4, interleave: false, minInterval: 1, maxInterval: 120 },
  reasoning: { key: 'reasoning', targetRetention: 0.88, repsTarget: 3, estimatedMinutes: 8, interleave: true, minInterval: 1, maxInterval: 180 },
  balanced: { key: 'balanced', targetRetention: 0.9, repsTarget: 4, estimatedMinutes: 6, interleave: true, minInterval: 1, maxInterval: 150 },
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function toDay(value) {
  if (!isValidDate(value)) throw new Error('日期必须是真实的 YYYY-MM-DD：' + value);
  return Date.parse(value + 'T00:00:00Z') / DAY_MS;
}

function toDate(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// 内容侧的先验参数。strategy 只能由计划/单题显式给出；没有就按错题类型猜一个。
function profileFor(options = {}) {
  const strategy = ['memory', 'reasoning', 'balanced'].includes(options.strategy) ? options.strategy : null;
  if (strategy) return { ...PROFILES[strategy] };
  const mistakeType = options.mistakeType;
  if (mistakeType === 'knowledge') return { ...PROFILES.memory };
  if (mistakeType === 'thinking' || mistakeType === 'execution') return { ...PROFILES.reasoning };
  return { ...PROFILES.balanced };
}

function emptyState() {
  return {
    stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new',
    lastGrade: null, lastReviewDate: null, dueDate: null, elapsedDays: 0, scheduledDays: 0,
  };
}

function normalizeState(state) {
  const base = emptyState();
  if (!state || typeof state !== 'object') return base;
  return {
    stability: Number.isFinite(Number(state.stability)) ? Math.max(0, Number(state.stability)) : 0,
    difficulty: Number.isFinite(Number(state.difficulty)) ? clamp(Number(state.difficulty), 0, 10) : 0,
    reps: Number.isInteger(Number(state.reps)) ? Math.max(0, Number(state.reps)) : 0,
    lapses: Number.isInteger(Number(state.lapses)) ? Math.max(0, Number(state.lapses)) : 0,
    state: ['new', 'learning', 'review', 'relearning'].includes(state.state) ? state.state : base.state,
    lastGrade: Number.isInteger(Number(state.lastGrade)) && Number(state.lastGrade) >= 1 ? Number(state.lastGrade) : null,
    lastReviewDate: isValidDate(state.lastReviewDate) ? state.lastReviewDate : null,
    dueDate: isValidDate(state.dueDate) ? state.dueDate : null,
    elapsedDays: Number.isInteger(Number(state.elapsedDays)) ? Math.max(0, Number(state.elapsedDays)) : 0,
    scheduledDays: Number.isInteger(Number(state.scheduledDays)) ? Math.max(0, Number(state.scheduledDays)) : 0,
  };
}

// 在 S 天时还剩多少保持率
function retrievability(stability, elapsedDays) {
  if (!(stability > 0)) return 0;
  return clamp(Math.pow(RETENTION_BASE, Math.max(0, elapsedDays) / stability), 0, 1);
}

// 想保持 retention 的保持率，S 天稳定度对应的间隔（天，至少 1）
function intervalFor(stability, retention = RETENTION_BASE) {
  if (!(stability > 0)) return 1;
  const target = clamp(Number(retention) || RETENTION_BASE, 0.6, 0.99);
  const days = stability * (Math.log(target) / Math.log(RETENTION_BASE));
  return Math.max(1, Math.round(days));
}

// 首次复习后的稳定度（天，保持率 90%）
const FIRST_STABILITY = [0.8, 1.5, 3, 6];

function applyGrade(state, grade, reviewDate, profile) {
  const current = normalizeState(state);
  const g = Number(grade);
  if (!Number.isInteger(g) || g < 1 || g > 4) throw new Error('评分必须是 1~4');
  const today = toDay(reviewDate);
  const p = { ...PROFILES.balanced, ...(profile || {}) };
  const elapsed = current.lastReviewDate ? Math.max(0, today - toDay(current.lastReviewDate)) : 0;

  let stability = current.stability;
  let difficulty = current.difficulty;
  let lapses = current.lapses;
  const reps = current.reps + 1;

  if (!(stability > 0)) {
    stability = FIRST_STABILITY[g - 1];
    difficulty = clamp(5 + (3 - g) * 0.8, 1, 10);
  } else {
    const factor = g === GRADE.again ? 0.32
      : g === GRADE.hard ? 1.15 + (5 - difficulty) * 0.02
        : g === GRADE.good ? 1.9 + (5 - difficulty) * 0.06
          : 2.5 + (5 - difficulty) * 0.1;
    stability = stability * factor;
    difficulty = clamp(difficulty + (g === GRADE.again ? 0.8 : g === GRADE.hard ? 0.2 : g === GRADE.good ? 0 : -0.5), 1, 10);
    difficulty = difficulty * 0.96 + 5 * 0.04; // 轻微回归，避免锁死在极端
  }
  if (g === GRADE.again) lapses += 1;

  stability = clamp(stability, MIN_STABILITY, Math.min(p.maxInterval || MAX_STABILITY, MAX_STABILITY));
  const interval = clamp(intervalFor(stability, p.targetRetention), p.minInterval || 1, p.maxInterval || 365);
  return {
    stability: round(stability),
    difficulty: round(difficulty),
    reps,
    lapses,
    state: g === GRADE.again ? 'relearning' : 'review',
    lastGrade: g,
    lastReviewDate: toDate(today),
    dueDate: toDate(today + interval),
    elapsedDays: elapsed,
    scheduledDays: interval,
  };
}

// 同一优先级内也必须稳定：最后一定落到 type + id。
function compareItem(a, b) {
  return String(a.type).localeCompare(String(b.type), 'en') || Number(a.id) - Number(b.id);
}

function compareOccurrence(a, b) {
  return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || b.lapses - a.lapses
    || (a.lastGrade ?? 5) - (b.lastGrade ?? 5)
    || b.difficulty - a.difficulty
    || compareItem(a, b);
}

// 一天内的顺序：首轮按标签/类型分块，之后的轮次交错。
function orderDay(list) {
  const groupOf = item => item.groupKey || item.type || 'other';
  const bucket = (items) => {
    const map = new Map();
    for (const item of [...items].sort(compareOccurrence)) {
      const key = groupOf(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh')).map(([, rows]) => rows);
  };
  const first = list.filter(item => item.roundNo === 1 || item.reason === 'new');
  const later = list.filter(item => !(item.roundNo === 1 || item.reason === 'new'));
  const blocked = bucket(first).flat();
  const queues = bucket(later);
  const interleaved = [];
  while (queues.some(queue => queue.length)) {
    for (const queue of queues) if (queue.length) interleaved.push(queue.shift());
  }
  return [...blocked, ...interleaved];
}

/**
 * 生成某个计划从现在到考试前最后一次复习的出现安排（不落库）。
 * items: [{ type:'material'|'note'|'mistake', id, key?, profile?, groupKey?, mistakeType?, examImportance? }]
 * states: { [key]: 记忆状态 }（key 默认 type:id）
 */
function planOccurrences(options = {}) {
  const { items = [], states = {}, today, examDate, capacity = {}, profile } = options;
  const start = toDay(today);
  const exam = toDay(examDate);
  if (exam <= start) throw new Error('考试日期必须晚于今天');
  const lastDay = exam - 1;
  const horizon = exam - start;
  const dailyMinutes = Math.max(1, Math.floor(Number(capacity.dailyMinutes) || 60));
  const dailyMaxItems = Math.max(1, Math.floor(Number(capacity.dailyMaxItems) || 60));
  const baseProfile = profile ? { ...PROFILES.balanced, ...profile } : null;

  const occurrences = [];
  const perItem = [];
  for (const item of [...items].sort(compareItem)) {
    const key = item.key || item.type + ':' + item.id;
    const itemProfile = { ...(baseProfile || profileFor({ itemType: item.type, mistakeType: item.mistakeType })), ...(item.profile || {}) };
    const state = normalizeState(states[key]);
    const repsTarget = clamp(Math.ceil(horizon / 14), 1, itemProfile.repsTarget) + Math.min(2, state.lapses);
    const need = Math.max(1, repsTarget - state.reps);
    const firstDay = clamp(state.dueDate ? toDay(state.dueDate) : start, start, lastDay);
    let cursor = firstDay;
    let stability = state.stability > 0 ? state.stability : intervalFor(FIRST_STABILITY[GRADE.good - 1], itemProfile.targetRetention);
    const dates = [];
    while (dates.length < need && cursor <= lastDay) {
      dates.push(cursor);
      // 没有评分时按「Good」粗估下一次间隔，避免生成过密的日程
      stability = clamp(stability * 1.9, MIN_STABILITY, itemProfile.maxInterval || MAX_STABILITY);
      cursor += clamp(intervalFor(stability, itemProfile.targetRetention), 1, itemProfile.maxInterval || 365);
    }
    if (!dates.length) dates.push(lastDay); // 已到期在考试之后：拉回考前最后一天
    const finalWindowStart = Math.max(start, lastDay - Math.max(1, Math.round(horizon * 0.15)) + 1);
    if (dates[dates.length - 1] < finalWindowStart && dates.length < need + 1) dates.push(lastDay);

    const rows = dates.map((day, index) => ({
      type: item.type,
      id: item.id,
      key,
      groupKey: item.groupKey || item.type,
      examImportance: Number(item.examImportance) || 0,
      minutes: Math.max(1, Math.round(Number(itemProfile.estimatedMinutes) || 5)),
      lapses: state.lapses,
      difficulty: state.difficulty,
      lastGrade: state.lastGrade,
      date: toDate(day),
      roundNo: state.reps + index + 1,
      reason: index === 0 ? (state.reps > 0 ? 'due' : 'new') : day === lastDay ? 'final' : 'repeat',
      profileKey: itemProfile.key || 'balanced',
    }));
    perItem.push({ key, profileKey: itemProfile.key || 'balanced' });
    occurrences.push(...rows);
  }

  // 按天贪心装箱：放不下就顺延，顺延到考前最后一天仍放不下则记为不可行（不丢项）
  const load = new Map();
  const placed = [];
  const unscheduled = [];
  for (const row of occurrences.sort(compareOccurrence)) {
    let day = toDay(row.date);
    let slot = null;
    while (day <= lastDay) {
      const current = load.get(day) || { minutes: 0, count: 0 };
      if (current.minutes + row.minutes <= dailyMinutes && current.count < dailyMaxItems) {
        current.minutes += row.minutes;
        current.count += 1;
        load.set(day, current);
        slot = toDate(day);
        break;
      }
      day += 1;
    }
    if (slot) placed.push({ ...row, date: slot });
    else unscheduled.push(row);
  }

  const byDate = new Map();
  for (const row of placed) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  const days = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rows]) => ({ date, minutes: rows.reduce((sum, row) => sum + row.minutes, 0), items: orderDay(rows) }));

  const coverage = {};
  for (const entry of perItem) {
    const placedRows = placed.filter(row => row.key === entry.key).length;
    const bucket = coverage[entry.profileKey] || (coverage[entry.profileKey] = { items: 0, rounds: 0 });
    bucket.items += 1;
    bucket.rounds += placedRows;
  }
  for (const value of Object.values(coverage)) value.averageRounds = value.items ? round(value.rounds / value.items, 1) : 0;

  const totalMinutes = occurrences.reduce((sum, row) => sum + row.minutes, 0);
  const capacityMinutes = dailyMinutes * horizon;
  const warnings = [];
  if (unscheduled.length) warnings.push(`有 ${unscheduled.length} 项无法在考前排下，请减少题量或提高每日容量`);
  for (const [key, value] of Object.entries(coverage)) {
    // 比较基准是「这场考试的可达目标」：短周期本来就不该硬塞满 5 轮。
    const horizonTarget = PROFILES[key]
      ? clamp(Math.ceil(horizon / 14), 1, PROFILES[key].repsTarget)
      : 1;
    if (value.averageRounds < horizonTarget) {
      warnings.push(`${key} 类平均只能复习 ${value.averageRounds} 轮（这场考试的目标 ${horizonTarget} 轮）`);
    }
  }
  return {
    days,
    occurrences: placed,
    unscheduled,
    feasibility: {
      feasible: unscheduled.length === 0,
      shortfallMinutes: Math.max(0, totalMinutes - capacityMinutes),
      coverage,
      warnings,
    },
  };
}

module.exports = {
  GRADE,
  PROFILES,
  isValidDate,
  toDay,
  toDate,
  profileFor,
  emptyState,
  normalizeState,
  retrievability,
  intervalFor,
  applyGrade,
  orderDay,
  planOccurrences,
};
