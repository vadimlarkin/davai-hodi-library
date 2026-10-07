'use strict';
let database;
let selectedId;
let selectedEpisode = null;
let gameSort = 'mentions';
const goldenId = 'golden-fund';
const trophy = '<svg aria-hidden="true" viewBox="0 0 100 100"><path fill="#d7a529" d="M24 16h52v22c0 19-9 31-21 33v12h17v8H28v-8h17V71C33 69 24 57 24 38z"/><path fill="none" stroke="#b98616" stroke-width="7" d="M24 23H12v12c0 13 8 20 20 20m44-32h12v12c0 13-8 20-20 20"/><path fill="#f7d774" d="M32 22h9v18c0 9 2 15 5 18-9-4-14-13-14-24z"/></svg>';
const gameNameOrder = new Intl.Collator('ru', {numeric: true, sensitivity: 'base'});
let previouslyFocused;
let cardOpen = false;
let selectedQuote = null;
let shareNoticeTimer;
let nativeSharePending = false;
let sharePreview = null;
let shareGeneration = 0;
const shareDialog = document.getElementById('share-dialog');
const grid = document.getElementById('games');
const panel = document.getElementById('details');
const content = document.getElementById('detail-content');
const quoteAudio = new QuoteAudio(document.getElementById('quote-audio'), renderAudioState);
const picker = document.getElementById('episode-picker');
const search = document.getElementById('episode-search');
const gameSearch = document.getElementById('game-search');
const clearGameSearch = document.getElementById('clear-game-search');
const trigger = document.getElementById('episode-trigger');
const narrow = window.matchMedia('(max-width: 700px)');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const normalize = value => String(value ?? '').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
const episodeName = ep => `${ep.number == null ? 'Без номера' : ep.number}. ${ep.title}`;
const quoteEpisodeName = ep => ep.number == null ? 'Без номера' : `Выпуск ${ep.number}`;
const quoteImageTime = value => {
  const seconds=Math.max(0,Math.floor(value));
  const minutes=Math.floor(seconds/60)%60;
  const tail=`${minutes.toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  return seconds>=3600?`${Math.floor(seconds/3600)}:${tail}`:tail;
};
const episodeDate = ep => {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ep.date || ''))return '';
  const date=new Date(ep.date+'T12:00:00Z');
  if(Number.isNaN(date.getTime()))return '';
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(date).replace(/\s*г\.$/,' года');
};
function plural(n, one, few, many) {return n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many;}
const currentQuotes = () => database.quotes.filter(q => !selectedEpisode || q.episode_id === selectedEpisode);
const gameQuotes = id => currentQuotes().filter(q => q.game_id === id);
const gameEvaluations = id => (database.evaluations || []).filter(e=>e.game_ids.includes(id) && (!selectedEpisode || e.episode_id===selectedEpisode));
const evaluationPicker = document.getElementById('evaluation-picker');
const evaluationList = document.getElementById('evaluation-list');
let evaluationPage = 0;
const opinionEligible = e => !e.duplicate_of && e.attribution==='own' && ['positive','negative'].includes(e.polarity) && e.game_ids.length>0;
function opinionCounts(id) {
  const all=gameEvaluations(id);
  const rows=all.filter(opinionEligible);
  const positive=rows.filter(e=>e.polarity==='positive').length;
  const negative=rows.filter(e=>e.polarity==='negative').length;
  const accepted=rows.filter(e=>e.review_status==='accepted').length;
  return {positive,negative,total:positive+negative,accepted,pending:rows.length-accepted,unresolved:all.length-rows.length};
}
function opinionBadges(id) {
  const {positive,negative,total,pending}=opinionCounts(id);
  return total ? `<span class="opinion-badges">${pending?'<span class="opinion-pending">Предварительно</span>':''}<span class="opinion-positive">${positive} ${plural(positive,'похвала','похвалы','похвал')}</span><span class="opinion-negative">${negative} ${plural(negative,'критическое замечание','критических замечания','критических замечаний')}</span></span>` : '';
}
// Compact cover counters; detailed opinions are temporarily hidden.
function opinionCounters(id) {
  const {positive,negative,pending}=opinionCounts(id);
  const suffix=pending?' (предварительно, есть неподтверждённые реплики)':'';
  const counter=(count,kind,label)=>count ? `<span class="opinion-counter opinion-counter-${kind}" title="${label}: ${count}${suffix}" aria-label="${label}: ${count}${suffix}">${count}</span>` : '';
  const counters=counter(positive,'positive','Похвалы')+counter(negative,'negative','Критические замечания');
  return counters ? `<span class="opinion-counters">${counters}</span>` : '';
}
function opinionItem(e, showGame=false) {
  const ep=database.episodes.find(ep=>ep.id===e.episode_id);
  const names=e.game_ids.map(id=>database.games.find(g=>g.id===id)?.name).filter(Boolean);
  const label=e.review_status==='accepted'?'Проверено':'Не подтверждено';
  const kind=e.polarity==='positive'?'Похвала':e.polarity==='negative'?'Критика':'Направленность неясна';
  const notes=[];
  if(!e.game_ids.length) notes.push('Игра не определена'+(e.candidate_names?.length ? ': '+e.candidate_names.join(', ') : ''));
  if(e.attribution==='reported') notes.push('Пересказ чужого мнения — не входит в долю критики');
  if(e.attribution==='unclear') notes.push('Неясно, кому принадлежит оценка — не входит в долю критики');
  if(e.duplicate_of) notes.push('Пересекается с проверенной оценкой — повторно не учитывается');
  return `<article class="opinion-item"><p class="opinion-kind ${e.polarity==='positive'?'opinion-positive':e.polarity==='negative'?'opinion-negative':''}">${kind} <span class="opinion-status">${label}</span></p>${showGame&&names.length?`<h3 class="opinion-game">${escapeHtml(names.join(' / '))}</h3>`:''}${notes.length?`<p class="opinion-note">${escapeHtml(notes.join('. '))}</p>`:''}<blockquote>«${escapeHtml(e.original_text)}»</blockquote><div class="quote-footer"><p class="quote-source"><button type="button" class="quote-episode" data-episode="${escapeHtml(ep.id)}">${escapeHtml(quoteEpisodeName(ep))}</button> · ${time(e.start)}</p>${audioButton(e,ep)}</div>${audioProgress(e)}</article>`;
}
function renderOpinions(id) {
  const rows=gameEvaluations(id);
  if (!rows.length) return `<section class="opinions"><h3>Как мы отзывались</h3><p class="opinion-note">${selectedEpisode ? 'В этом выпуске оценочные фрагменты ещё не добавлены.' : 'Оценочные фрагменты ещё не добавлены.'}</p></section>`;
  const {positive,negative,total,accepted,pending,unresolved}=opinionCounts(id);
  const percent=total?Math.round(100*negative/total):null;
  return `<section class="opinions"><h3>Как мы отзывались</h3>${opinionBadges(id)}
    ${total?`<div class="opinion-bar" role="img" aria-label="Похвала: ${positive}. Критические замечания: ${negative}."><span class="opinion-bar-positive" style="width:${100*positive/total}%"></span><span class="opinion-bar-negative" style="width:${100*negative/total}%"></span></div><p class="opinion-index">Доля критики${pending?' (предварительно)':''}: <strong>${percent}%</strong></p>`:'<p class="opinion-note">Доля критики пока не определена.</p>'}
    <p class="opinion-note">В расчёте: ${accepted} ${plural(accepted,'проверенная оценка','проверенные оценки','проверенных оценок')}${pending?` и ${pending} ${plural(pending,'неподтверждённая','неподтверждённые','неподтверждённых')}`:''}.${total>0&&total<5 ? ' Оценок пока мало.' : ''}${unresolved?` Ещё ${unresolved} ${plural(unresolved,'фрагмент требует','фрагмента требуют','фрагментов требуют')} разбора.`:''}</p>
    <p class="opinion-note">Доля критики показывает тон обсуждения игры. Считаем реплики участников с определимой направленностью; чужие мнения и неясные фрагменты остаются в списке. Разбор архива продолжается.</p>
    <details class="opinion-evidence"><summary>Оценочные реплики (${rows.length})</summary><p class="opinion-note">Фрагменты исходной расшифровки. В записи звучит полный отрывок.</p>${rows.map(e=>opinionItem(e)).join('')}</details></section>`;
}
function renderEvaluationList() {
  const query=normalize(document.getElementById('evaluation-search').value);
  const filter=document.getElementById('evaluation-filter').value || 'all';
  const rows=(database.evaluations || []).filter(e=>{
    if(selectedEpisode && e.episode_id!==selectedEpisode)return false;
    if(filter==='accepted' && e.review_status!=='accepted')return false;
    if(filter==='pending' && e.review_status==='accepted')return false;
    if(filter==='unresolved' && opinionEligible(e))return false;
    const names=e.game_ids.map(id=>database.games.find(g=>g.id===id)?.name || '').concat(e.candidate_names || []);
    return normalize(e.original_text+' '+names.join(' ')).includes(query);
  });
  const pages=Math.max(1,Math.ceil(rows.length/30));
  evaluationPage=Math.min(evaluationPage,pages-1);
  evaluationList.innerHTML=rows.slice(evaluationPage*30,(evaluationPage+1)*30).map(e=>opinionItem(e,true)).join('') || '<p class="opinion-note">Оценки не найдены.</p>';
  document.getElementById('evaluation-list-status').textContent=`Найдено: ${rows.length}${selectedEpisode?' · '+episodeName(database.episodes.find(ep=>ep.id===selectedEpisode)):''}.`;
  document.getElementById('evaluation-page').textContent=`${evaluationPage+1} / ${pages}`;
  document.getElementById('evaluation-previous').disabled=evaluationPage===0;
  document.getElementById('evaluation-next').disabled=evaluationPage===pages-1;
  renderAudioState(quoteAudio.state);
}
const episodeGames = () => {const ids=new Set([...currentQuotes().map(q=>q.game_id),...(database.evaluations || []).filter(e=>!selectedEpisode || e.episode_id===selectedEpisode).flatMap(e=>e.game_ids)]);return database.games.filter(g=>ids.has(g.id));};
const visibleGames = () => {
  const words = normalize(gameSearch.value).split(/\s+/).filter(Boolean);
  return episodeGames().filter(g=>{
    const names=normalize(`${g.name} ${g.original_name || ''}`);
    return words.every(word=>names.includes(word));
  }).sort((a,b) => (gameSort === 'mentions' ? gameQuotes(b.id).length - gameQuotes(a.id).length : 0) || gameNameOrder.compare(a.name,b.name));
};
function image(game, large = false) {
  return game.cover ? `<img src="${escapeHtml(game.cover)}" alt="Игра ${escapeHtml(game.name)}" ${large?'':'loading="lazy"'}>` : '<span class="missing-cover">Обложка уточняется</span>';
}
function goldenCard() {
  return `<button type="button" class="game-card golden-card" data-game="${goldenId}" aria-pressed="${selectedId===goldenId}" aria-label="Золотой фонд. Лучшие 10 цитат. Открыть"><span class="cover-stage golden-cover">${trophy}</span><span class="game-name">Золотой фонд</span><span class="game-subtitle">10 лучших цитат по голосам</span></button>`;
}
function renderLibrary() {
  const allOpinions=(database.evaluations || []).filter(e=>!selectedEpisode || e.episode_id===selectedEpisode);
  const confirmed=allOpinions.filter(e=>e.review_status==='accepted').length;
  document.getElementById('evaluations-overview').textContent=`${confirmed} проверено · ${allOpinions.length-confirmed} не подтверждено. Предварительные оценки отмечены на карточках.`;
  const games = visibleGames();
  for (const mode of ['alphabet','mentions']) {
    const button = document.getElementById('sort-' + mode);
    button.disabled = false;
    button.setAttribute('aria-pressed', String(gameSort === mode));
  }
  const query = normalize(gameSearch.value);
  const total = episodeGames().length;
  clearGameSearch.hidden = !gameSearch.value;
  document.getElementById('game-search-status').textContent = query ? `Найдено: ${games.length} ${plural(games.length,'игра','игры','игр')} из ${total}.` : '';
  const episode = database.episodes.find(ep=>ep.id===selectedEpisode);
  document.getElementById('game-total').textContent = `${games.length} ${plural(games.length,'игра','игры','игр')}`;
  document.getElementById('episode-label').textContent = episode ? episodeName(episode) : 'Все выпуски';
  trigger.title = episode ? episodeName(episode) : 'Выбрать выпуск';
  document.getElementById('episode-meta').hidden = Boolean(episode);
  document.getElementById('episode-meta').textContent = episode ? '' : `${new Set(database.quotes.map(q=>q.episode_id)).size} ${plural(new Set(database.quotes.map(q=>q.episode_id)).size,'выпуск','выпуска','выпусков')} с цитатами`;
  document.getElementById('library-note').hidden = Boolean(selectedEpisode);
  grid.innerHTML = goldenCard() + games.map(g => {
    const n = gameQuotes(g.id).length;
    return `<button type="button" class="game-card" data-game="${escapeHtml(g.id)}" aria-pressed="${g.id===selectedId}" aria-label="${escapeHtml(g.name)}. ${n} ${plural(n,'цитата','цитаты','цитат')}. Открыть">
      <span class="quote-count">${n} ${plural(n,'цитата','цитаты','цитат')}</span><span class="cover-stage">${image(g)}${opinionCounters(g.id)}</span>
      <span class="game-name">${escapeHtml(g.name)}</span><span class="game-subtitle">${escapeHtml(g.description)}</span></button>`;
  }).join('');
  if (!games.length) {
    grid.innerHTML = goldenCard() + (query && total ? `<div class="empty-episode"><h2>Игры не найдены</h2><p>Попробуйте другое название или очистите поиск${episode ? ', чтобы увидеть все игры этого выпуска' : ''}.</p><button type="button" class="clear-game-search">Очистить поиск</button>${episode ? '<button type="button" class="show-all-episodes">Искать во всех выпусках</button>' : ''}</div>` : `<div class="empty-episode"><h2>${escapeHtml(episode ? episodeName(episode) : 'Картотека пополняется')}</h2><p>Игры и цитаты из этого выпуска пока не добавлены в картотеку.</p><button type="button" class="show-all-episodes">Посмотреть все игры</button></div>`);
    content.innerHTML = '<h2 id="detail-title" class="empty-detail-title">Цитаты появятся здесь</h2><p class="game-description">Выберите другой выпуск или вернитесь ко всем играм.</p>';
    if (query && total) content.innerHTML = '<h2 id="detail-title" class="empty-detail-title">Игры не найдены</h2><p class="game-description">Измените название или очистите поиск.</p>';
  }
}
function libraryUrl() {
  const url = new URL(location.href);
  if (selectedEpisode) url.searchParams.set('episode',selectedEpisode); else url.searchParams.delete('episode');
  if (normalize(gameSearch.value)) url.searchParams.set('q',gameSearch.value.trim()); else url.searchParams.delete('q');
  if (gameSort === 'alphabet') url.searchParams.set('sort', 'alphabet'); else url.searchParams.delete('sort');
  url.searchParams.delete('quote');
  url.hash = '';
  return url;
}
function updateUrl(push = false) {
  const url = libraryUrl();
  if (cardOpen) {
    url.hash = selectedId;
    if (selectedQuote) url.searchParams.set('quote',selectedQuote);
  }
  history[push?'pushState':'replaceState']({libraryCard:cardOpen},'',url);
}
function syncPanel() {
  const open = narrow.matches && cardOpen;
  if (open) {
    if (!panel.classList.contains('is-open')) previouslyFocused = document.activeElement;
    panel.classList.add('is-open');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    document.querySelector('.library').inert=true;
    document.querySelector('.masthead').inert=true;
    document.body.classList.add('card-open');
  } else closePanel();
}
function renderQuote(q, showGame = false) {
  const ep = database.episodes.find(e=>e.id===q.episode_id);
  const game = database.games.find(g=>g.id===q.game_id);
  return `<article class="quote-item${q.id===selectedQuote?' is-highlighted':''}" id="${escapeHtml(q.id)}" tabindex="-1" aria-label="Цитата: ${escapeHtml(quoteEpisodeName(ep))}, ${time(q.start)}">${showGame?`<p class="golden-quote-game"><a href="${escapeHtml(quoteUrl(q))}">${escapeHtml(game.name)}</a></p>`:''}<blockquote>«<span data-correction-text="${escapeHtml(q.id)}">${escapeHtml(q.text)}</span>»</blockquote>
    <div class="quote-footer"><p class="quote-source"><button type="button" class="quote-episode" data-episode="${escapeHtml(ep.id)}" aria-label="Показать игры из ${ep.number==null?'этого выпуска':`выпуска ${ep.number}`}">${escapeHtml(quoteEpisodeName(ep))}</button> · ${time(q.start)}</p><div class="quote-buttons">${audioButton(q,ep)}<button type="button" class="share-quote" data-share-quote="${escapeHtml(q.id)}" aria-label="Поделиться цитатой: ${escapeHtml(quoteEpisodeName(ep))}, ${time(q.start)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/></svg>Поделиться</button></div></div>${audioProgress(q)}<div class="quote-feedback-row"><div class="quote-votes" data-vote-quote="${escapeHtml(q.id)}" role="group" aria-label="Голосование за цитату"><button type="button" data-vote-value="1" aria-label="Нравится цитата" aria-pressed="false" disabled>▲</button><span data-vote-score role="status" aria-live="polite">…</span><button type="button" data-vote-value="-1" aria-label="Не нравится цитата" aria-pressed="false" disabled>▼</button></div><button type="button" class="report-quote" data-report-quote="${escapeHtml(q.id)}" aria-pressed="false">Сообщить об ошибке</button><div class="vote-status"><p data-vote-note class="vote-note" role="status"></p><button type="button" data-vote-refresh class="vote-refresh" hidden>Повторить</button></div></div></article>`;
}
function selectGolden(userAction = false) {
  const wasOpen = cardOpen;
  if (selectedId !== goldenId) quoteAudio.reset();
  if (userAction) {cardOpen = true;selectedQuote = null;}
  selectedId = goldenId;
  grid.querySelectorAll('[data-game]').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.game === goldenId)));
  content.innerHTML = `<div class="details-topline"><button type="button" class="back-details" aria-label="Вернуться к библиотеке">← Все игры</button><p class="eyebrow">ЛУЧШИЕ ЦИТАТЫ</p><button type="button" class="icon-button close-details" aria-label="Закрыть карточку">×</button></div><div class="game-profile"><div class="detail-cover golden-cover">${trophy}</div><div><h2 id="detail-title">Золотой фонд</h2><p class="original-name">Топ-10 всей игротеки</p></div></div><p class="game-description">Цитаты с наибольшей суммой голосов: апвоты минус даунвоты.</p><p id="golden-status" class="opinion-note" role="status">Загружаем лучшие цитаты…</p>`;
  panel.scrollTop = 0; syncPanel();
  if (userAction) {
    updateUrl(!wasOpen);
    if (narrow.matches) content.querySelector('.back-details').focus({preventScroll:true});
    document.getElementById('announcement').textContent='Открыт золотой фонд: 10 лучших цитат всей игротеки.';
  }
}
function renderGoldenQuotes(items) {
  if (selectedId !== goldenId) return;
  const quotes = items.map(item=>database.quotes.find(q=>q.id===item.quote_id)).filter(Boolean);
  const existing = new Map([...content.querySelectorAll('.quote-item')].map(article=>[article.id, article]));
  const ids = new Set(quotes.map(q=>q.id));
  if (quoteAudio.state?.id && !ids.has(quoteAudio.state.id)) quoteAudio.reset();
  for (const [id, article] of existing) if (!ids.has(id)) article.remove();
  for (const quote of quotes) if (!existing.has(quote.id)) {
    content.insertAdjacentHTML('beforeend', renderQuote(quote, true));
  }
  for (let index=0; index<quotes.length; index++) {
    const current=content.querySelectorAll('.quote-item')[index], wanted=document.getElementById(quotes[index].id);
    if (current!==wanted) {
      if (typeof content.moveBefore==='function') content.moveBefore(wanted, current);
      else content.insertBefore(wanted, current);
    }
  }
  document.getElementById('golden-status').textContent = `${quotes.length} лучших цитат · по убыванию суммы голосов`;
  renderAudioState(quoteAudio.state);
}
function selectGame(id, userAction = false) {
  if (id === goldenId) { selectGolden(userAction); return; }
  const game = database.games.find(g => g.id === id);
  const quotes = gameQuotes(id);
  if (!game || (!quotes.length && !gameEvaluations(id).length)) return;
  if (selectedId !== id) quoteAudio.reset();
  const wasOpen = cardOpen;
  if (userAction) {cardOpen = true;selectedQuote = null;}
  selectedId = id;
  const episodes = [...new Set(quotes.map(q => q.episode_id))];
  grid.querySelectorAll('[data-game]').forEach(card => card.setAttribute('aria-pressed', card.dataset.game === id));
  content.innerHTML = `<div class="details-topline"><button type="button" class="back-details" aria-label="Вернуться к библиотеке">← Все игры</button><p class="eyebrow">ЧТО МЫ ГОВОРИЛИ</p><button type="button" class="icon-button close-details" aria-label="Закрыть карточку">×</button></div>
    <div class="game-profile"><div class="detail-cover">${image(game,true)}${opinionCounters(id)}</div><div><h2 id="detail-title">${escapeHtml(game.name)}</h2>
    ${game.original_name&&game.original_name!==game.name?`<p class="original-name">${escapeHtml(game.original_name)}</p>`:''}
    <a class="bgg-link" href="${escapeHtml(game.bgg_url)}" target="_blank" rel="noopener">Карточка на BGG</a></div></div>
    <p class="game-description">${escapeHtml(game.description)}</p>
    <div class="quotes-summary"><strong>${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}</strong><span>${episodes.length} ${plural(episodes.length,'выпуск','выпуска','выпусков')}</span></div>
    ${quotes.map(q=>renderQuote(q)).join('')}`;
  renderAudioState(quoteAudio.state);
  panel.scrollTop = 0;
  syncPanel();
  if (userAction) {
    updateUrl(!wasOpen);
    if (narrow.matches) content.querySelector('.back-details').focus({preventScroll:true});
    document.getElementById('announcement').textContent=`Открыта игра ${game.name}, ${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}.`;
  }
  const target = selectedQuote && document.getElementById(selectedQuote);
  if (target) requestAnimationFrame(()=>{
    if (selectedQuote !== target.id || !target.isConnected) return;
    panel.scrollTop = target.offsetTop - content.offsetTop - 80;
    target.focus({preventScroll:true});
  });
}
function audioButton(quote, episode) {
  if (!episode.audio_url || !Number.isFinite(quote.start) || !Number.isFinite(quote.end) || quote.end <= quote.start) return '';
  return `<button type="button" class="listen-quote" data-listen-quote="${escapeHtml(quote.id)}" data-listen-description="${escapeHtml(quoteEpisodeName(episode))}, ${time(quote.start)}" aria-pressed="false" aria-label="Прослушать цитату: ${escapeHtml(quoteEpisodeName(episode))}, ${time(quote.start)}"><span data-listen-icon aria-hidden="true">▶</span><span data-listen-label>Прослушать</span></button>`;
}
function audioProgress(quote) {
  return `<div class="quote-playback" data-audio-progress="${escapeHtml(quote.id)}" hidden><progress max="${quote.end-quote.start}" value="0" aria-label="Прослушано цитаты"></progress><span class="audio-time"></span><span class="audio-message" role="status"></span></div>`;
}
function renderAudioState(state) {
  [...content.querySelectorAll('[data-listen-quote]'),...evaluationList.querySelectorAll('[data-listen-quote]')].forEach(button=>{
    const active=state?.id===button.dataset.listenQuote;
    const running=active && ['playing','loading'].includes(state.status);
    button.setAttribute('aria-pressed',String(Boolean(running)));
    button.querySelector('[data-listen-icon]').textContent=running?'Ⅱ':'▶';
    const label=running?'Пауза':active && state.status==='paused'?'Продолжить':active && state.status==='ended'?'Ещё раз':'Прослушать';
    button.querySelector('[data-listen-label]').textContent=label;
    const action=running?'Поставить цитату на паузу':active && state.status==='ended'?'Прослушать цитату ещё раз':`${label} цитату`;
    button.setAttribute('aria-label',`${action}. ${button.dataset.listenDescription}`);
  });
  [...content.querySelectorAll('[data-audio-progress]'),...evaluationList.querySelectorAll('[data-audio-progress]')].forEach(row=>{
    const active=state?.id===row.dataset.audioProgress;
    row.hidden=!active;
    if(!active)return;
    const progress=row.querySelector('progress');
    progress.max=state.end-state.start;progress.value=state.elapsed;
    row.querySelector('.audio-time').textContent=`${time(state.elapsed)} / ${time(progress.max)}`;
    const message=row.querySelector('.audio-message');
    const text=state.status==='error'?'Не удалось включить запись. Нажмите «Прослушать», чтобы попробовать ещё раз.':state.status==='loading'?'Загружаем…':'';
    if(message.textContent!==text)message.textContent=text;
  });
}
function closePanel() {
  const wasOpen = panel.classList.contains('is-open');
  panel.classList.remove('is-open');panel.removeAttribute('role');panel.removeAttribute('aria-modal');
  document.querySelector('.library').inert=false;document.querySelector('.masthead').inert=false;
  document.body.classList.remove('card-open');
  if (wasOpen) {
    const focusTarget = previouslyFocused?.isConnected ? previouslyFocused : grid.querySelector(`[data-game="${selectedId}"]`);
    const gameToFocus=focusTarget?.dataset?.game;
    requestAnimationFrame(()=>{
      if (panel.classList.contains('is-open')) return;
      const target=focusTarget?.isConnected ? focusTarget : grid.querySelector(`[data-game="${gameToFocus || selectedId}"]`);
      target?.focus({preventScroll:true});
    });
    previouslyFocused = null;
  }
}
function dismissCard() {
  quoteAudio.reset();
  cardOpen=false;selectedQuote=null;
  if (shareDialog.open) shareDialog.close();
  closePanel();
  if (history.state?.libraryCard) history.back(); else updateUrl();
}
function quoteUrl(quote) {
  const url = libraryUrl();
  // A quote link always names its episode, regardless of the sender's filter.
  url.searchParams.set('episode',quote.episode_id);
  url.searchParams.set('quote',quote.id);
  url.searchParams.delete('q');
  url.hash = quote.game_id;
  return url.href;
}
function notifyShare(message) {
  const notice=document.getElementById('share-notice');
  notice.textContent=message;notice.hidden=false;
  clearTimeout(shareNoticeTimer);
  shareNoticeTimer=setTimeout(()=>{notice.hidden=true;},4000);
}
async function copyQuoteLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    notifyShare('Ссылка на цитату скопирована');
    return true;
  } catch {
    const field=document.getElementById('share-link');
    document.getElementById('manual-share-link').hidden=false;
    field.value=url;
    if (!shareDialog.open) shareDialog.showModal();
    field.focus();field.select();
    document.getElementById('copy-link-note').textContent='Скопируйте выделенную ссылку и отправьте её.';
    return false;
  }
}
function canShareImage(file) {
  try {return Boolean(navigator.share && navigator.canShare && navigator.canShare({files:[file]}));}
  catch {return false;}
}
function releaseSharePreview() {
  shareGeneration++;
  if(sharePreview) URL.revokeObjectURL(sharePreview.url);
  sharePreview=null;
  document.getElementById('quote-image-preview').removeAttribute('src');
}
async function shareQuote(id, button) {
  const quote=database.quotes.find(q=>q.id===id);
  if (!quote || button.disabled) return;
  const game=database.games.find(g=>g.id===quote.game_id);
  const episode=database.episodes.find(ep=>ep.id===quote.episode_id);
  releaseSharePreview();
  const generation=shareGeneration;
  const preview=document.getElementById('quote-image-preview');
  const send=document.getElementById('share-quote-image');
  const download=document.getElementById('download-quote-image');
  const note=document.getElementById('image-share-note');
  preview.hidden=true;send.disabled=true;send.hidden=true;download.hidden=true;
  document.getElementById('share-link').value=quoteUrl(quote);
  document.getElementById('manual-share-link').hidden=true;
  document.getElementById('share-dialog-title').textContent='Цитата картинкой';
  note.textContent='Готовим картинку…';
  if(!shareDialog.open)shareDialog.showModal();
  button.disabled=true;
  try {
    const blob=await quoteCard.create({text:quote.text,game:game.name,episode:quoteEpisodeName(episode),episodeTitle:episode.title,date:episodeDate(episode),timestamp:quoteImageTime(quote.start)});
    if(generation!==shareGeneration || !shareDialog.open)return;
    const filename=`davai-hodi-${quote.episode_id}-${quote.id}.png`;
    const file=new File([blob],filename,{type:'image/png'});
    const url=URL.createObjectURL(blob);
    sharePreview={file,url,quote};
    preview.src=url;preview.alt=`${game.name}. «${quote.text}» — Давай ходи, ${quoteEpisodeName(episode)}. ${episode.title}, ${episodeDate(episode)}, ${quoteImageTime(quote.start)}`;
    preview.hidden=false;send.disabled=false;download.href=url;download.download=filename;download.hidden=false;
    const canSend=canShareImage(file);
    send.hidden=!canSend;
    note.textContent=canSend?'Отправьте картинку или сохраните её себе.':'Сохраните картинку и отправьте её в любой мессенджер.';
  } catch {
    if(generation===shareGeneration)note.textContent='Не удалось подготовить картинку. Закройте окно и попробуйте ещё раз.';
  } finally {button.disabled=false;}
}
async function shareQuoteImage() {
  if(!sharePreview || nativeSharePending)return;
  const send=document.getElementById('share-quote-image');
  send.disabled=true;
  try {
    nativeSharePending=true;
    await navigator.share({files:[sharePreview.file]});
  } catch(error) {
    if(error.name!=='AbortError')document.getElementById('image-share-note').textContent='Отправка недоступна. Сохраните картинку и прикрепите её в мессенджере.';
  } finally {nativeSharePending=false;send.disabled=false;}
}
function selectEpisode(id, userAction = true) {
  if (id && !database.episodes.some(ep=>ep.id===id)) return;
  quoteAudio.reset();
  if (userAction) {cardOpen=false;selectedQuote=null;}
  closePanel();
  if (shareDialog.open) shareDialog.close();
  if (picker.open) picker.close();
  selectedEpisode = id || null;
  const games = visibleGames();
  if (selectedId !== goldenId && !games.some(g=>g.id===selectedId)) selectedId=games[0]?.id || null;
  renderLibrary();
  if (selectedId) selectGame(selectedId);
  if (userAction) {
    updateUrl(true);
    trigger.focus();
    document.getElementById('announcement').textContent = `${document.getElementById('episode-label').textContent}: ${document.getElementById('game-total').textContent}.`;
  }
}
function renderEpisodeOptions() {
  const query = normalize(search.value);
  const episodes = [...database.episodes].sort((a,b)=>(a.number??Infinity)-(b.number??Infinity)).filter(ep=>/^\d+$/.test(query) ? String(ep.number)===String(Number(query)) : normalize(episodeName(ep)).includes(query));
  document.getElementById('episode-options').innerHTML = `<button type="button" class="episode-option all-episodes" data-select-episode="" aria-pressed="${!selectedEpisode}"><span><strong>Все выпуски</strong><small>Все игры и цитаты картотеки</small></span><span aria-hidden="true">${!selectedEpisode?'✓':''}</span></button>` + episodes.map(ep=>{
    const quotes=database.quotes.filter(q=>q.episode_id===ep.id);
    const opinions=(database.evaluations || []).filter(e=>e.episode_id===ep.id);
    const count=new Set([...quotes.map(q=>q.game_id),...opinions.flatMap(e=>e.game_ids)]).size;
    return `<button type="button" class="episode-option" data-select-episode="${escapeHtml(ep.id)}" aria-pressed="${ep.id===selectedEpisode}"><span><strong>${escapeHtml(episodeName(ep))}</strong><small class="${count?'episode-ready':'episode-pending'}">${count?`${count} ${plural(count,'игра','игры','игр')} · ${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}`:'Игры пока не добавлены'}${opinions.length?` · ${opinions.length} ${plural(opinions.length,'оценочный фрагмент','оценочных фрагмента','оценочных фрагментов')}`:''}</small></span><span aria-hidden="true">${ep.id===selectedEpisode?'✓':''}</span></button>`;
  }).join('') + (episodes.length ? '' : '<p class="episode-no-results">Выпуски не найдены. Попробуйте другой номер или название.</p>');
  document.getElementById('episode-picker-note').textContent = `${query?'Найдено':'В архиве'}: ${episodes.length} ${plural(episodes.length,'выпуск','выпуска','выпусков')}.`;
}
function applyGameSearch() {
  if (!database) return;
  quoteAudio.reset();
  cardOpen=false;selectedQuote=null;
  closePanel();
  const games=visibleGames();
  if (selectedId !== goldenId && !games.some(g=>g.id===selectedId)) selectedId=games[0]?.id || null;
  renderLibrary();
  if (selectedId) selectGame(selectedId);
  updateUrl();
}
function resetGameSearch() {
  gameSearch.value='';applyGameSearch();gameSearch.focus();
}
for (const mode of ['alphabet','mentions']) document.getElementById('sort-' + mode).addEventListener('click', () => {
  if (!database || gameSort === mode) return;
  gameSort = mode;
  renderLibrary();
  updateUrl();
  document.getElementById('announcement').textContent = mode === 'alphabet' ? 'Игры по алфавиту.' : 'Игры по убыванию количества цитат.';
});
gameSearch.addEventListener('input',applyGameSearch);
gameSearch.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();resetGameSearch();}});
clearGameSearch.addEventListener('click',resetGameSearch);
trigger.addEventListener('click',()=>{search.value='';renderEpisodeOptions();picker.showModal();search.focus();});
search.addEventListener('input',renderEpisodeOptions);
document.getElementById('close-episode-picker').addEventListener('click',()=>picker.close());
picker.addEventListener('click',e=>{const choice=e.target.closest('[data-select-episode]');if(choice)selectEpisode(choice.dataset.selectEpisode);else if(e.target===picker){const r=picker.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)picker.close();}});
grid.addEventListener('click',e=>{const card=e.target.closest('[data-game]');if(card)selectGame(card.dataset.game,true);else if(e.target.closest('.clear-game-search'))resetGameSearch();else if(e.target.closest('.show-all-episodes'))selectEpisode(null);});
content.addEventListener('click',e=>{
  if(e.target.closest('.close-details,.back-details')) {dismissCard();return;}
  const listen=e.target.closest('[data-listen-quote]');
  if(listen) {
    const quote=database.quotes.find(q=>q.id===listen.dataset.listenQuote) || (database.evaluations || []).find(q=>q.id===listen.dataset.listenQuote);
    if(quote) quoteAudio.toggle(quote,database.episodes.find(ep=>ep.id===quote.episode_id));
    return;
  }
  const share=e.target.closest('[data-share-quote]');
  if(share) {shareQuote(share.dataset.shareQuote,share);return;}
  const episode=e.target.closest('[data-episode]');if(episode)selectEpisode(episode.dataset.episode);
});
document.getElementById('open-evaluations').addEventListener('click',()=>{
  evaluationPage=0;document.getElementById('evaluation-search').value='';
  document.getElementById('evaluation-filter').value='all';renderEvaluationList();evaluationPicker.showModal();
});
document.getElementById('close-evaluations').addEventListener('click',()=>evaluationPicker.close());
evaluationPicker.addEventListener('close',()=>quoteAudio.reset());
for(const id of ['evaluation-search','evaluation-filter']) document.getElementById(id).addEventListener(id==='evaluation-search'?'input':'change',()=>{evaluationPage=0;quoteAudio.reset();renderEvaluationList();});
for(const [id,step] of [['evaluation-previous',-1],['evaluation-next',1]]) document.getElementById(id).addEventListener('click',()=>{evaluationPage+=step;quoteAudio.reset();renderEvaluationList();evaluationPicker.scrollTop=0;});
evaluationList.addEventListener('click',e=>{
  const listen=e.target.closest('[data-listen-quote]');
  if(listen){const row=(database.evaluations || []).find(q=>q.id===listen.dataset.listenQuote);if(row)quoteAudio.toggle(row,database.episodes.find(ep=>ep.id===row.episode_id));return;}
  const episode=e.target.closest('[data-episode]');
  if(episode){evaluationPicker.close();selectEpisode(episode.dataset.episode);}
});
shareDialog.addEventListener('close',releaseSharePreview);
shareDialog.addEventListener('cancel',e=>{if(nativeSharePending)e.preventDefault();});
document.getElementById('share-quote-image').addEventListener('click',shareQuoteImage);
document.getElementById('close-share-dialog').addEventListener('click',()=>shareDialog.close());
document.getElementById('copy-share-link').addEventListener('click',async()=>{
  await copyQuoteLink(document.getElementById('share-link').value);
});
document.addEventListener('keydown',e=>{if(shareDialog.open || nativeSharePending || document.getElementById('correction-dialog').open)return;if(e.key==='Escape'&&panel.classList.contains('is-open'))dismissCard();if(e.key==='Tab'&&panel.classList.contains('is-open')){const links=[...content.querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const last=links[links.length-1],first=links[0];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
narrow.addEventListener('change',syncPanel);
function restoreLocation(initial = false) {
  const url=new URL(location.href);
  gameSort = url.searchParams.get('sort') === 'alphabet' ? 'alphabet' : 'mentions';
  const quote=database.quotes.find(q=>q.id===url.searchParams.get('quote'));
  const episode=quote?.episode_id || url.searchParams.get('episode');
  const gameId=quote?.game_id || url.hash.slice(1);
  const validGame=gameId === goldenId || database.games.some(g=>g.id===gameId) && [...database.quotes.map(q=>({game_ids:[q.game_id],episode_id:q.episode_id})),...(database.evaluations || [])].some(q=>q.game_ids.includes(gameId) && (!episode || q.episode_id===episode));
  gameSearch.value=url.searchParams.get('q') || '';
  if (validGame && gameId !== goldenId) {
    const game=database.games.find(g=>g.id===gameId);
    const names=normalize(`${game.name} ${game.original_name || ''}`);
    if (!normalize(gameSearch.value).split(/\s+/).every(word=>names.includes(word))) gameSearch.value='';
  }
  cardOpen=validGame;selectedQuote=validGame && quote ? quote.id : null;
  selectedId=validGame ? gameId : selectedId;
  selectEpisode(database.episodes.some(ep=>ep.id===episode)?episode:null,false);
  // Fresh shared links receive a library entry so Back stays on the site.
  if (initial && cardOpen && !history.state?.libraryCard) {
    history.replaceState({libraryCard:false},'',libraryUrl());
    updateUrl(true);
  }
}
window.addEventListener('pagehide',()=>quoteAudio.reset());
window.addEventListener('popstate',()=>{if(database)restoreLocation();});
window.addEventListener('hashchange',()=>{if(database)restoreLocation();});
fetch('data.json?revision=8313cead501a').then(r=>{if(!r.ok)throw new Error('data');return r.json();}).then(d=>{database=d;restoreLocation(true);trigger.disabled=false;gameSearch.disabled=false;document.getElementById('open-evaluations').disabled=false;}).catch(()=>{document.getElementById('error').hidden=false;document.getElementById('error').textContent='Не удалось открыть библиотеку. Обновите страницу.';});
