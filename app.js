'use strict';
let database;
let selectedId;
let selectedEpisode = null;
let previouslyFocused;
const grid = document.getElementById('games');
const panel = document.getElementById('details');
const content = document.getElementById('detail-content');
const picker = document.getElementById('episode-picker');
const search = document.getElementById('episode-search');
const trigger = document.getElementById('episode-trigger');
const narrow = window.matchMedia('(max-width: 700px)');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const normalize = value => String(value ?? '').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
const episodeName = ep => `${ep.number == null ? 'Без номера' : ep.number}. ${ep.title}`;
const quoteEpisodeName = ep => ep.number == null ? 'Без номера' : `Выпуск ${ep.number}`;
function plural(n, one, few, many) {return n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many;}
const currentQuotes = () => database.quotes.filter(q => !selectedEpisode || q.episode_id === selectedEpisode);
const gameQuotes = id => currentQuotes().filter(q => q.game_id === id);
const visibleGames = () => {const ids=new Set(currentQuotes().map(q=>q.game_id));return database.games.filter(g=>ids.has(g.id));};
function image(game, large = false) {
  return game.cover ? `<img src="${escapeHtml(game.cover)}" alt="Коробка игры ${escapeHtml(game.name)}" ${large?'':'loading="lazy"'}>` : '<span class="missing-cover">Обложка уточняется</span>';
}
function renderLibrary() {
  const games = visibleGames();
  const episode = database.episodes.find(ep=>ep.id===selectedEpisode);
  document.getElementById('game-total').textContent = `${games.length} ${plural(games.length,'игра','игры','игр')}`;
  document.getElementById('episode-label').textContent = episode ? episodeName(episode) : 'Все выпуски';
  trigger.title = episode ? episodeName(episode) : 'Выбрать выпуск';
  document.getElementById('episode-meta').hidden = Boolean(episode);
  document.getElementById('episode-meta').textContent = episode ? '' : `${new Set(database.quotes.map(q=>q.episode_id)).size} ${plural(new Set(database.quotes.map(q=>q.episode_id)).size,'выпуск','выпуска','выпусков')} с цитатами`;
  document.getElementById('library-note').hidden = Boolean(selectedEpisode && selectedEpisode !== 'episode-001');
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
function updateUrl(push = false) {
  const url = new URL(location.href);
  if (selectedEpisode) url.searchParams.set('episode',selectedEpisode); else url.searchParams.delete('episode');
  url.hash = selectedId || '';
  history[push?'pushState':'replaceState'](null,'',url);
}
function selectGame(id, userAction = false) {
  const game = database.games.find(g => g.id === id);
  const quotes = gameQuotes(id);
  if (!game || !quotes.length) return;
  selectedId = id;
  const episodes = [...new Set(quotes.map(q => q.episode_id))];
  grid.querySelectorAll('[data-game]').forEach(card => card.setAttribute('aria-pressed', card.dataset.game === id));
  content.innerHTML = `<div class="details-topline"><p class="eyebrow">ЧТО МЫ ГОВОРИЛИ</p><button type="button" class="icon-button close-details" aria-label="Вернуться к библиотеке">×</button></div>
    <div class="game-profile"><div class="detail-cover">${image(game,true)}</div><div><h2 id="detail-title">${escapeHtml(game.name)}</h2>
    ${game.original_name&&game.original_name!==game.name?`<p class="original-name">${escapeHtml(game.original_name)}</p>`:''}
    <a class="bgg-link" href="${escapeHtml(game.bgg_url)}" target="_blank" rel="noopener">Карточка на BGG</a></div></div>
    <p class="game-description">${escapeHtml(game.description)}</p>
    <div class="quotes-summary"><strong>${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}</strong><span>${episodes.length} ${plural(episodes.length,'выпуск','выпуска','выпусков')}</span></div>
    ${episodes.map(epId => {const ep=database.episodes.find(ep=>ep.id===epId);return quotes.filter(q=>q.episode_id===epId).map(q => `<article class="quote-item" id="${escapeHtml(q.id)}"><blockquote>«${escapeHtml(q.text)}»</blockquote>
    <p class="quote-source"><button type="button" class="quote-episode" data-episode="${escapeHtml(ep.id)}" aria-label="Показать игры из ${ep.number==null?'этого выпуска':`выпуска ${ep.number}`}">${escapeHtml(quoteEpisodeName(ep))}</button> · ${time(q.start)}</p></article>`).join('');}).join('')}`;
  panel.scrollTop = 0;
  if (userAction && narrow.matches) {
    previouslyFocused = document.activeElement;
    panel.classList.add('is-open');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    document.querySelector('.library').inert=true;
    document.querySelector('.masthead').inert=true;
    content.querySelector('.close-details').focus();
  }
  if(userAction){updateUrl();document.getElementById('announcement').textContent=`Открыта игра ${game.name}, ${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}.`;}
}
function closePanel(){panel.classList.remove('is-open');panel.removeAttribute('role');panel.removeAttribute('aria-modal');document.querySelector('.library').inert=false;document.querySelector('.masthead').inert=false;if(previouslyFocused?.isConnected)previouslyFocused.focus();}
function selectEpisode(id, userAction = true) {
  if (id && !database.episodes.some(ep=>ep.id===id)) return;
  closePanel();
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
  const episodes = database.episodes.filter(ep=>/^\d+$/.test(query) ? String(ep.number)===String(Number(query)) : normalize(episodeName(ep)).includes(query));
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
content.addEventListener('click',e=>{if(e.target.closest('.close-details'))closePanel();const episode=e.target.closest('[data-episode]');if(episode)selectEpisode(episode.dataset.episode);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('is-open'))closePanel();if(e.key==='Tab'&&panel.classList.contains('is-open')){const links=[...content.querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const last=links[links.length-1],first=links[0];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
narrow.addEventListener('change',()=>{if(!narrow.matches)closePanel();});
function restoreLocation(){const id=new URL(location.href).searchParams.get('episode');selectedId=location.hash.slice(1);selectEpisode(database.episodes.some(ep=>ep.id===id)?id:null,false);}
window.addEventListener('popstate',()=>{if(database)restoreLocation();});
window.addEventListener('hashchange',()=>{if(database)restoreLocation();});
fetch('data.json?v=0.2.1').then(r=>{if(!r.ok)throw new Error('data');return r.json();}).then(d=>{database=d;restoreLocation();trigger.disabled=false;}).catch(()=>{document.getElementById('error').hidden=false;document.getElementById('error').textContent='Не удалось открыть библиотеку. Обновите страницу.';});
