'use strict';
let database;
let selectedId;
let previouslyFocused;
const grid = document.getElementById('games');
const panel = document.getElementById('details');
const content = document.getElementById('detail-content');
const narrow = window.matchMedia('(max-width: 700px)');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
function plural(n, one, few, many) {return n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many;}
const gameQuotes = id => database.quotes.filter(q => q.game_id === id);
function image(game, large = false) {
  return game.cover ? `<img src="${escapeHtml(game.cover)}" alt="Коробка игры ${escapeHtml(game.name)}" ${large?'':'loading="lazy"'}>` : '<span class="missing-cover">Обложка уточняется</span>';
}
function renderLibrary() {
  document.getElementById('game-total').textContent = `${database.games.length} игр`;
  grid.innerHTML = database.games.map(g => {
    const n = gameQuotes(g.id).length;
    return `<button type="button" class="game-card" data-game="${escapeHtml(g.id)}" aria-pressed="${g.id===selectedId}" aria-label="${escapeHtml(g.name)}. ${n} ${plural(n,'цитата','цитаты','цитат')}. Открыть">
      <span class="quote-count">${n} ${plural(n,'цитата','цитаты','цитат')}</span><span class="cover-stage">${image(g)}</span>
      <span class="game-name">${escapeHtml(g.name)}</span><span class="game-subtitle">${escapeHtml(g.description)}</span></button>`;
  }).join('');
}
function selectGame(id, userAction = false) {
  const game = database.games.find(g => g.id === id);
  if (!game) return;
  selectedId = id;
  const quotes = gameQuotes(id);
  const episodes = [...new Set(quotes.map(q => q.episode_id))];
  grid.querySelectorAll('[data-game]').forEach(card => card.setAttribute('aria-pressed', card.dataset.game === id));
  content.innerHTML = `<div class="details-topline"><p class="eyebrow">ЧТО МЫ ГОВОРИЛИ</p><button type="button" class="icon-button close-details" aria-label="Вернуться к библиотеке">×</button></div>
    <div class="game-profile"><div class="detail-cover">${image(game,true)}</div><div><h2 id="detail-title">${escapeHtml(game.name)}</h2>
    ${game.original_name&&game.original_name!==game.name?`<p class="original-name">${escapeHtml(game.original_name)}</p>`:''}
    <a class="bgg-link" href="${escapeHtml(game.bgg_url)}" target="_blank" rel="noopener">Карточка на BGG</a></div></div>
    <p class="game-description">${escapeHtml(game.description)}</p>
    <div class="quotes-summary"><strong>${quotes.length} ${plural(quotes.length,'цитата','цитаты','цитат')}</strong><span>${episodes.length} ${plural(episodes.length,'выпуск','выпуска','выпусков')}</span></div>
    ${episodes.map(epId => {const ep=database.episodes.find(ep=>ep.id===epId);return `
    ${quotes.filter(q=>q.episode_id===epId).map(q => `<article class="quote-item" id="${q.id}"><blockquote>«${escapeHtml(q.text)}»</blockquote>
    <p class="quote-source">Выпуск ${ep.number} · ${time(q.start)}</p></article>`).join('')}`;}).join('')}
    `;
  panel.scrollTop = 0;
  if (userAction && narrow.matches) {
    previouslyFocused = document.activeElement;
    panel.classList.add('is-open');
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    document.querySelector('.library').inert=true;
    document.querySelector('.masthead').inert=true;
    content.querySelector('.close-details').focus();
  }
  if(userAction){history.replaceState(null,'',`#${id}`);document.getElementById('announcement').textContent=`Открыта игра ${game.name}, ${quotes.length} цитат.`;}
}
function closePanel(){panel.classList.remove('is-open');panel.removeAttribute('role');panel.removeAttribute('aria-modal');document.querySelector('.library').inert=false;document.querySelector('.masthead').inert=false;if(previouslyFocused)previouslyFocused.focus();}
grid.addEventListener('click',e=>{const card=e.target.closest('[data-game]');if(card)selectGame(card.dataset.game,true);});
content.addEventListener('click',e=>{if(e.target.closest('.close-details'))closePanel();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('is-open'))closePanel();if(e.key==='Tab'&&panel.classList.contains('is-open')){const links=[...content.querySelectorAll('button,a[href]')].filter(el=>el.getClientRects().length);const last=links[links.length-1],first=links[0];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
narrow.addEventListener('change',()=>{if(!narrow.matches)closePanel();});
fetch('data.json').then(r=>{if(!r.ok)throw new Error('data');return r.json();}).then(d=>{database=d;selectedId=d.games.some(g=>g.id===location.hash.slice(1))?location.hash.slice(1):'game-spartacus';renderLibrary();selectGame(selectedId);}).catch(()=>{document.getElementById('error').hidden=false;document.getElementById('error').textContent='Не удалось открыть библиотеку. Обновите страницу.';});
