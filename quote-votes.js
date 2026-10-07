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
  const originalOrder = new WeakMap();
  let nextOrder = 0;
  function sortQuotes() {
    // Leave a phrase selection intact while the reader is preparing a correction.
    if (selectedId === goldenId) return;
    const selection = window.getSelection();
    if (pending.size || content.querySelector('[data-correction-controls]') ||
        (selection && !selection.isCollapsed && content.contains(selection.anchorNode))) return;
    const articles = [...content.querySelectorAll('.quote-item')];
    for (const article of articles) if (!originalOrder.has(article)) originalOrder.set(article, nextOrder++);
    const ordered = [...articles].sort((a, b) =>
      (states.get(b.id)?.score ?? 0) - (states.get(a.id)?.score ?? 0) || originalOrder.get(a) - originalOrder.get(b));
    if (articles.every((article, index) => article === ordered[index])) return;
    const active = document.activeElement;
    const activeTop = active?.getBoundingClientRect().top;
    observer.disconnect();
    try {
      // Move the existing nodes so playback and correction controls keep their state.
      for (let index = 0; index < ordered.length; index++) {
        const current = content.querySelectorAll('.quote-item')[index];
        if (current !== ordered[index]) {
          if (typeof content.moveBefore === 'function') content.moveBefore(ordered[index], current);
          else content.insertBefore(ordered[index], current);
        }
      }
      if (active && content.contains(active)) {
        if (document.activeElement !== active) active.focus({preventScroll: true});
        if (active.closest('.quote-item')) document.getElementById('details').scrollTop += active.getBoundingClientRect().top - activeTop;
      }
    } finally { observer.observe(content, {childList: true}); }
  }
  function render(item, message = '') {
    states.set(item.quote_id, item);
    for (const widget of widgets(item.quote_id)) {
      widget.closest('.quote-feedback-row').querySelector('[data-vote-refresh]').hidden = true;
      const score = widget.querySelector('[data-vote-score]');
      score.textContent = signed(item.score);
      score.title = `За: ${item.up}. Против: ${item.down}.`;
      score.setAttribute('aria-label', 'Рейтинг цитаты: ' + signed(item.score));
      for (const button of widget.querySelectorAll('[data-vote-value]')) {
        button.disabled = pending.has(item.quote_id);
        button.setAttribute('aria-pressed', String(Number(button.dataset.voteValue) === item.mine));
      }
      widget.closest('.quote-feedback-row').querySelector('[data-vote-note]').textContent = message || (!persistent ? 'Голос запоминается только до обновления страницы.' : '');
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
  let associationGeneration = 0;
  const associationPending = new Set(), associationRetries = new Map();
  function renderAssociation(item, message = '') {
    const key = associationKey(item.episode_id, item.game_id);
    for (const widget of content.querySelectorAll('[data-association-game]')) {
      if (widget.dataset.associationGame !== item.game_id || widget.dataset.associationEpisode !== item.episode_id) continue;
      widget.querySelector('[data-association-score]').textContent = signed(item.score);
      widget.querySelector('[data-association-score]').title = `Да: ${item.up}. Нет: ${item.down}.`;
      widget.querySelector('[data-association-state]').textContent = item.confirmed ? 'Подтверждено посетителями' : 'Не подтверждено';
      widget.querySelector('[data-association-note]').textContent = message || (!persistent ? 'Ваш ответ запоминается только до обновления страницы.' : '');
      widget.querySelector('[data-association-refresh]').hidden = true;
      for (const button of widget.querySelectorAll('[data-association-value]')) {
        button.disabled = associationPending.has(key);
        button.setAttribute('aria-pressed', String(Number(button.dataset.associationValue) === item.mine));
      }
    }
  }
  async function refreshAssociations() {
    const current = ++associationGeneration;
    const episode = selectedEpisode;
    if (!database || !episode) return;
    const ids = episodeGames().filter(g=>!sourceGameConfirmed(g.id,episode)).map(g=>g.id);
    for (const id of ids) {
      const key=associationKey(episode,id), known=associationStates.get(key);
      if (known && !associationPending.has(key)) renderAssociation(known, associationRetries.has(key) ? 'Нет подтверждения. Нажмите ответ ещё раз для повтора.' : '');
    }
    for (let start=0; start<ids.length; start+=60) {
      const group=ids.slice(start,start+60);
      try {
        const result=await request('/game-votes/read', {episode_id:episode, game_ids:group});
        if (current!==associationGeneration || episode!==selectedEpisode) return;
        const items=result.items.filter(item=>!associationPending.has(associationKey(episode,item.game_id)) && !associationRetries.has(associationKey(episode,item.game_id)));
        updateGameConfirmations(items);
        for (const item of items) renderAssociation(item);
      } catch {
        if (current!==associationGeneration || episode!==selectedEpisode) return;
        for (const widget of content.querySelectorAll('[data-association-game]')) {
          if (!group.includes(widget.dataset.associationGame) || widget.dataset.associationEpisode!==episode) continue;
          widget.querySelector('[data-association-note]').textContent='Подтверждения временно недоступны.';
          widget.querySelector('[data-association-refresh]').hidden=false;
          if (!associationStates.has(associationKey(episode,widget.dataset.associationGame))) widget.querySelector('[data-association-score]').textContent='—';
        }
      }
    }
  }
  content.addEventListener('click', async event => {
    if (event.target.closest('[data-association-refresh]')) { refreshAssociations(); return; }
    const button=event.target.closest('[data-association-value]');
    const widget=button?.closest('[data-association-game]');
    if (!widget) return;
    const episode=widget.dataset.associationEpisode, game=widget.dataset.associationGame;
    const key=associationKey(episode,game), item=associationStates.get(key);
    if (!item || associationPending.has(key)) return;
    const value=Number(button.dataset.associationValue), desired=item.mine===value ? 0 : value;
    const previous=associationRetries.get(key);
    const payload=previous?.value===desired ? previous : {episode_id:episode, game_id:game, value:desired, request_id:crypto.randomUUID()};
    associationRetries.set(key,payload);associationPending.add(key);++associationGeneration;
    renderAssociation(item,'Сохраняем ответ…');
    try {
      const result=await request('/game-votes',payload);
      if (result.status!=='saved' || result.id!==payload.request_id || result.item?.episode_id!==episode || result.item?.game_id!==game) throw new Error('Нет подтверждения сохранения.');
      associationRetries.delete(key);associationPending.delete(key);
      associationStates.set(key,result.item);
      if (selectedEpisode===episode) {
        updateGameConfirmations([result.item]);
        renderAssociation(result.item,result.item.mine ? 'Ваш ответ сохранён.' : 'Ответ снят.');
        document.getElementById('announcement').textContent=result.item.confirmed ? 'Игра подтверждена посетителями и перенесена в цветную часть списка.' : 'Игра не подтверждена и находится в серой части списка.';
      }
    } catch (error) {
      associationPending.delete(key);
      renderAssociation(item,`${error.message || 'Нет подтверждения.'} Нажмите ответ ещё раз для повтора.`);
    }
  });
  async function refresh() {
    refreshAssociations();
    const current = ++generation;
    if (selectedId === goldenId) {
      if (pending.size || content.querySelector('[data-correction-controls]') || document.getElementById('correction-dialog').open) return;
      try {
        const result = await request('/votes/top', {});
        if (current !== generation || selectedId !== goldenId) return;
        observer.disconnect();
        try {
          content.querySelector('[data-retry-top]')?.remove();
          renderGoldenQuotes(result.items);
          for (const item of result.items) render(item, retries.has(item.quote_id) ? 'Нет подтверждения. Нажмите стрелку ещё раз для повтора.' : '');
        } finally { observer.observe(content, {childList: true}); }
      } catch {
        if (current === generation && selectedId === goldenId) {
          document.getElementById('golden-status').textContent='Не удалось загрузить лучшие цитаты.';
          if (!content.querySelector('[data-retry-top]')) {
            const retry = document.createElement('button'); retry.type='button'; retry.dataset.retryTop='';
            retry.className='vote-refresh'; retry.textContent='Повторить'; content.append(retry);
          }
        }
      }
      return;
    }
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
          widget.closest('.quote-feedback-row').querySelector('[data-vote-note]').textContent = 'Рейтинг временно недоступен.';
          widget.closest('.quote-feedback-row').querySelector('[data-vote-refresh]').hidden = false;
        }
      }
    }
    sortQuotes();
  }
  content.addEventListener('click', async event => {
    if (event.target.closest('[data-retry-top]')) { refresh(); return; }
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
      if (selectedId === goldenId) await refresh(); else sortQuotes();
    } catch (error) {
      pending.delete(id);
      render(item, `${error.message || 'Нет подтверждения.'} Нажмите стрелку ещё раз для повтора.`);
    }
  });
  const observer = new MutationObserver(refresh);
  observer.observe(content, {childList: true});
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) refresh();});
  setInterval(() => {if (!document.hidden) refresh();}, 30000);
  refresh();
})();
