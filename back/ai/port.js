/*
 * AI 端口：业务只依赖这里的方法，不直接依赖某家云服务。
 *
 * - mock：本地确定性实现，用于模式开发、UI 联调和契约测试。
 * - http：把同样的请求转发到队友的 AI 服务（AI_API_BASE）。
 *
 * 注意：挖空答案由本地后端保存，不通过 HTTP 接口下发给浏览器。
 */

function timeoutError() {
  return Object.assign(new Error('AI 服务超时'), { status: 504, code: 'AI_TIMEOUT' });
}

function unavailableError(message = 'AI 服务暂不可用') {
  return Object.assign(new Error(message), { status: 502, code: 'AI_UNAVAILABLE' });
}

const {normalizeAnswer}=require('../db/reviewAnswers');

function mockProvider() {
  return {
    name: 'mock',
    async generateCloze({ text, blankCount = 3 }) {
      const source = String(text || '');
      const candidates = [];
      const seen = new Set();
      for (const match of source.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g)) {
        const value = match[0];
        if (seen.has(value) || value.length < 2) continue;
        seen.add(value);
        candidates.push(value);
        if (candidates.length >= blankCount) break;
      }
      let clozeText = source;
      const blanks = candidates.map((answer, index) => {
        const id = 'b' + (index + 1);
        clozeText = clozeText.replace(answer, `【${id}】`);
        return { id, answer, hint: answer.slice(0, 1) + '…' };
      });
      return { clozeText, blanks, needsReview: true };
    },
    async evaluateAnswer({ studentAnswer, referenceAnswer }) {
      const student = normalizeAnswer(studentAnswer);
      const reference = normalizeAnswer(referenceAnswer);
      if (!student || !reference) {
        return { judgment: 'uncertain', coverage: 0, reason: '信息不足，建议人工复核。', needsReview: true };
      }
      if (student === reference) {
        return { judgment: 'correct', coverage: 1, reason: '与参考答案一致。', needsReview: true };
      }
      if (student.includes(reference) || reference.includes(student)) {
        return { judgment: 'partial', coverage: 0.6, reason: '覆盖了部分关键内容，建议人工确认。', needsReview: true };
      }
      return { judgment: 'incorrect', coverage: 0, reason: '与参考答案差异较大。', needsReview: true };
    },
    async recommendMode({ itemType = 'note', text = '' }) {
      if (itemType === 'mistake') {
        return { modeId: 'standard', confidence: 0.5, reason: 'Mock：先按标准复习处理。', needsReview: true };
      }
      return {
        modeId: String(text).length >= 80 ? 'cloze' : 'standard',
        confidence: 0.55,
        reason: 'Mock：长文本优先建议挖空，仍需用户确认。',
        needsReview: true,
      };
    },
  };
}

function httpProvider({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15000 }) {
  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw unavailableError(json?.error || json?.message || `AI HTTP ${response.status}`);
      if (!json || typeof json !== 'object') throw unavailableError('AI 返回格式不正确');
      return json;
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'AI_TIMEOUT') throw timeoutError();
      if (err.status) throw err;
      throw unavailableError(err.message || 'AI 网络连接失败');
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    name: 'http',
    generateCloze: (input) => request('/api/ai/cloze', input),
    evaluateAnswer: (input) => request('/api/ai/evaluate-answer', input),
    recommendMode: (input) => request('/api/ai/recommend-mode', input),
  };
}

function createAiPort(overrides = {}) {
  const provider = overrides.provider || process.env.AI_PROVIDER || 'mock';
  if (provider === 'http') {
    return httpProvider({
      baseUrl: overrides.baseUrl || process.env.AI_API_BASE || 'http://127.0.0.1:3001',
      token: overrides.token || process.env.AI_SERVICE_TOKEN || '',
      fetchImpl: overrides.fetchImpl,
      timeoutMs: overrides.timeoutMs,
    });
  }
  return mockProvider();
}

module.exports = { createAiPort, normalizeAnswer };
