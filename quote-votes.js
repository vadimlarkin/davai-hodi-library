'use strict';
(() => {
  const content = document.getElementById('detail-content');
  const base = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:63130' : 'https://podcast.boardgamer.ru/library-feedback';
  const key = 'davai-hodi-voter-v1';
  let visitor, persistent = true, generation = 0;
  try {
    visitor = localStorage.getItem(key);
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(visitor || '')) {
      visitor = crypto.randomUUID(); localStorage.setItem(key, visitor);
    }
  } catch { visitor = crypto.randomUUID(); persistent = false; }
  const states = new Map(), retries = new Map(), pending = new Set();
  const signed = n => n > 0 ? '+' + n : String(n);
  const widgets = id => [...content.querySelectorAll('[data-vote-quote]')].filter(e => e.dataset.voteQuote === id);
  function render(item, message = '') {
    states.set(item.quote_id, item);
    for (const widget of widgets(item.quote_id)) {
      widget.querySelector('[data-vote-refresh]').hidden = true;
      const score = widget.querySelector('[data-vote-score]');
      score.textContent = signed(item.score);
      score.title = `За: ${item.up}. Против: ${item.down}.`;
      score.setAttribute('aria-label', 'Рейтинг цитаты: ' + signed(item.score));
      for (const button of widget.querySelectorAll('[data-vote-value]')) {
        button.disabled = pending.has(item.quote_id);
        button.setAttribute('aria-pressed', String(Number(button.dataset.voteValue) === item.mine));
      }
      widget.querySelector('[data-vote-note]').textContent = message || (!persistent ? 'Голос запоминается только до обновления страницы.' : '');
    }
  }
  async function request(path, payload) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({visitor_id: visitor, ...payload}), credentials: 'omit', signal: controller.signal});
      if (!response.ok) throw new Error(response.status === 429 ? 'Слишком много голосов. Попробуйте позже.' : 'Голосование временно недоступно.');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    const current = ++generation;
    const ids = [...new Set([...content.querySelectorAll('[data-vote-quote]')].map(e => e.dataset.voteQuote))];
    for (const id of ids) if (states.has(id)) render(states.get(id), retries.has(id) ? 'Нет подтверждения. Нажмите стрелку ещё раз для повтора.' : '');
    for (let start = 0; start < ids.length; start += 60) {
      const group = ids.slice(start, start + 60);
      try {
        const result = await request('/votes/read', {quote_ids: group});
        if (current !== generation) return;
        for (const item of result.items) if (!pending.has(item.quote_id) && !retries.has(item.quote_id)) render(item);
      } catch {
        if (current !== generation) return;
        for (const id of group) for (const widget of widgets(id)) {
          if (!states.has(id)) widget.querySelector('[data-vote-score]').textContent = '—';
          widget.querySelector('[data-vote-note]').textContent = 'Рейтинг временно недоступен.';
          widget.querySelector('[data-vote-refresh]').hidden = false;
        }
      }
    }
  }
  content.addEventListener('click', async event => {
    if (event.target.closest('[data-vote-refresh]')) { refresh(); return; }
    const button = event.target.closest('[data-vote-value]');
    const widget = button?.closest('[data-vote-quote]');
    if (!widget || pending.has(widget.dataset.voteQuote)) return;
    const id = widget.dataset.voteQuote, item = states.get(id);
    if (!item) return;
    const value = Number(button.dataset.voteValue);
    const desired = item.mine === value ? 0 : value;
    const previous = retries.get(id);
    const payload = previous?.value === desired ? previous : {quote_id: id, value: desired, request_id: crypto.randomUUID()};
    retries.set(id, payload); pending.add(id); ++generation;
    render(item, 'Сохраняем голос…');
    try {
      const result = await request('/votes', payload);
      if (result.status !== 'saved' || result.id !== payload.request_id || result.item?.quote_id !== id) throw new Error('Нет подтверждения сохранения.');
      retries.delete(id); pending.delete(id);
      render(result.item, result.item.mine ? 'Ваш голос сохранён.' : 'Голос снят.');
    } catch (error) {
      pending.delete(id);
      render(item, `${error.message || 'Нет подтверждения.'} Нажмите стрелку ещё раз для повтора.`);
    }
  });
  new MutationObserver(refresh).observe(content, {childList: true});
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) refresh();});
  setInterval(() => {if (!document.hidden) refresh();}, 30000);
  refresh();
})();
