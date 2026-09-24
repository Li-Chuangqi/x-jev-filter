// Shared deterministic rules. No learned keyword alone can hide a post.
(() => {
  const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = text => {
    const value = normalize(text);
    return new Set(Array.from({ length: Math.max(0, value.length - 2) }, (_, i) => value.slice(i, i + 3)));
  };
  function similarity(a, b) {
    const left = grams(a), right = grams(b);
    if (!left.size || !right.size) return 0;
    let common = 0;
    for (const word of left) if (right.has(word)) common++;
    return 2 * common / (left.size + right.size);
  }
  function features(data) {
    const text = `${data.displayName || ''} ${data.text || ''}`;
    const domains = [];
    for (const match of text.matchAll(/https?:\/\/[^\s<>]+/gi)) {
      try { domains.push(new URL(match[0]).hostname.toLowerCase()); } catch {}
    }
    const cues = ['返佣', '手续费', '带单', '邀请码', '私信', '加群', '优惠', '课程', '订阅', '推广', 'referral', 'discount', 'promo', 'subscribe']
      .filter(word => text.toLowerCase().includes(word));
    return { domains: [...new Set(domains)].slice(0, 5), cues, length: (data.text || '').length };
  }
  function prepare(data, kind) {
    if (!['post', 'similar', 'author'].includes(kind) || !data || typeof data !== 'object') throw new Error('无效屏蔽操作');
    const author = String(data.author || '').toLowerCase();
    const postId = /^\d{1,30}$/.test(String(data.id)) ? String(data.id) : '';
    const text = String(data.text || '').slice(0, 1200);
    if (!postId || !/^[a-z0-9_]{1,15}$/.test(author)) throw new Error('暂时无法确认这条内容的账号和链接，请刷新后重试');
    if (kind === 'similar' && !text.trim()) throw new Error('没有可学习的文字，请选择屏蔽账号');
    const sample = { kind, postId, author, displayName: String(data.displayName || '').slice(0, 100), text };
    return { ...sample, features: features(sample) };
  }
  globalThis.XJevLearning = { normalize, similarity, features, prepare };
})();
