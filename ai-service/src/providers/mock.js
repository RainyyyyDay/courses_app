class MockProvider {
  async classify(input, rules) {
    const category = rules.categories.find(c => c.error_types.includes(input.error_type));
    return { review_method: category?.id || 'unclassified',
      reason: category ? 'Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。' : '信息不足或无匹配的示例规则，需要人工分类。',
      needs_review: true };
  }
}
module.exports = { MockProvider };
