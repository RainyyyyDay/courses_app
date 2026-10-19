/*
 * AI 请求适配层。这里只使用网站现有 API 基础地址；不保存密钥，也不允许客户端指定上游。
 * 当前网站尚无登录，后端会以 AI_AUTH_NOT_CONFIGURED 拒绝请求。
 */
async function classifyMistakeWithAi(input) {
  const res = await requestApi(`${API}/ai/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  return res.json();
}
