(() => {
  function extract(article) {
    const own = selector => [...article.querySelectorAll(selector)].filter(n => n.closest('article') === article);
    // Main post timestamp occurs before any quoted post's timestamp.
    const time = own('time')[0];
    const permalink = time?.closest('a')?.getAttribute('href') || '';
    const match = permalink.match(/^\/(\w+)\/status\/(\d+)/);
    const user = own('[data-testid="User-Name"]')[0];
    // Prefer permalink identity: a display name can contain somebody else's @handle.
    const handle = match?.[1] || user?.textContent.match(/@([a-zA-Z0-9_]{1,15})\b/)?.[1] || '';
    const body = own('[data-testid="tweetText"]').map(n => n.textContent.trim()).join('\n[引用内容]\n');
    const text = body.slice(0, 5000);
    // Avoid searching post text for the words “Ad” or “广告”.
    const promoted = own('[data-testid="placementTracking"]').length > 0 || !!article.closest('[data-testid="placementTracking"]') ||
      own('[data-testid="promotedIndicator"]').length > 0;
    return { id: match?.[2] || '', author: handle.toLowerCase(), text, promoted };
  }
  globalThis.XJevDOM = { extract };
})();
