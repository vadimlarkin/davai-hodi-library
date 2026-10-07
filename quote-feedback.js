'use strict';
(() => {
  const dialog = document.getElementById('correction-dialog');
  const form = document.getElementById('correction-form');
  const floating = document.getElementById('report-selection');
  const replacement = document.getElementById('correction-replacement');
  const comment = document.getElementById('correction-comment');
  const status = document.getElementById('correction-status');
  const submit = document.getElementById('send-correction');
  const close = document.getElementById('close-correction');
  const kind = document.getElementById('correction-kind');
  const gameName = document.getElementById('correction-game');
  const gameUrl = document.getElementById('correction-game-url');
  const endpoint = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:63130/reports'
    : 'https://podcast.boardgamer.ru/library-feedback/reports';
  let selected = null, draft = null, pending = false, picking = null;

  function selection() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const range = s.getRangeAt(0);
    const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const span = start.closest('[data-correction-text]');
    if (!span || !span.contains(range.endContainer)) return null;
    const quote = database?.quotes.find(q => q.id === span.dataset.correctionText);
    if (!quote || span.textContent !== quote.text) return null;
    const before = range.cloneRange();
    before.selectNodeContents(span); before.setEnd(range.startContainer, range.startOffset);
    let offset = Array.from(before.toString()).length;
    const value = range.toString();
    offset += Array.from(value.match(/^\s*/)[0]).length;
    const text = value.trim();
    if (!text) return null;
    return {quote, start: offset, end: offset + Array.from(text).length, text, rect: range.getBoundingClientRect()};
  }
  function resetPicking() {
    if (!picking) return;
    const span = document.querySelector('[data-correction-text="' + CSS.escape(picking) + '"]');
    const quote = database?.quotes.find(q => q.id === picking);
    if (span && quote) { span.textContent = quote.text; span.classList.remove('choosing-word'); }
    picking = null;
    document.querySelectorAll('[data-correction-controls]').forEach(e => e.remove());
    document.querySelectorAll('[data-report-quote]').forEach(button => {
      button.textContent = 'Сообщить об ошибке'; button.setAttribute('aria-pressed', 'false');
    });
  }
  function open(item) {
    if (pending) return;
    selected = null; floating.hidden = true; resetPicking();
    draft = {...item, request_id: crypto.randomUUID()};
    const points = Array.from(item.quote.text);
    const preview = document.getElementById('correction-preview');
    preview.replaceChildren();
    const mark = document.createElement('mark'); mark.textContent = item.text;
    preview.append((item.start > 90 ? '…' : '') + points.slice(Math.max(0, item.start - 90), item.start).join(''), mark,
      points.slice(item.end, item.end + 90).join('') + (points.length > item.end + 90 ? '…' : ''));
    replacement.value = ''; comment.value = ''; status.textContent = '';
    kind.value = 'text'; gameName.value = ''; gameUrl.value = ''; gameName.required = false;
    document.getElementById('correction-game-fields').hidden = true;
    document.getElementById('correction-games').replaceChildren();
    for (const game of database.games) {
      const option = document.createElement('option'); option.value = game.name;
      document.getElementById('correction-games').append(option);
    }
    window.getSelection()?.removeAllRanges();
    dialog.showModal(); replacement.focus();
  }
  function chooseWord(id, button) {
    if (picking === id) { resetPicking(); return; }
    resetPicking(); floating.hidden = true;
    const quote = database?.quotes.find(q => q.id === id);
    const span = button.closest('.quote-item').querySelector('[data-correction-text]');
    if (!quote || !span) return;
    picking = id; span.replaceChildren(); span.classList.add('choosing-word');
    const controls = document.createElement('div'); controls.dataset.correctionControls = id;
    controls.className = 'correction-selection-controls';
    const hint = document.createElement('p'); hint.textContent = 'Нажмите первое и последнее слово нужного фрагмента.';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Исправить выделенное'; confirm.disabled = true;
    const all = document.createElement('button'); all.type = 'button'; all.textContent = 'Вся цитата';
    controls.append(hint, confirm, all); button.after(controls);
    let offset = 0, anchor = null, fragment = null;
    const words = [];
    function highlight(start, end) {
      fragment = {quote, start, end, text: Array.from(quote.text).slice(start, end).join('')};
      for (const word of words) word.button.setAttribute('aria-pressed', String(word.start >= start && word.end <= end));
      confirm.disabled = false; hint.textContent = 'Выделено: «' + fragment.text + '». Можно нажать другое последнее слово.';
    }
    for (const token of quote.text.match(/\s+|\S+/g) || []) {
      if (/^\s+$/.test(token)) span.append(token);
      else {
        const word = document.createElement('button'); word.type = 'button'; word.className = 'correction-word';
        word.textContent = token; word.setAttribute('aria-label', 'Сообщить об ошибке в слове «' + token + '»');
        const begin = offset, end = offset + Array.from(token).length;
        word.setAttribute('aria-pressed', 'false');
        words.push({button: word, start: begin, end});
        word.addEventListener('click', () => {
          if (!anchor) anchor = {start: begin, end};
          highlight(Math.min(anchor.start, begin), Math.max(anchor.end, end));
        });
        span.append(word);
      }
      offset += Array.from(token).length;
    }
    confirm.addEventListener('click', () => {if (fragment) open(fragment);});
    all.addEventListener('click', () => highlight(0, Array.from(quote.text).length));
    button.textContent = 'Отменить выбор слова'; button.setAttribute('aria-pressed', 'true');
    document.getElementById('announcement').textContent = 'Нажмите первое и последнее слово фрагмента, затем «Исправить выделенное».';
    span.querySelector('button')?.focus({preventScroll: true});
  }
  document.addEventListener('selectionchange', () => {
    if (dialog.open || pending) return;
    selected = selection(); floating.hidden = !selected;
    if (!selected) return;
    floating.style.left = Math.max(12, Math.min(selected.rect.left, window.innerWidth - 230)) + 'px';
    floating.style.top = Math.max(12, Math.min(selected.rect.bottom + 8, window.innerHeight - 60)) + 'px';
  });
  // Preserve a native selection when the visitor clicks its action.
  floating.addEventListener('pointerdown', e => e.preventDefault());
  floating.addEventListener('click', () => { if (selected) open(selected); });
  document.getElementById('detail-content').addEventListener('click', e => {
    const button = e.target.closest('[data-report-quote]');
    if (!button) return;
    const item = selection();
    if (item?.quote.id === button.dataset.reportQuote) open(item);
    else chooseWord(button.dataset.reportQuote, button);
  });
  for (const event of ['scroll', 'resize', 'popstate', 'hashchange']) window.addEventListener(event, () => {floating.hidden = true; selected = null;}, true);
  close.addEventListener('click', () => {if (!pending) dialog.close();});
  dialog.addEventListener('cancel', e => {if (pending) e.preventDefault();});
  dialog.addEventListener('close', () => {draft = null;});
  kind.addEventListener('change', () => {
    document.getElementById('correction-game-fields').hidden = kind.value === 'text';
    gameName.required = kind.value !== 'text';
  });
  gameName.addEventListener('input', () => {
    const match = database.games.find(g => normalize(g.name) === normalize(gameName.value));
    if (match) gameUrl.value = match.bgg_url;
  });
  form.addEventListener('input', () => { if (draft && !pending) draft.request_id = crypto.randomUUID(); });
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!draft || pending) return;
    pending = true; submit.disabled = close.disabled = replacement.disabled = comment.disabled = kind.disabled = gameName.disabled = gameUrl.disabled = true;
    status.textContent = 'Сохраняем замечание…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const payload = {request_id: draft.request_id, quote_id: draft.quote.id, quote_text: draft.quote.text,
      selection_start: draft.start, selection_end: draft.end, selected_text: draft.text,
      replacement: replacement.value.trim(), comment: comment.value.trim(), kind: kind.value,
      game_name: gameName.value.trim(), game_bgg_url: gameUrl.value.trim()};
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit'});
      if (!response.ok) {
        status.textContent = response.status === 429 ? 'Слишком много замечаний. Попробуйте через час.'
          : response.status === 400 ? 'Текст цитаты мог обновиться. Обновите страницу и выделите фрагмент заново.'
          : 'Не удалось сохранить замечание. Попробуйте ещё раз.';
        return;
      }
      const receipt = await response.json();
      if (receipt.status !== 'saved' || receipt.id !== draft.request_id) throw new Error('Invalid receipt');
      dialog.close(); notifyShare('Замечание сохранено. Спасибо! Проверим его по записи.');
    } catch {
      status.textContent = 'Не удалось получить подтверждение. Попробуйте ещё раз — повторное нажатие не создаст копию.';
    } finally {
      clearTimeout(timer); pending = false;
      submit.disabled = close.disabled = replacement.disabled = comment.disabled = kind.disabled = gameName.disabled = gameUrl.disabled = false;
    }
  });
})();
