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
  const gameResults = document.getElementById('correction-game-results');
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
  function updateKind() {
    const changingGame = ['game', 'both'].includes(kind.value);
    const changingText = ['text', 'both'].includes(kind.value);
    document.getElementById('correction-game-fields').hidden = !changingGame;
    document.getElementById('correction-text-fields').hidden = !changingText;
    gameName.required = changingGame;
    document.getElementById('correction-help').textContent = ['positive', 'negative'].includes(kind.value)
      ? 'Предложенную оценку проверим по записи перед изменением счётчиков игры.'
      : 'Замечание сохраним для проверки по записи.';
  }
  function renderGames() {
    gameResults.replaceChildren();
    const words = normalize(gameName.value).split(/\s+/).filter(Boolean);
    const games = database.games.filter(g => words.every(word => normalize(g.name + ' ' + (g.original_name || '')).includes(word)))
      .sort((a,b) => a.name.localeCompare(b.name, 'ru'));
    gameResults.hidden = false;
    for (const game of games.slice(0, 20)) {
      const option = document.createElement('button'); option.type = 'button';
      option.className = 'correction-game-option'; option.textContent = game.name;
      const description = document.createElement('small'); description.textContent = game.description;
      option.append(description);
      option.addEventListener('click', () => {
        if (pending) return;
        gameName.value = game.name; gameUrl.value = game.bgg_url;
        if (draft) draft.request_id = crypto.randomUUID();
        gameResults.hidden = true;
        document.getElementById('correction-game-note').textContent = 'Выбрано: ' + game.name + '.';
        gameName.focus();
      });
      gameResults.append(option);
    }
    document.getElementById('correction-game-note').textContent = games.length
      ? 'Найдено игр: ' + games.length + (games.length > 20 ? '. Уточните название.' : '. Выберите нужную.')
      : 'Игра не найдена. Оставьте название и, если знаете, укажите ссылку на BGG — проверим и заведём карточку.';
  }
  function open(item, mode = 'text') {
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
    kind.value = mode; gameName.value = ''; gameUrl.value = ''; gameResults.replaceChildren(); gameResults.hidden = true;
    document.getElementById('correction-game-note').textContent = 'Выберите игру из списка. Если её нет в игротеке, укажите название и, если знаете, ссылку на BGG.';
    updateKind();
    window.getSelection()?.removeAllRanges();
    dialog.showModal();
    (['game','both'].includes(mode) ? gameName : ['positive','negative'].includes(mode) ? comment : replacement).focus();
    if (['game','both'].includes(mode)) renderGames();
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
  function chooseReport(id, button) {
    if (picking === id) { resetPicking(); return; }
    resetPicking(); floating.hidden = true;
    const quote = database?.quotes.find(q => q.id === id);
    if (!quote) return;
    picking = id;
    const controls = document.createElement('div'); controls.dataset.correctionControls = id;
    controls.className = 'correction-selection-controls correction-kind-controls';
    const hint = document.createElement('p'); hint.textContent = 'О чём сообщить?'; controls.append(hint);
    for (const [mode, label] of [['text','Ошибка в тексте'], ['game','Не та игра'], ['positive','Положительный отзыв'], ['negative','Негативный отзыв']]) {
      const choice = document.createElement('button'); choice.type = 'button'; choice.textContent = label;
      choice.addEventListener('click', () => {
        resetPicking();
        if (mode === 'text') chooseWord(id, button);
        else open({quote, start: 0, end: Array.from(quote.text).length, text: quote.text}, mode);
      });
      controls.append(choice);
    }
    button.after(controls); button.textContent = 'Отменить'; button.setAttribute('aria-pressed','true');
    controls.querySelector('button').focus({preventScroll: true});
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
    else chooseReport(button.dataset.reportQuote, button);
  });
  for (const event of ['scroll', 'resize', 'popstate', 'hashchange']) window.addEventListener(event, () => {floating.hidden = true; selected = null;}, true);
  close.addEventListener('click', () => {if (!pending) dialog.close();});
  dialog.addEventListener('cancel', e => {if (pending) e.preventDefault();});
  dialog.addEventListener('close', () => {draft = null;});
  kind.addEventListener('change', () => { updateKind(); if (['game','both'].includes(kind.value)) renderGames(); });
  gameName.addEventListener('input', () => { gameUrl.value = ''; renderGames(); });
  form.addEventListener('input', () => { if (draft && !pending) draft.request_id = crypto.randomUUID(); });
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!draft || pending) return;
    pending = true; submit.disabled = close.disabled = replacement.disabled = comment.disabled = kind.disabled = gameName.disabled = gameUrl.disabled = true;
    status.textContent = 'Сохраняем замечание…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const payload = {request_id: draft.request_id, quote_id: draft.quote.id, quote_text: draft.quote.text,
      selection_start: draft.start, selection_end: draft.end, selected_text: draft.text,
      replacement: ['text','both'].includes(kind.value) ? replacement.value.trim() : '', comment: comment.value.trim(), kind: kind.value,
      game_name: ['game','both'].includes(kind.value) ? gameName.value.trim() : '',
      game_bgg_url: ['game','both'].includes(kind.value) ? gameUrl.value.trim() : ''};
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
      const savedKind = kind.value;
      dialog.close(); notifyShare(['positive','negative'].includes(savedKind) ? 'Оценка сохранена для проверки по записи. Спасибо!' : 'Замечание сохранено. Спасибо! Проверим его по записи.');
    } catch {
      status.textContent = 'Не удалось получить подтверждение. Попробуйте ещё раз — повторное нажатие не создаст копию.';
    } finally {
      clearTimeout(timer); pending = false;
      submit.disabled = close.disabled = replacement.disabled = comment.disabled = kind.disabled = gameName.disabled = gameUrl.disabled = false;
    }
  });
})();
