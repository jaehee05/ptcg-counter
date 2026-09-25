'use strict';

const KEY = 'ptcg-counter-v1';
const PREF_KEY = 'ptcg-counter-prefs';
const COND = {
  poison: { label: '독', cls: 'c-poison' },
  burn: { label: '화상', cls: 'c-burn' },
  asleep: { label: '잠듦', cls: 'c-asleep' },
  paralyzed: { label: '마비', cls: 'c-paralyzed' },
  confused: { label: '혼란', cls: 'c-confused' },
};
const SPECIAL = ['asleep', 'paralyzed', 'confused']; // 서로 배타적 (카드 회전 상태)

const newMon = () => ({ name: '', hp: 0, dmg: 0, poison: false, burn: false, sp: null });
const newPlayer = (name) => ({
  name,
  prizes: Array(6).fill(false),
  active: null,
  bench: Array(8).fill(null),
  benchSize: 5,
  flags: { energy: false, supporter: false, retreat: false },
  vstar: false,
  gx: false,
});
const newGame = (names = ['나', '상대'], first = 0) => ({
  players: [newPlayer(names[0]), newPlayer(names[1])],
  turn: first,
  turnNo: 1,
  mulligan: [0, 0],
});

let S = load(KEY) || newGame();
let prefs = Object.assign({ layout: 'side' }, load(PREF_KEY));
let hist = [];
let modal = null; // { type, p, slot }
let checkQueue = [];

function load(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}
function commit(fn) {
  hist.push(JSON.stringify(S));
  if (hist.length > 300) hist.shift();
  fn();
  save();
  render();
}
function undo() {
  if (!hist.length) return toast('되돌릴 기록이 없어요');
  S = JSON.parse(hist.pop());
  checkQueue = [];
  if (modal && modal.type === 'check') modal = null;
  save();
  render();
  toast('되돌렸어요');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getMon = (p, slot) => (slot === 'a' ? S.players[p].active : S.players[p].bench[slot]);
const setMon = (p, slot, m) => { if (slot === 'a') S.players[p].active = m; else S.players[p].bench[slot] = m; };
const isKO = (m) => m && m.hp > 0 && m.dmg >= m.hp;
const monLabel = (m, slot) => (m && m.name) || (slot === 'a' ? '배틀 포켓몬' : '벤치 포켓몬');

let toastTimer;
function toast(msg, ms = 1800) {
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- 렌더 ---------- */

function hpBar(m) {
  if (!m.hp) return '';
  const left = Math.max(0, m.hp - m.dmg);
  const pct = Math.max(0, Math.min(100, (left / m.hp) * 100));
  const lvl = pct > 50 ? 'hi' : pct > 20 ? 'mid' : 'lo';
  return `<div class="hpbar"><i class="${lvl}" style="width:${pct}%"></i></div>`;
}

function condBadges(m) {
  return ['poison', 'burn'].filter((k) => m[k]).concat(m.sp ? [m.sp] : [])
    .map((k) => `<span class="cb ${COND[k].cls}">${COND[k].label}</span>`).join('');
}

function renderActive(p) {
  const a = S.players[p].active;
  if (!a) return `<div class="active empty" data-act="add" data-p="${p}" data-slot="a"><span>+ 배틀 포켓몬</span></div>`;
  const ko = isKO(a);
  const left = a.hp ? Math.max(0, a.hp - a.dmg) : null;
  const condBtn = (k) => {
    const on = k === 'poison' || k === 'burn' ? a[k] : a.sp === k;
    return `<button class="cond ${COND[k].cls} ${on ? 'on' : ''}" data-act="cond" data-p="${p}" data-k="${k}">${COND[k].label}</button>`;
  };
  const d = (v) => `<button class="dbtn ${v > 0 ? 'plus' : 'minus'}" data-act="dmg" data-p="${p}" data-slot="a" data-v="${v}">${v > 0 ? '+' : '−'}${Math.abs(v)}</button>`;
  return `<div class="active ${ko ? 'ko' : ''} ${a.sp ? 'rot-' + a.sp : ''}">
    <div class="a-top" data-act="edit" data-p="${p}" data-slot="a">
      <span class="mname">${esc(monLabel(a, 'a'))}</span>
      <span class="hp">${a.hp ? `HP ${a.hp}` : 'HP 설정 ✎'}</span>
    </div>
    ${hpBar(a)}
    <div class="a-mid">
      <div class="dcol">${d(-10)}${d(-50)}${d(-100)}</div>
      <div class="dmgval" data-act="edit" data-p="${p}" data-slot="a">
        <b>${a.dmg}</b>
        <small>${ko ? '기절!' : left !== null ? `남은 HP ${left}` : '데미지'}</small>
      </div>
      <div class="dcol">${d(10)}${d(50)}${d(100)}</div>
    </div>
    <div class="conds">
      ${condBtn('poison')}${condBtn('burn')}<span class="sep"></span>${condBtn('asleep')}${condBtn('paralyzed')}${condBtn('confused')}
    </div>
    <div class="a-actions">
      <button class="ghost" data-act="clearcond" data-p="${p}">상태 해제</button>
      <button class="ghost danger" data-act="ko" data-p="${p}" data-slot="a">기절 처리</button>
    </div>
  </div>`;
}

function renderBench(p) {
  const P = S.players[p];
  let html = '';
  for (let i = 0; i < P.benchSize; i++) {
    const m = P.bench[i];
    if (!m) {
      html += `<div class="btile empty" data-act="add" data-p="${p}" data-slot="${i}">+</div>`;
      continue;
    }
    html += `<div class="btile ${isKO(m) ? 'ko' : ''}" data-act="edit" data-p="${p}" data-slot="${i}">
      <div class="bname">${esc(monLabel(m, i))}</div>
      <div class="bdmg"><b>${m.dmg}</b>${m.hp ? `<small>/${m.hp}</small>` : ''}</div>
      ${hpBar(m)}
      <button class="bquick" data-act="dmg" data-p="${p}" data-slot="${i}" data-v="10">+10</button>
    </div>`;
  }
  return `<div class="bench b${P.benchSize}">${html}</div>`;
}

function renderPrizes(p) {
  const P = S.players[p];
  const left = P.prizes.filter((x) => !x).length;
  return `<div class="prizes">
    <div class="plabel">프라이즈 <b>${left}</b></div>
    <div class="pgrid">${P.prizes.map((t, i) => `<button class="prize ${t ? 'taken' : ''}" data-act="prize" data-p="${p}" data-i="${i}">${t ? '' : i + 1}</button>`).join('')}</div>
  </div>`;
}

function renderHeader(p) {
  const P = S.players[p];
  const f = (k, label) => `<button class="flag ${P.flags[k] ? 'on' : ''}" data-act="flag" data-p="${p}" data-k="${k}">${label}</button>`;
  const once = (k, label) => `<button class="once ${P[k] ? 'used' : ''}" data-act="once" data-p="${p}" data-k="${k}">${label}</button>`;
  return `<header class="phead">
    <div class="pname" data-act="rename" data-p="${p}">${S.turn === p ? '<span class="turnmark">▶</span>' : ''}${esc(P.name)}</div>
    <div class="flags">${f('energy', '에너지')}${f('supporter', '서포터')}${f('retreat', '후퇴')}${once('vstar', 'VSTAR')}${once('gx', 'GX')}</div>
  </header>`;
}

function renderPanel(p) {
  const el = document.getElementById('p' + p);
  el.classList.toggle('myturn', S.turn === p);
  el.innerHTML = renderHeader(p) + renderPrizes(p) + `<div class="activewrap">${renderActive(p)}</div>` + renderBench(p);
}

function renderCenter() {
  const cur = S.players[S.turn];
  document.getElementById('center').innerHTML = `
    <div class="turninfo"><small>턴</small><b>${S.turnNo}</b><span>${esc(cur.name)}</span></div>
    <button class="cbtn primary" data-act="endturn">턴 종료<small>포켓몬 체크</small></button>
    <button class="cbtn" data-act="guide">📖<small>준비·규칙</small></button>
    <button class="cbtn" data-act="coin">🪙<small>코인</small></button>
    <button class="cbtn" data-act="undo">↶<small>되돌리기</small></button>
    <button class="cbtn" data-act="settings">⚙<small>설정</small></button>`;
}

function renderModal() {
  const box = document.getElementById('modal-box');
  const wrap = document.getElementById('modal');
  if (!modal) { wrap.classList.add('hidden'); box.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  box.classList.toggle('flip', prefs.layout === 'face' && modal.p === 1);
  if (modal.type === 'edit') box.innerHTML = editModal();
  else if (modal.type === 'coin') box.innerHTML = coinModal();
  else if (modal.type === 'settings') box.innerHTML = settingsModal();
  else if (modal.type === 'check') box.innerHTML = checkModal();
  else if (modal.type === 'guide') box.innerHTML = guideModal();
  box.classList.toggle('wide', modal.type === 'guide');
}

function editModal() {
  const { p, slot } = modal;
  const m = getMon(p, slot);
  if (!m) { modal = null; return ''; }
  const d = (v) => `<button class="dbtn ${v > 0 ? 'plus' : 'minus'}" data-act="dmg" data-p="${p}" data-slot="${slot}" data-v="${v}">${v > 0 ? '+' : '−'}${Math.abs(v)}</button>`;
  const hpChips = [60, 70, 90, 110, 130, 190, 220, 250, 280, 320].map((h) => `<button class="chip ${m.hp === h ? 'on' : ''}" data-act="sethp" data-v="${h}">${h}</button>`).join('');
  return `<h2>${slot === 'a' ? '배틀 포켓몬' : `벤치 ${slot + 1}`} · ${esc(S.players[p].name)}</h2>
    <label class="field">이름<input id="f-name" value="${esc(m.name)}" placeholder="예: 리자몽 ex" autocomplete="off"></label>
    <label class="field">최대 HP<input id="f-hp" type="number" inputmode="numeric" step="10" value="${m.hp || ''}" placeholder="비워두면 데미지만 기록"></label>
    <div class="chips">${hpChips}</div>
    <div class="edmg">
      <div class="dcol">${d(-10)}${d(-50)}${d(-100)}</div>
      <div class="dmgval"><b>${m.dmg}</b><small>${isKO(m) ? '기절!' : m.hp ? `남은 HP ${Math.max(0, m.hp - m.dmg)}` : '데미지'}</small></div>
      <div class="dcol">${d(10)}${d(50)}${d(100)}</div>
    </div>
    <div class="mactions">
      ${slot !== 'a' ? `<button class="primary" data-act="promote" data-p="${p}" data-slot="${slot}">⇅ 배틀 포켓몬과 교체</button>` : ''}
      <button class="danger" data-act="ko" data-p="${p}" data-slot="${slot}">기절 처리</button>
      <button data-act="remove" data-p="${p}" data-slot="${slot}">비우기</button>
      <button data-act="close">닫기</button>
    </div>`;
}

function coinModal() {
  const r = modal.result;
  return `<h2>코인 던지기</h2>
    <div class="coin ${modal.spin ? 'spin' : ''} ${r === 'H' ? 'heads' : r === 'T' ? 'tails' : ''}" data-act="flip">
      <span>${r === 'H' ? '앞' : r === 'T' ? '뒤' : '?'}</span>
    </div>
    <p class="coinres">${r ? (r === 'H' ? '앞면!' : '뒷면!') : '코인을 탭하세요'}</p>
    ${modal.log && modal.log.length ? `<p class="coinlog">${modal.log.map((x) => (x === 'H' ? '●' : '○')).join(' ')}<br><small>앞 ${modal.log.filter((x) => x === 'H').length} · 뒤 ${modal.log.filter((x) => x === 'T').length}</small></p>` : ''}
    <div class="mactions">
      <button class="primary" data-act="flip">다시 던지기</button>
      <button data-act="coinreset">기록 지우기</button>
      <button data-act="close">닫기</button>
    </div>`;
}

function settingsModal() {
  const P = S.players;
  return `<h2>설정</h2>
    <div class="srow"><span>레이아웃</span>
      <div class="seg">
        <button class="${prefs.layout === 'side' ? 'on' : ''}" data-act="layout" data-v="side">나란히</button>
        <button class="${prefs.layout === 'face' ? 'on' : ''}" data-act="layout" data-v="face">마주보기</button>
      </div></div>
    <p class="hint">마주보기: 아이패드를 두 사람 사이에 놓으면 위쪽 화면이 상대 방향으로 뒤집혀요.</p>
    ${[0, 1].map((p) => `<div class="srow"><span>${esc(P[p].name)} 벤치</span>
      <div class="seg">
        <button class="${P[p].benchSize === 5 ? 'on' : ''}" data-act="bench" data-p="${p}" data-v="5">5칸</button>
        <button class="${P[p].benchSize === 8 ? 'on' : ''}" data-act="bench" data-p="${p}" data-v="8">8칸</button>
      </div></div>`).join('')}
    <div class="srow"><span>새 게임</span>
      <div class="seg">
        <button data-act="newgame" data-v="0">${esc(P[0].name)} 선공</button>
        <button data-act="newgame" data-v="1">${esc(P[1].name)} 선공</button>
        <button data-act="newgame" data-v="r">🪙 랜덤</button>
      </div></div>
    <div class="mactions"><button data-act="close">닫기</button></div>`;
}

function checkModal() {
  const item = checkQueue[0];
  if (!item) return '';
  const P = S.players[item.p];
  const m = P.active;
  const what = item.k === 'burn' ? '화상' : '잠듦';
  return `<h2>포켓몬 체크 · ${esc(P.name)}</h2>
    <p class="checkq"><b>${esc(monLabel(m, 'a'))}</b>의 <span class="cb ${COND[item.k].cls}">${what}</span><br>코인 앞면이면 회복해요.</p>
    <div class="mactions">
      <button class="primary" data-act="checkflip">🪙 코인 던지기</button>
      <button data-act="checkres" data-v="H">앞면 (회복)</button>
      <button data-act="checkres" data-v="T">뒷면 (유지)</button>
    </div>
    <p class="hint">${checkQueue.length > 1 ? `남은 체크 ${checkQueue.length - 1}개` : ''}</p>`;
}

const GUIDE_TABS = [['setup', '게임 준비'], ['turn', '턴 진행'], ['cond', '특수상태'], ['win', '승리 조건']];

function guideModal() {
  const tab = modal.tab;
  const P = S.players;
  const mull = S.mulligan || [0, 0];
  let body = '';
  if (tab === 'setup') {
    body = `<ol class="steps">
      <li><b>악수하고 덱(60장)을 섞기</b><span>상대 덱을 섞어 줘도 돼요.</span></li>
      <li><b>코인 던지기로 선공 정하기</b><span>이긴 사람이 선공·후공을 골라요. 설정 → 새 게임 → 🪙 랜덤으로도 가능.</span></li>
      <li><b>덱 위에서 7장 뽑기</b></li>
      <li><b>기본 포켓몬 1장을 뒷면으로 배틀 필드에</b><span>나머지 기본 포켓몬은 벤치에 최대 5장까지 뒷면으로 (선택).</span></li>
      <li><b>기본 포켓몬이 없으면 멀리건</b><span>손패를 상대에게 보여주고 덱에 넣어 다시 섞은 뒤 7장 뽑기. 기본 포켓몬이 나올 때까지 반복해요. 상대는 멀리건 횟수만큼 카드를 더 뽑을 수 있어요 (선택).</span></li>
      <li><b>덱 위에서 6장을 뒷면으로 프라이즈에</b><span>카드 앞면을 보지 않고 그대로 옆에 둬요.</span></li>
      <li><b>동시에 포켓몬을 앞면으로 뒤집고 시작!</b><span>여기서 배틀·벤치 포켓몬을 앱에 등록해 두세요.</span></li>
    </ol>
    <div class="mull">
      <div class="mtitle">멀리건 기록</div>
      ${[0, 1].map((p) => `<div class="mrow"><span>${esc(P[p].name)}</span>
        <div class="stepper"><button data-act="mull" data-p="${p}" data-v="-1">−</button><b>${mull[p]}</b><button data-act="mull" data-p="${p}" data-v="1">+</button></div>
        <small>${mull[p] ? `→ ${esc(P[1 - p].name)} 최대 ${mull[p]}장 추가 드로우` : ''}</small></div>`).join('')}
    </div>
    <p class="note">⚠️ 선공 첫 턴: 드로우는 하지만 <b>공격 불가 · 서포터 사용 불가</b>. 양쪽 모두 첫 턴과, 이번 턴에 낸 포켓몬은 <b>진화 불가</b>.</p>`;
  } else if (tab === 'turn') {
    body = `<ol class="steps">
      <li><b>덱에서 1장 드로우</b><span>뽑을 카드가 없으면 그 자리에서 패배.</span></li>
      <li><b>아래 행동을 원하는 순서로</b>
        <ul>
          <li>기본 포켓몬을 벤치에 내기 (몇 장이든, 벤치 5칸까지)</li>
          <li>진화 (각 포켓몬 턴당 1회 · 낸 턴엔 불가)</li>
          <li>손패의 에너지 부착 <em>턴에 1번</em></li>
          <li>서포터 <em>턴에 1번</em> · 스타디움 <em>턴에 1번</em> · 아이템·포켓몬의 도구는 자유</li>
          <li>후퇴 <em>턴에 1번</em> (후퇴 에너지만큼 트래시, 특수상태 회복)</li>
          <li>특성 사용</li>
        </ul>
      </li>
      <li><b>공격</b> — 공격하면 턴이 끝나요.<span>약점 ×2 → 저항력 −30 순서로 계산.</span></li>
      <li><b>포켓몬 체크</b> — 앱의 <b>턴 종료</b> 버튼이 독·화상·잠듦·마비를 처리해요.</li>
      <li><b>기절시켰다면</b> 프라이즈를 가져가요 (포켓몬 ex·V는 2장, VMAX·메가진화 ex는 3장). 기절한 쪽은 벤치에서 새 배틀 포켓몬을 내요.</li>
    </ol>`;
  } else if (tab === 'cond') {
    const row = (k, desc) => `<div class="crow"><span class="cb ${COND[k].cls}">${COND[k].label}</span><p>${desc}</p></div>`;
    body = `<div class="clist">
      ${row('poison', '포켓몬 체크마다 데미지 카운터 1개 (10).')}
      ${row('burn', '포켓몬 체크마다 데미지 카운터 2개 (20), 그 후 코인 앞면이면 회복.')}
      ${row('asleep', '공격·후퇴 불가. 포켓몬 체크 때 코인 앞면이면 회복. (카드를 왼쪽으로 돌려 표시)')}
      ${row('paralyzed', '공격·후퇴 불가. 걸린 쪽 플레이어의 다음 턴이 끝난 후 포켓몬 체크 때 회복. (오른쪽으로 돌려 표시)')}
      ${row('confused', '공격할 때 코인 → 뒷면이면 공격 실패, 자신에게 30 데미지. 후퇴는 가능. (거꾸로 돌려 표시)')}
    </div>
    <p class="note">잠듦·마비·혼란은 카드 방향으로 표시하기 때문에 <b>하나만</b> 걸려요 (새로 걸리면 교체). 독·화상은 따로 표시해서 함께 걸릴 수 있어요. <b>벤치로 가거나 진화하면 모든 특수상태가 회복</b>돼요.</p>`;
  } else {
    body = `<ol class="steps">
      <li><b>프라이즈를 모두 가져가기</b></li>
      <li><b>상대 필드에 포켓몬이 하나도 없게 만들기</b><span>배틀 포켓몬이 기절했는데 벤치에 낼 포켓몬이 없을 때.</span></li>
      <li><b>상대가 턴 시작에 덱에서 카드를 뽑지 못하기</b></li>
    </ol>
    <p class="note">동시에 승리 조건을 만족하면 서든데스(프라이즈 1장으로 새 게임)로 결정해요.</p>`;
  }
  return `<h2>게임 가이드</h2>
    <div class="seg tabs">${GUIDE_TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="guide">${body}</div>
    <div class="mactions"><button data-act="close">닫기</button></div>`;
}

function render() {
  document.body.className = prefs.layout === 'face' ? 'face' : 'side';
  renderPanel(0);
  renderPanel(1);
  renderCenter();
  renderModal();
}

/* ---------- 동작 ---------- */

function applyCheckResult(r) {
  const item = checkQueue.shift();
  if (!item) return;
  const m = S.players[item.p].active;
  const name = esc(S.players[item.p].name);
  if (m) {
    if (r === 'H') {
      if (item.k === 'burn') m.burn = false;
      if (item.k === 'asleep' && m.sp === 'asleep') m.sp = null;
    }
  }
  toast(`${name} · ${item.k === 'burn' ? '화상' : '잠듦'}: ${r === 'H' ? '앞면 → 회복' : '뒷면 → 유지'}`);
  if (!checkQueue.length) modal = null;
  save();
  render();
}

function endTurn() {
  commit(() => {
    const cur = S.turn;
    const notes = [];
    checkQueue = [];
    [cur, 1 - cur].forEach((p) => {
      const m = S.players[p].active;
      if (!m) return;
      const nm = esc(S.players[p].name);
      if (m.poison) { m.dmg += 10; notes.push(`${nm} 독 +10`); }
      if (m.burn) { m.dmg += 20; notes.push(`${nm} 화상 +20`); checkQueue.push({ p, k: 'burn' }); }
      if (m.sp === 'asleep') checkQueue.push({ p, k: 'asleep' });
      if (m.sp === 'paralyzed' && p === cur) { m.sp = null; notes.push(`${nm} 마비 회복`); }
    });
    S.turn = 1 - cur;
    S.turnNo += 1;
    S.players.forEach((P) => (P.flags = { energy: false, supporter: false, retreat: false }));
    if (checkQueue.length) modal = { type: 'check', p: checkQueue[0].p };
    toast(`${esc(S.players[S.turn].name)}의 턴${notes.length ? '<br><small>' + notes.join(' · ') + '</small>' : ''}`, 2400);
  });
}

function knockOut(p, slot) {
  const m = getMon(p, slot);
  commit(() => {
    setMon(p, slot, null);
    if (modal && modal.type === 'edit') modal = null;
  });
  const opp = S.players[1 - p];
  toast(`${esc(monLabel(m, slot))} 기절!<br><small>${esc(opp.name)}: 프라이즈를 가져가세요${slot === 'a' ? ` · ${esc(S.players[p].name)}: 새 배틀 포켓몬 선택` : ''}</small>`, 3000);
}

function flipCoin() { return Math.random() < 0.5 ? 'H' : 'T'; }

function onAction(el) {
  const act = el.dataset.act;
  const p = el.dataset.p !== undefined ? +el.dataset.p : modal?.p;
  const slotRaw = el.dataset.slot ?? modal?.slot;
  const slot = slotRaw === 'a' || slotRaw === undefined ? slotRaw : +slotRaw;
  const v = el.dataset.v;

  switch (act) {
    case 'add':
      commit(() => setMon(p, slot, newMon()));
      modal = { type: 'edit', p, slot };
      renderModal();
      break;
    case 'edit':
      modal = { type: 'edit', p, slot };
      renderModal();
      break;
    case 'dmg':
      commit(() => { const m = getMon(p, slot); m.dmg = Math.max(0, m.dmg + +v); });
      break;
    case 'sethp':
      commit(() => { getMon(modal.p, modal.slot).hp = +v; });
      break;
    case 'cond':
      commit(() => {
        const m = S.players[p].active;
        const k = el.dataset.k;
        if (SPECIAL.includes(k)) m.sp = m.sp === k ? null : k;
        else m[k] = !m[k];
      });
      break;
    case 'clearcond':
      commit(() => { const m = S.players[p].active; m.poison = m.burn = false; m.sp = null; });
      break;
    case 'ko':
      knockOut(p, slot);
      break;
    case 'remove':
      commit(() => { setMon(p, slot, null); modal = null; });
      break;
    case 'promote':
      commit(() => {
        const P = S.players[p];
        const a = P.active;
        const b = P.bench[slot];
        [a, b].forEach((m) => { if (m) { m.poison = m.burn = false; m.sp = null; } });
        P.active = b;
        P.bench[slot] = a;
        modal = null;
      });
      break;
    case 'prize':
      commit(() => { const P = S.players[p]; P.prizes[+el.dataset.i] = !P.prizes[+el.dataset.i]; });
      if (S.players[p].prizes.every(Boolean)) toast(`🏆 ${esc(S.players[p].name)} 승리!`, 3500);
      break;
    case 'flag':
      commit(() => { const f = S.players[p].flags; f[el.dataset.k] = !f[el.dataset.k]; });
      break;
    case 'once':
      commit(() => { const P = S.players[p]; P[el.dataset.k] = !P[el.dataset.k]; });
      break;
    case 'rename': {
      const name = prompt('플레이어 이름', S.players[p].name);
      if (name && name.trim()) commit(() => { S.players[p].name = name.trim().slice(0, 12); });
      break;
    }
    case 'endturn':
      endTurn();
      break;
    case 'undo':
      undo();
      break;
    case 'coin':
      modal = { type: 'coin', result: null, log: [] };
      doFlip();
      break;
    case 'flip':
      doFlip();
      break;
    case 'coinreset':
      modal.log = [];
      modal.result = null;
      renderModal();
      break;
    case 'guide':
      modal = { type: 'guide', tab: v || 'setup' };
      renderModal();
      break;
    case 'tab':
      modal.tab = v;
      renderModal();
      document.getElementById('modal-box').scrollTop = 0;
      break;
    case 'mull':
      commit(() => { S.mulligan = S.mulligan || [0, 0]; S.mulligan[p] = Math.max(0, S.mulligan[p] + +v); });
      break;
    case 'settings':
      modal = { type: 'settings' };
      renderModal();
      break;
    case 'layout':
      prefs.layout = v;
      save();
      render();
      break;
    case 'bench':
      commit(() => {
        const P = S.players[p];
        P.benchSize = +v;
        if (+v === 5) {
          // 줄어든 칸의 포켓몬은 빈 앞칸으로 당겨옴
          const mons = P.bench.filter(Boolean);
          if (mons.length > 5) toast('벤치에 포켓몬이 5마리보다 많아요 — 일부는 숨겨집니다');
          P.bench = Array(8).fill(null);
          mons.forEach((m, i) => (P.bench[i] = m));
        }
      });
      break;
    case 'newgame': {
      const first = v === 'r' ? (Math.random() < 0.5 ? 0 : 1) : +v;
      const names = S.players.map((P) => P.name);
      commit(() => { S = newGame(names, first); modal = null; });
      modal = { type: 'guide', tab: 'setup' };
      renderModal();
      toast(`새 게임 · ${esc(S.players[first].name)} 선공${v === 'r' ? ' (코인)' : ''}`, 2400);
      break;
    }
    case 'checkflip': {
      const r = flipCoin();
      applyCheckResult(r);
      break;
    }
    case 'checkres':
      applyCheckResult(v);
      break;
    case 'close':
      modal = null;
      renderModal();
      break;
  }
}

let flipTimer;
function doFlip() {
  clearTimeout(flipTimer);
  modal.spin = true;
  modal.result = null;
  renderModal();
  flipTimer = setTimeout(() => {
    if (!modal || modal.type !== 'coin') return;
    modal.spin = false;
    modal.result = flipCoin();
    modal.log.push(modal.result);
    renderModal();
  }, 650);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) { onAction(el); return; }
  if (e.target.id === 'modal' && (!modal || modal.type !== 'check')) { modal = null; renderModal(); }
});

// 편집 모달 입력 (이름/HP)
document.addEventListener('change', (e) => {
  if (!modal || modal.type !== 'edit') return;
  const m = getMon(modal.p, modal.slot);
  if (!m) return;
  if (e.target.id === 'f-name') commit(() => { m.name = e.target.value.trim().slice(0, 20); });
  if (e.target.id === 'f-hp') commit(() => { getMon(modal.p, modal.slot).hp = Math.max(0, parseInt(e.target.value, 10) || 0); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
});

// 화면 꺼짐 방지
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch {}
}
document.addEventListener('pointerdown', keepAwake, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (!load(KEY)) { modal = { type: 'guide', tab: 'setup' }; save(); }
render();
