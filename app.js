'use strict';
let database;
let selectedId;
let selectedEpisode = null;
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
const visibleGames = () => {const ids=new Set(currentQuotes().map(q=>q.game_id));return database.games.filter(g=>ids.has(g.id));};
function image(game, large = false) {
  return game.cover ? `<img src="${escapeHtml(game.cover)}" alt="Игра ${escapeHtml(game.name)}" ${large?'':'loading="lazy"'}>` : '<span class="missing-cover">Обложка уточняется</span>';
}
function renderLibrary() {
  const games = visibleGames();
  const episode = database.episodes.find(ep=>ep.id===selectedEpisode);
  document.getElementById('game-total').textContent = `${games.length} ${plural(games.length,'игра','игры','игр')}`;
  document.getElementById('episode-label').textContent = episode ? episodeName(episode) : 'Все выпуски';
  trigger.title = episode ? episodeName(episode) : 'Выбрать выпуск';
  document.getElementById('episode-meta').hidden = Boolean(episode);
  document.getElementById('episode-meta').textContent = episode ? '' : `${new Set(database.quotes.map(q=>q.episode_id)).size} ${plural(new Set(database.quotes.map(q=>q.episode_id)).size,'выпуск','выпуска','выпусков')} с цитатами`;
  document.getElementById('library-note').hidden = Boolean(selectedEpisode);
  grid.innerHTML = games.map(g => {
    const n = gameQuotes(g.id).length;
    return `<button type="button" class="game-card" data-game="${escapeHtml(g.id)}" aria-pressed="${g.id===selectedId}" aria-label="${escapeHtml(g.name)}. ${n} ${plural(n,'цитата','цитаты','цитат')}. Открыть">
      <span class="quote-count">${n} ${plural(n,'цитата','цитаты','цитат')}</span><span class="cover-stage">${image(g)}</span>
      <span class="game-name">${escapeHtml(g.name)}</span><span class="game-subtitle">${escapeHtml(g.description)}</span></button>`;
  }).join('');
  if (!games.length) {
    grid.innerHTML = `<div class="empty-episode"><h2>${escapeHtml(episode ? episodeName(episode) : 'Картотека пополняется')}</h2><p>Игры и цитаты из этого выпуска пока не добавлены в картотеку.</p><button type="button" class="show-all-episodes">Посмотреть все игры</button></div>`;
    content.innerHTML = '<h2 id="detail-title" class="empty-detail-title">Цитаты появятся здесь</h2><p class="game-description">Выберите другой выпуск или вернитесь ко всем играм.</p>';
  }
}
function libraryUrl() {
  const url = new URL(location.href);
  if (selectedEpisode) url.searchParams.set('episode',selectedEpisode); else url.searchParams.delete('episode');
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
function selectGame(id, userAction = false) {
  const game = database.games.find(g => g.id === id);
  const quotes = gameQuotes(id);
  if (!game || !quotes.length) return;
  if (selectedId !== id) quoteAudio.reset();
  const wasOpen = cardOpen;
  if (userAction) {cardOpen = true;selectedQuote = null;}
  selectedId = id;
  const episodes = [...new Set(quotes.map(q => q.episode_id))];
  grid.querySelectorAll('[data-game]').forEach(card => card.setAttribute('aria-pressed', card.dataset.game === id));
  content.innerHTML = `<div class="details-topline"><button type="button" class="back-details" aria-label="Вернуться к библиотеке">← Все игры</button><p class="eyebrow">ЧТО МЫ ГОВОРИЛИ</p><button type="button" class="icon-button close-details" aria-label="Закрыть карточку">×</button></div>
    <div class="game-profile"><div class="detail-cover">${image(game,true)}</div><div><h2 id="detail-title">${escapeHtml(game.name)}</h2>
    ${game.original_name&&game.original_name!==game.name?`<p class="original-name">${escapeHtml(game.original_name)}</p>`:''}
    <a class="bgg-link" href="${escapeHtml(game.bgg_url)}" target="_blank" rel="noopener">Карточка на BGG</a></div></div>
    <p class="game-description">${escapeHtml(game.description)}</p>
    <div class="quotes-summary"><strong>${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}</strong><span>${episodes.length} ${plural(episodes.length,'выпуск','выпуска','выпусков')}</span></div>
    ${episodes.map(epId => {const ep=database.episodes.find(ep=>ep.id===epId);return quotes.filter(q=>q.episode_id===epId).map(q => `<article class="quote-item${q.id===selectedQuote?' is-highlighted':''}" id="${escapeHtml(q.id)}" tabindex="-1" aria-label="Цитата: ${escapeHtml(quoteEpisodeName(ep))}, ${time(q.start)}"><blockquote>«${escapeHtml(q.text)}»</blockquote>
    <div class="quote-footer"><p class="quote-source"><button type="button" class="quote-episode" data-episode="${escapeHtml(ep.id)}" aria-label="Показать игры из ${ep.number==null?'этого выпуска':`выпуска ${ep.number}`}">${escapeHtml(quoteEpisodeName(ep))}</button> · ${time(q.start)}</p><div class="quote-buttons">${audioButton(q,ep)}<button type="button" class="share-quote" data-share-quote="${escapeHtml(q.id)}" aria-label="Поделиться цитатой: ${escapeHtml(quoteEpisodeName(ep))}, ${time(q.start)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/></svg>Поделиться</button></div></div>${audioProgress(q)}</article>`).join('');}).join('')}`;
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
  content.querySelectorAll('[data-listen-quote]').forEach(button=>{
    const active=state?.id===button.dataset.listenQuote;
    const running=active && ['playing','loading'].includes(state.status);
    button.setAttribute('aria-pressed',String(Boolean(running)));
    button.querySelector('[data-listen-icon]').textContent=running?'Ⅱ':'▶';
    const label=running?'Пауза':active && state.status==='paused'?'Продолжить':active && state.status==='ended'?'Ещё раз':'Прослушать';
    button.querySelector('[data-listen-label]').textContent=label;
    const action=running?'Поставить цитату на паузу':active && state.status==='ended'?'Прослушать цитату ещё раз':`${label} цитату`;
    button.setAttribute('aria-label',`${action}. ${button.dataset.listenDescription}`);
  });
  content.querySelectorAll('[data-audio-progress]').forEach(row=>{
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
  if (!games.some(g=>g.id===selectedId)) selectedId=games[0]?.id || null;
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
    const count=new Set(quotes.map(q=>q.game_id)).size;
    return `<button type="button" class="episode-option" data-select-episode="${escapeHtml(ep.id)}" aria-pressed="${ep.id===selectedEpisode}"><span><strong>${escapeHtml(episodeName(ep))}</strong><small class="${count?'episode-ready':'episode-pending'}">${count?`${count} ${plural(count,'игра','игры','игр')} · ${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}`:'Игры пока не добавлены'}</small></span><span aria-hidden="true">${ep.id===selectedEpisode?'✓':''}</span></button>`;
  }).join('') + (episodes.length ? '' : '<p class="episode-no-results">Выпуски не найдены. Попробуйте другой номер или название.</p>');
  document.getElementById('episode-picker-note').textContent = `${query?'Найдено':'В архиве'}: ${episodes.length} ${plural(episodes.length,'выпуск','выпуска','выпусков')}.`;
}
trigger.addEventListener('click',()=>{search.value='';renderEpisodeOptions();picker.showModal();search.focus();});
search.addEventListener('input',renderEpisodeOptions);
document.getElementById('close-episode-picker').addEventListener('click',()=>picker.close());
picker.addEventListener('click',e=>{const choice=e.target.closest('[data-select-episode]');if(choice)selectEpisode(choice.dataset.selectEpisode);else if(e.target===picker){const r=picker.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)picker.close();}});
grid.addEventListener('click',e=>{const card=e.target.closest('[data-game]');if(card)selectGame(card.dataset.game,true);else if(e.target.closest('.show-all-episodes'))selectEpisode(null);});
content.addEventListener('click',e=>{
  if(e.target.closest('.close-details,.back-details')) {dismissCard();return;}
  const listen=e.target.closest('[data-listen-quote]');
  if(listen) {
    const quote=database.quotes.find(q=>q.id===listen.dataset.listenQuote);
    if(quote) quoteAudio.toggle(quote,database.episodes.find(ep=>ep.id===quote.episode_id));
    return;
  }
  const share=e.target.closest('[data-share-quote]');
  if(share) {shareQuote(share.dataset.shareQuote,share);return;}
  const episode=e.target.closest('[data-episode]');if(episode)selectEpisode(episode.dataset.episode);
});
shareDialog.addEventListener('close',releaseSharePreview);
shareDialog.addEventListener('cancel',e=>{if(nativeSharePending)e.preventDefault();});
document.getElementById('share-quote-image').addEventListener('click',shareQuoteImage);
document.getElementById('close-share-dialog').addEventListener('click',()=>shareDialog.close());
document.getElementById('copy-share-link').addEventListener('click',async()=>{
  await copyQuoteLink(document.getElementById('share-link').value);
});
document.addEventListener('keydown',e=>{if(shareDialog.open || nativeSharePending)return;if(e.key==='Escape'&&panel.classList.contains('is-open'))dismissCard();if(e.key==='Tab'&&panel.classList.contains('is-open')){const links=[...content.querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const last=links[links.length-1],first=links[0];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
narrow.addEventListener('change',syncPanel);
function restoreLocation(initial = false) {
  const url=new URL(location.href);
  const quote=database.quotes.find(q=>q.id===url.searchParams.get('quote'));
  const episode=quote?.episode_id || url.searchParams.get('episode');
  const gameId=quote?.game_id || url.hash.slice(1);
  const validGame=database.games.some(g=>g.id===gameId) && database.quotes.some(q=>q.game_id===gameId && (!episode || q.episode_id===episode));
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
fetch('data.json?v=0.5.0').then(r=>{if(!r.ok)throw new Error('data');return r.json();}).then(d=>{database=d;restoreLocation(true);trigger.disabled=false;}).catch(()=>{document.getElementById('error').hidden=false;document.getElementById('error').textContent='Не удалось открыть библиотеку. Обновите страницу.';});
