
const FIREBASE_URL = 'https://football-championship-manager-default-rtdb.asia-southeast1.firebasedatabase.app/';


(function () {
  'use strict';

  const LOCAL_KEY     = 'fcm_v7_local';
  const FIREBASE_PATH = '/fcm_data.json';
  const GROUPS        = ['A', 'B', 'C', 'D'];
  const MIN_TEAMS     = 2;
  const MAX_TEAMS     = 6;
  const GROUP_COLORS  = { A: 'sc-a', B: 'sc-b', C: 'sc-c', D: 'sc-d' };

  const useFirebase = typeof FIREBASE_URL === 'string' && FIREBASE_URL.trim().length > 0;

  // ─── Trạng thái sync ───────────────────────────────────────
  let lastSavedHash     = null;
  let isSaving          = false;
  let saveDebounceTimer = null;
  let firebaseEventSource = null;
  let suppressNextSSE   = false; // chặn echo sau khi tự mình save

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h;
  }

  // ─── Firebase REST API ─────────────────────────────────────
  async function fbWrite(data) {
    if (!useFirebase) return;
    const url = FIREBASE_URL.replace(/\/$/, '') + FIREBASE_PATH;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Firebase write failed: ' + res.status);
  }

  async function fbRead() {
    if (!useFirebase) return null;
    const url = FIREBASE_URL.replace(/\/$/, '') + FIREBASE_PATH;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Firebase read failed: ' + res.status);
    return await res.json();
  }

  // ─── Firebase SSE — lắng nghe thay đổi REAL-TIME ──────────
  // Firebase Realtime Database hỗ trợ EventSource (SSE) tại chính URL .json
  // → cập nhật tức thì cho tất cả trình duyệt, không cần polling
  function startFirebaseStream() {
    if (!useFirebase) return;

    // Đóng kết nối cũ nếu có
    if (firebaseEventSource) {
      firebaseEventSource.close();
      firebaseEventSource = null;
    }

    const url = FIREBASE_URL.replace(/\/$/, '') + FIREBASE_PATH;

    try {
      const es = new EventSource(url);
      firebaseEventSource = es;

      // Sự kiện "put" — Firebase gửi toàn bộ dữ liệu tại path
      es.addEventListener('put', (e) => {
        try {
          const payload = JSON.parse(e.data);
          const remote  = payload.data;

          // Firebase trả về null khi path chưa có dữ liệu
          if (!remote || !remote.groups) return;

          const s = JSON.stringify(remote);
          const h = hashStr(s);

          // Bỏ qua echo từ chính lần save của mình vừa rồi
          if (suppressNextSSE) {
            suppressNextSSE = false;
            lastSavedHash = h;
            return;
          }

          // Chỉ cập nhật khi dữ liệu thực sự thay đổi
          if (lastSavedHash !== null && h === lastSavedHash) return;

          lastSavedHash = h;
          appData = remote;
          lsWrite(appData);
          if (remote.drawResult?.teams) drawTeams = [...remote.drawResult.teams];

          rerenderCurrentPage();
          showRemoteUpdateToast();
          setBadge('online');
        } catch (err) {
          console.warn('SSE parse error:', err);
        }
      });

      es.addEventListener('error', () => {
        setBadge('offline');
        es.close();
        firebaseEventSource = null;
        // Thử kết nối lại sau 8 giây
        setTimeout(startFirebaseStream, 8000);
      });

    } catch (err) {
      console.warn('EventSource không hoạt động, chuyển sang polling:', err);
      startPollingFallback();
    }
  }

  // ─── Polling fallback (khi SSE không khả dụng) ────────────
  function startPollingFallback() {
    setInterval(async () => {
      if (isSaving) return;
      try {
        const remote = await fbRead();
        if (!remote || !remote.groups) return;
        const s = JSON.stringify(remote);
        const h = hashStr(s);
        if (lastSavedHash !== null && h !== lastSavedHash) {
          lastSavedHash = h;
          appData = remote;
          lsWrite(appData);
          if (remote.drawResult?.teams) drawTeams = [...remote.drawResult.teams];
          rerenderCurrentPage();
          showRemoteUpdateToast();
        }
        if (lastSavedHash === null) lastSavedHash = h;
        setBadge('online');
      } catch (e) {
        setBadge('offline');
      }
    }, 5000);
  }

  // ─── LocalStorage fallback ─────────────────────────────────
  function lsWrite(data) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch(e) {}
  }
  function lsRead() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  // ─── Save data ─────────────────────────────────────────────
  async function saveData() {
    // Lưu local ngay lập tức để không bao giờ mất dữ liệu
    lsWrite(appData);

    if (!useFirebase) {
      setBadge('local');
      showSaveIndicator();
      return;
    }

    if (isSaving) return; // đang save, bỏ qua (debounce sẽ gọi lại)
    isSaving = true;
    setBadge('saving');

    try {
      await fbWrite(appData);
      const s = JSON.stringify(appData);
      lastSavedHash = hashStr(s);
      suppressNextSSE = true; // chặn echo SSE ngay sau khi save
      setBadge('online');
      showSaveIndicator();
    } catch(e) {
      console.warn('Firebase save failed, using local only', e);
      setBadge('offline');
      suppressNextSSE = false;
    } finally {
      isSaving = false;
    }
  }

  // Phiên bản debounce của saveData — dùng khi người dùng đang gõ
  function saveDataDebounced(delayMs) {
    delayMs = delayMs || 600;
    clearTimeout(saveDebounceTimer);
    // Lưu local ngay lập tức để UI không bị chậm
    lsWrite(appData);
    // Firebase sẽ cập nhật sau khi dừng gõ
    saveDebounceTimer = setTimeout(() => saveData(), delayMs);
  }

  // ─── Load data ─────────────────────────────────────────────
  async function loadData() {
    if (useFirebase) {
      try {
        setBadge('saving');
        const remote = await fbRead();
        if (remote && remote.groups) {
          lsWrite(remote);
          const s = JSON.stringify(remote);
          lastSavedHash = hashStr(s);
          setBadge('online');
          return remote;
        }
      } catch(e) {
        console.warn('Firebase load failed, falling back to local', e);
        setBadge('offline');
      }
    }
    const local = lsRead();
    if (local && local.groups) return local;
    return createDefaultData();
  }

  // ─── Badge UI ──────────────────────────────────────────────
  function setBadge(state) {
    const badge  = document.getElementById('sync-badge');
    const dot    = document.getElementById('sync-dot');
    const label  = document.getElementById('sync-label');
    const footer = document.getElementById('ft-save-label');
    if (!badge) return;
    badge.className = 'sync-status-badge ' + state;
    if (state === 'online')  { dot.className='sync-dot green'; label.textContent='🌐 Cloud Sync'; if(footer) footer.textContent='🌐 Đồng bộ cloud'; }
    if (state === 'offline') { dot.className='sync-dot red';   label.textContent='⚠️ Offline'; if(footer) footer.textContent='⚠️ Offline — đang dùng local'; }
    if (state === 'saving')  { dot.className='sync-dot yellow'; label.textContent='🔄 Đang lưu…'; }
    if (state === 'local')   { dot.className='sync-dot gray';  label.textContent='💾 LocalStorage'; if(footer) footer.textContent='💾 Lưu local — chưa đồng bộ cloud'; }
  }

  // ─── Data structures ───────────────────────────────────────
  function createDefaultData() {
    const d = { groups: {}, drawResult: null };
    GROUPS.forEach(g => { d.groups[g] = { teams: [], matches: [] }; });
    return d;
  }

  function rebuildMatches(newTeams, oldMatches) {
    const valid = newTeams.filter(t => t && t.trim());
    const scoreMap = {};
    (oldMatches || []).forEach(m => { scoreMap[m.team1 + '|' + m.team2] = { s1: m.score1, s2: m.score2 }; });
    const pairs = [];
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const key  = valid[i] + '|' + valid[j];
        const rkey = valid[j] + '|' + valid[i];
        const saved = scoreMap[key] || (scoreMap[rkey] ? { s1: scoreMap[rkey].s2, s2: scoreMap[rkey].s1 } : null);
        pairs.push({ team1: valid[i], team2: valid[j], score1: saved ? saved.s1 : null, score2: saved ? saved.s2 : null });
      }
    }
    return pairs;
  }

  let appData = createDefaultData();

  // ─── Standings ─────────────────────────────────────────────
  function calculateStandings(group) {
    const gd = appData.groups[group];
    if (!gd) return [];
    const stats = {};
    gd.teams.forEach(t => { if (t && t.trim()) stats[t] = { team:t, played:0, win:0, draw:0, lose:0, gf:0, ga:0, gd:0, pts:0 }; });
    (gd.matches || []).forEach(m => {
      const s1 = m.score1 == null ? null : Number(m.score1);
      const s2 = m.score2 == null ? null : Number(m.score2);
      if (s1 === null || s2 === null || isNaN(s1) || isNaN(s2)) return;
      if (!stats[m.team1] || !stats[m.team2]) return;
      stats[m.team1].played++; stats[m.team2].played++;
      stats[m.team1].gf += s1; stats[m.team1].ga += s2;
      stats[m.team2].gf += s2; stats[m.team2].ga += s1;
      if (s1 > s2) { stats[m.team1].win++; stats[m.team1].pts += 3; stats[m.team2].lose++; }
      else if (s1 < s2) { stats[m.team2].win++; stats[m.team2].pts += 3; stats[m.team1].lose++; }
      else { stats[m.team1].draw++; stats[m.team1].pts++; stats[m.team2].draw++; stats[m.team2].pts++; }
    });
    return Object.values(stats).map(s => ({...s, gd: s.gf - s.ga}))
      .sort((a,b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  }

  // ─── Page routing ──────────────────────────────────────────
  let currentResultsGroup = 'A', currentStandingsGroup = 'A';

  function showPage(pageId, group) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    const btn  = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (page) page.classList.add('active');
    if (btn)  btn.classList.add('active');
    if (pageId === 'home')      renderHome();
    if (pageId === 'setup')     renderSetup();
    if (pageId === 'draw')      renderDrawPage();
    if (pageId === 'results')   { if (group) currentResultsGroup = group; setActiveTab('results-tabs', currentResultsGroup); renderMatchesList(); }
    if (pageId === 'standings') { if (group) currentStandingsGroup = group; setActiveTab('standings-tabs', currentStandingsGroup); renderStandings(); }
  }

  function setActiveTab(id, group) {
    document.getElementById(id)?.querySelectorAll('.tab-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.group === group));
  }

  function getCurrentPageId() {
    const a = document.querySelector('.page.active');
    return a ? a.id.replace('page-', '') : 'home';
  }

  function rerenderCurrentPage() {
    const p = getCurrentPageId();
    if (p === 'home')           renderHome();
    else if (p === 'setup')     renderSetup();
    else if (p === 'results')   renderMatchesList();
    else if (p === 'standings') renderStandings();
    else if (p === 'draw')      renderDrawPage();
  }

  // ─── HOME ──────────────────────────────────────────────────
  function renderHome() {
    const grid = document.getElementById('home-groups-grid');
    if (!grid) return;
    grid.innerHTML = GROUPS.map(g => {
      const gd = appData.groups[g] || { teams: [] };
      const count = gd.teams.length;
      const matchCount = count >= 2 ? count * (count - 1) / 2 : 0;
      const items = count === 0
        ? `<div class="group-team-item team-empty"><span class="team-dot"></span>Chưa có đội nào</div>`
        : gd.teams.map(t => `<div class="group-team-item"><span class="team-dot"></span>${escHtml(t)}</div>`).join('');
      return `<article class="group-card" data-group="${g}">
        <div class="group-card-header">
          <div class="group-letter">${g}</div>
          <h3>Bảng ${g}</h3>
          <span class="group-meta">${count} đội · ${matchCount} trận</span>
        </div>
        <div class="group-card-teams">${items}</div>
        <div class="group-card-btns">
          <button class="btn btn-gold btn-sm" data-goto="standings" data-group="${g}">🏅 Xếp hạng</button>
          <button class="btn btn-ghost btn-sm" data-goto="results" data-group="${g}">📋 Kết quả</button>
        </div></article>`;
    }).join('');
    grid.querySelectorAll('[data-goto]').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); showPage(btn.dataset.goto, btn.dataset.group); }));
    grid.querySelectorAll('.group-card').forEach(card =>
      card.addEventListener('click', () => showPage('standings', card.dataset.group)));
  }

  // ─── SETUP ─────────────────────────────────────────────────
  function renderSetup() {
    const grid = document.getElementById('setup-grid');
    if (!grid) return;
    grid.innerHTML = GROUPS.map(g => {
      const gd = appData.groups[g] || { teams: [] };
      const teams = gd.teams.length ? [...gd.teams] : [];
      while (teams.length < 4) teams.push('');
      const rows = teams.map((name, idx) => buildTeamRow(g, idx, name, teams.length)).join('');
      const canAdd = teams.length < MAX_TEAMS;
      const valid = teams.filter(t => t && t.trim()).length;
      const matchCount = valid >= 2 ? valid * (valid - 1) / 2 : 0;
      return `<div class="setup-card" data-group="${g}">
        <div class="sc-header ${GROUP_COLORS[g]}">
          <span class="sc-letter">${g}</span>
          <span class="sc-title">Bảng ${g}</span>
          <span class="sc-match-count" id="sc-count-${g}">${matchCount > 0 ? matchCount + ' trận' : ''}</span>
          <span class="sc-ball">⚽</span>
        </div>
        <div class="sc-body" id="sc-body-${g}">${rows}</div>
        <div class="sc-footer">
          <button class="sc-add-btn${canAdd ? '' : ' disabled'}" data-group="${g}" id="sc-add-${g}" ${canAdd ? '' : 'disabled'}>
            + Thêm đội (${teams.length}/${MAX_TEAMS})
          </button>
          <span class="sc-hint">Vòng tròn: mỗi cặp đấu 1 lần</span>
        </div>
      </div>`;
    }).join('');
    document.querySelectorAll('.sc-add-btn').forEach(btn =>
      btn.addEventListener('click', () => addTeamSlot(btn.dataset.group)));
    document.querySelectorAll('.sc-remove-btn').forEach(btn =>
      btn.addEventListener('click', () => removeTeamSlot(btn.dataset.group, parseInt(btn.dataset.idx))));
    bindSetupInputs();
  }

  function buildTeamRow(g, idx, value, totalRows) {
    const canRemove = totalRows > 2;
    return `<div class="ti-row" id="ti-row-${g}-${idx}">
      <span class="ti-no">${idx + 1}</span>
      <input class="ti team-name-input" type="text" data-group="${g}" data-idx="${idx}"
        value="${escHtml(value)}" placeholder="Tên đội ${idx + 1}…" maxlength="30" autocomplete="off">
      ${canRemove
        ? `<button class="sc-remove-btn" data-group="${g}" data-idx="${idx}" title="Xóa đội này">✕</button>`
        : '<span class="sc-remove-placeholder"></span>'}
    </div>`;
  }

  function addTeamSlot(g) {
    const gd = appData.groups[g] || { teams: [], matches: [] };
    if (gd.teams.length >= MAX_TEAMS) return;
    gd.teams.push('');
    appData.groups[g] = gd;
    saveData(); renderSetup();
    const inputs = document.querySelectorAll(`.team-name-input[data-group="${g}"]`);
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function removeTeamSlot(g, idx) {
    const gd = appData.groups[g] || { teams: [], matches: [] };
    if (gd.teams.length <= MIN_TEAMS) return;
    gd.teams.splice(idx, 1);
    gd.matches = rebuildMatches(gd.teams, gd.matches);
    appData.groups[g] = gd;
    saveData(); renderSetup(); renderHome();
  }

  function bindSetupInputs() {
    document.querySelectorAll('.team-name-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const g = inp.dataset.group, idx = parseInt(inp.dataset.idx);
        if (!appData.groups[g]) appData.groups[g] = { teams: [], matches: [] };
        appData.groups[g].teams[idx] = inp.value.trim();
        updateMatchCountBadge(g);
        // Debounce: đợi 600ms sau lần gõ cuối mới gửi Firebase
        saveDataDebounced(600);
      });
    });
  }

  function updateMatchCountBadge(g) {
    const badge = document.getElementById(`sc-count-${g}`);
    if (!badge) return;
    const n = (appData.groups[g]?.teams || []).filter(t => t && t.trim()).length;
    badge.textContent = n >= 2 ? `${n*(n-1)/2} trận` : '';
  }

  function saveSetup() {
    GROUPS.forEach(g => {
      const inputs = document.querySelectorAll(`.team-name-input[data-group="${g}"]`);
      const names = Array.from(inputs).map(i => i.value.trim()).filter(n => n);
      if (!appData.groups[g]) appData.groups[g] = { teams: [], matches: [] };
      appData.groups[g].teams = names;
      appData.groups[g].matches = rebuildMatches(names, appData.groups[g].matches || []);
    });
    saveData(); renderHome();
    const toast = document.getElementById('setup-toast');
    if (toast) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3000); }
  }

  function resetSetup() {
    GROUPS.forEach(g => { appData.groups[g] = { teams: [], matches: [] }; });
    saveData(); renderSetup(); renderHome();
  }

  // ─── RESULTS ───────────────────────────────────────────────
  function renderMatchesList() {
    const group = currentResultsGroup;
    const container = document.getElementById('matches-list');
    if (!container) return;
    const gd = appData.groups[group];
    if (!gd || gd.teams.filter(t => t&&t.trim()).length < 2) {
      container.innerHTML = `<div class="matches-empty">
        <div class="me-icon">⚽</div>
        <div class="me-title">Chưa có đội nào trong Bảng ${group}</div>
        <div class="me-sub">Vào <strong>⚙️ Thiết lập</strong> để thêm đội trước</div>
      </div>`;
      return;
    }
    const matches = gd.matches || [];
    if (matches.length === 0) {
      container.innerHTML = `<div class="matches-empty">
        <div class="me-icon">📋</div>
        <div class="me-title">Lịch đấu chưa được tạo</div>
        <div class="me-sub">Nhấn <strong>💾 Lưu thiết lập</strong> để tạo lịch đấu vòng tròn</div>
      </div>`;
      return;
    }
    const rounds = buildRounds(gd.teams.filter(t => t&&t.trim()));
    let html = '';
    if (rounds.length > 1) {
      rounds.forEach((round, ri) => {
        html += `<div class="match-round-header">⚔️ Lượt ${ri + 1}</div>`;
        round.forEach(pair => {
          const mIdx = matches.findIndex(m =>
            (m.team1===pair[0]&&m.team2===pair[1]) || (m.team1===pair[1]&&m.team2===pair[0]));
          if (mIdx === -1) return;
          const m = matches[mIdx];
          html += matchRowHTML(mIdx, m, m.score1 != null ? m.score1 : '', m.score2 != null ? m.score2 : '');
        });
      });
    } else {
      matches.forEach((m, i) =>
        html += matchRowHTML(i, m, m.score1 != null ? m.score1 : '', m.score2 != null ? m.score2 : ''));
    }
    container.innerHTML = html;
    bindMatchInputs(group);
  }

  function matchRowHTML(idx, m, s1, s2) {
    return `<div class="match-row${s1!==''&&s2!==''?' has-result':''}" data-idx="${idx}">
      <span class="match-team">${escHtml(m.team1)}</span>
      <div class="match-inputs">
        <input type="number" min="0" step="1" value="${s1}" placeholder="—" data-score="1">
        <span class="score-dash">:</span>
        <input type="number" min="0" step="1" value="${s2}" placeholder="—" data-score="2">
      </div>
      <span class="match-team right">${escHtml(m.team2)}</span>
    </div>`;
  }

  function buildRounds(teams) {
    const n = teams.length;
    if (n < 2) return [];
    const list = [...teams];
    if (n % 2 !== 0) list.push('__BYE__');
    const total = list.length, rounds = [];
    for (let r = 0; r < total - 1; r++) {
      const round = [];
      for (let i = 0; i < total / 2; i++) {
        const t1 = list[i], t2 = list[total - 1 - i];
        if (t1 !== '__BYE__' && t2 !== '__BYE__') round.push([t1, t2]);
      }
      rounds.push(round);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }

  function bindMatchInputs(group) {
    const container = document.getElementById('matches-list');
    if (!container) return;
    container.querySelectorAll('.match-row').forEach(row => {
      const idx = parseInt(row.dataset.idx);
      const [in1, in2] = row.querySelectorAll('input');
      const update = () => {
        const v1 = in1.value.trim(), v2 = in2.value.trim();
        const m = appData.groups[group].matches[idx];
        if (!m) return;
        m.score1 = v1 === '' ? null : parseInt(v1, 10);
        m.score2 = v2 === '' ? null : parseInt(v2, 10);
        row.classList.toggle('has-result', v1 !== '' && v2 !== '');
        // Debounce khi nhập điểm số
        saveDataDebounced(400);
      };
      in1.addEventListener('input', update);
      in2.addEventListener('input', update);
    });
  }

  function resetGroup(group) {
    if (!appData.groups[group]) return;
    appData.groups[group].matches = rebuildMatches(appData.groups[group].teams, []);
    saveData(); renderMatchesList(); renderStandings();
  }

  // ─── STANDINGS ─────────────────────────────────────────────
  function renderStandings() {
    const group = currentStandingsGroup;
    const standings = calculateStandings(group);
    const tbody = document.getElementById('standings-body');
    if (!tbody) return;
    const gd = appData.groups[group];
    const teamCount = gd ? gd.teams.filter(t=>t&&t.trim()).length : 0;
    if (teamCount < 2) {
      tbody.innerHTML = `<tr><td colspan="10" class="std-empty">Bảng ${group} chưa có đủ đội — vào ⚙️ Thiết lập để thêm đội</td></tr>`;
      const advEl = document.getElementById('advancing-teams');
      if (advEl) advEl.innerHTML = '';
      return;
    }
    tbody.innerHTML = standings.map((row, i) => {
      const rank = i + 1;
      const rankClass = rank===1?'rank-1':rank===2?'rank-2':'';
      const badge = ['','r1','r2','r3','r4','r5','r6'][rank] || 'r6';
      const gds = row.gd >= 0 ? '+' + row.gd : '' + row.gd;
      const gdClass = row.gd > 0 ? 'gd-positive' : row.gd < 0 ? 'gd-negative' : '';
      const advIcon = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'⚽';
      return `<tr class="${rankClass}" style="animation:rowIn .4s ${i*.07}s both">
        <td><span class="rank-badge ${badge}">${rank}</span></td>
        <td><div class="team-cell"><div class="team-flag">${advIcon}</div><strong>${escHtml(row.team)}</strong></div></td>
        <td>${row.played}</td><td>${row.win}</td><td>${row.draw}</td><td>${row.lose}</td>
        <td>${row.gf}</td><td>${row.ga}</td>
        <td class="${gdClass}">${gds}</td>
        <td class="pts-cell">${row.pts}</td></tr>`;
    }).join('');
    if (!document.getElementById('row-anim-style')) {
      const s = document.createElement('style'); s.id = 'row-anim-style';
      s.textContent = '@keyframes rowIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}';
      document.head.appendChild(s);
    }
    const advEl = document.getElementById('advancing-teams');
    if (advEl) {
      const [f, s] = standings;
      advEl.innerHTML =
        (f ? `<div class="advance-card first" style="animation-delay:0s"><span class="advance-icon">🥇</span><div><div class="advance-label">NHẤT BẢNG</div><div class="advance-team">${escHtml(f.team)}</div></div></div>` : '') +
        (s ? `<div class="advance-card second" style="animation-delay:.12s"><span class="advance-icon">🥈</span><div><div class="advance-label">NHÌ BẢNG</div><div class="advance-team">${escHtml(s.team)}</div></div></div>` : '');
    }
  }

  // ─── DRAW / WHEEL ──────────────────────────────────────────
  let drawTeams = [], wheelSpinning = false, currentDrawGroup = 'A', wheelAngle = 0;

  const WHEEL_COLORS = [
    '#1253CC','#E0220A','#007A48','#FF9500',
    '#6040E0','#00A05C','#FF3085','#0099CC',
    '#B07800','#2ECC8B','#FF6B00','#5A9AFF',
    '#A0C030','#D44000','#8050D0','#00BFAE'
  ];

  function renderDrawPage() {
    if (appData.drawResult?.teams) drawTeams = [...appData.drawResult.teams];
    renderDrawTeamList(); renderDrawGroupSlots(); renderWheel(); updateGroupTabActive();
  }

  function renderDrawTeamList() {
    const c = document.getElementById('draw-team-list');
    const cnt = document.getElementById('draw-total-count');
    if (!c) return;
    if (cnt) cnt.textContent = drawTeams.length ? `${drawTeams.length} đội` : '';
    if (!drawTeams.length) {
      c.innerHTML = `<div class="draw-empty-hint">✏️ Nhập tên đội bên trên rồi nhấn <strong>+ Thêm</strong> để bắt đầu</div>`;
      return;
    }
    c.innerHTML = drawTeams.map((t, i) => `
      <div class="draw-team-chip">
        <span class="dtc-num">${i+1}</span>
        <span class="dtc-name">${escHtml(t.name)}</span>
        ${t.group
          ? `<span class="dtc-badge grp-${t.group}">Bảng ${t.group}</span>`
          : '<span class="dtc-badge dtc-pending">Chờ bốc</span>'}
        <button class="dtc-remove" data-idx="${i}" title="Xóa">✕</button>
      </div>`).join('');
    c.querySelectorAll('.dtc-remove').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        drawTeams.splice(parseInt(btn.dataset.idx), 1);
        persistDrawState(); renderDrawTeamList(); renderWheel(); renderDrawGroupSlots();
      }));
  }

  function renderDrawGroupSlots() {
    GROUPS.forEach(g => {
      const slot = document.getElementById(`draw-slots-${g}`);
      if (!slot) return;
      const inGroup = drawTeams.filter(t => t.group === g);
      slot.innerHTML = inGroup.length === 0
        ? `<span class="draw-slot-empty">— trống —</span>`
        : inGroup.map(t => `<span class="draw-slot-team">${escHtml(t.name)}</span>`).join('');
      const badge = document.querySelector(`.draw-group-box[data-group="${g}"] .dgb-count`);
      if (badge) { badge.textContent = `${inGroup.length} đội`; badge.className = `dgb-count${inGroup.length >= 2 ? ' has-teams' : ''}`; }
    });
  }

  function renderWheel() {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width, cx = size/2, cy = size/2, r = size/2 - 6;
    ctx.clearRect(0, 0, size, size);
    const unassigned = drawTeams.filter(t => !t.group);
    if (!unassigned.length) {
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.fillStyle='#0A1A3A'; ctx.fill();
      ctx.strokeStyle='rgba(255,190,0,.5)'; ctx.lineWidth=4; ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.4)';
      ctx.font='bold 14px Barlow Condensed,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(drawTeams.length===0 ? 'Thêm đội để bắt đầu' : 'Tất cả đã phân bảng! 🎉', cx, cy);
      return;
    }
    const n = unassigned.length, slice = (Math.PI*2)/n;
    const gr = ctx.createRadialGradient(cx,cy,r-8,cx,cy,r+4);
    gr.addColorStop(0,'rgba(255,190,0,0)'); gr.addColorStop(1,'rgba(255,190,0,.3)');
    ctx.beginPath(); ctx.arc(cx,cy,r+4,0,Math.PI*2); ctx.fillStyle=gr; ctx.fill();
    unassigned.forEach((team, i) => {
      const start = i*slice+wheelAngle, end = start+slice;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,start,end); ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length]; ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.2)'; ctx.lineWidth=2; ctx.stroke();
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(start+slice/2);
      const fs = n>12?10:n>8?12:14, maxLen = n>10?8:12;
      const lbl = team.name.length>maxLen ? team.name.substring(0,maxLen)+'…' : team.name;
      ctx.font=`bold ${fs}px Barlow Condensed,sans-serif`;
      ctx.textAlign='right'; ctx.textBaseline='middle';
      ctx.fillStyle='#fff'; ctx.shadowColor='rgba(0,0,0,.6)'; ctx.shadowBlur=4;
      ctx.fillText(lbl, r*.85, 0); ctx.restore();
    });
    ctx.beginPath(); ctx.arc(cx,cy,24,0,Math.PI*2);
    const hg = ctx.createRadialGradient(cx,cy,0,cx,cy,24);
    hg.addColorStop(0,'#1E3070'); hg.addColorStop(1,'#0A1428');
    ctx.fillStyle=hg; ctx.fill();
    ctx.strokeStyle='rgba(255,190,0,.9)'; ctx.lineWidth=3;
    ctx.shadowBlur=8; ctx.shadowColor='rgba(255,190,0,.6)'; ctx.stroke(); ctx.shadowBlur=0;
    ctx.font='20px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('⚽',cx,cy);
  }

  function spinWheel() {
    if (wheelSpinning) return;
    const unassigned = drawTeams.filter(t => !t.group);
    if (!unassigned.length) { alert('Tất cả đội đã được phân bảng!'); return; }
    wheelSpinning = true;
    const spinBtn = document.getElementById('btn-spin');
    if (spinBtn) spinBtn.classList.add('spinning');
    const winnerIdx = Math.floor(Math.random() * unassigned.length);
    const n = unassigned.length, slice = (Math.PI*2)/n;
    const targetCenter = winnerIdx*slice + slice/2;
    const targetFinal = -Math.PI/2 - targetCenter;
    const curNorm = ((wheelAngle%(Math.PI*2))+(Math.PI*2))%(Math.PI*2);
    const tgtNorm = ((targetFinal%(Math.PI*2))+(Math.PI*2))%(Math.PI*2);
    let delta = tgtNorm - curNorm; if (delta<=0) delta += Math.PI*2;
    const totalRot = (5+Math.floor(Math.random()*4))*Math.PI*2 + delta;
    const startAngle = wheelAngle, dur = 4500+Math.random()*1500, startTime = performance.now();
    function ease(t) { return 1 - Math.pow(1-t, 4); }
    function animate(now) {
      const t = Math.min((now-startTime)/dur, 1);
      wheelAngle = startAngle + totalRot*ease(t);
      renderWheel();
      if (t < 1) { requestAnimationFrame(animate); return; }
      wheelSpinning = false;
      if (spinBtn) spinBtn.classList.remove('spinning');
      const winner = unassigned[winnerIdx];
      const found = drawTeams.find(x => x.name===winner.name && !x.group);
      if (found) found.group = currentDrawGroup;
      persistDrawState(); renderDrawTeamList(); renderDrawGroupSlots(); renderWheel();
      showSpinResult(winner.name, currentDrawGroup);
    }
    requestAnimationFrame(animate);
  }

  function showSpinResult(name, group) {
    const overlay = document.getElementById('spin-result-overlay');
    if (!overlay) return;
    document.getElementById('spin-result-name').textContent = name;
    document.getElementById('spin-result-group').textContent = `Bảng ${group}`;
    overlay.classList.add('visible'); spawnConfetti();
    setTimeout(() => overlay.classList.remove('visible'), 3800);
  }

  function updateGroupTabActive() {
    document.querySelectorAll('.draw-group-tab')
      .forEach(btn => btn.classList.toggle('active', btn.dataset.group === currentDrawGroup));
  }

  function persistDrawState() {
    appData.drawResult = { teams: [...drawTeams] };
    saveData();
  }

  function commitDrawToGroups() {
    const anyFilled = GROUPS.some(g => drawTeams.filter(t => t.group === g).length > 0);
    if (!anyFilled) { alert('Chưa có đội nào được phân bảng. Hãy quay bánh xe trước!'); return; }
    const single = GROUPS.filter(g => drawTeams.filter(t => t.group === g).length === 1);
    if (single.length > 0 && !confirm('Bảng ' + single.join(', ') + ' chỉ có 1 đội — cần ít nhất 2 đội.\nTiếp tục sẽ bỏ qua. Tiếp tục?')) return;
    const unassigned = drawTeams.filter(t => !t.group);
    if (unassigned.length > 0 && !confirm('Còn ' + unassigned.length + ' đội chưa phân bảng: ' + unassigned.map(t=>t.name).join(', ') + '.\nTiếp tục?')) return;
    const summary = GROUPS.map(g => {
      const cnt = drawTeams.filter(t => t.group===g).length;
      return cnt >= 2 ? `Bảng ${g}: ${cnt} đội → ${cnt*(cnt-1)/2} trận` : null;
    }).filter(Boolean).join('\n');
    if (!confirm('Áp dụng kết quả bốc thăm:\n\n' + summary + '\n\nXác nhận?')) return;
    GROUPS.forEach(g => {
      const names = drawTeams.filter(t => t.group===g).map(t => t.name);
      if (!appData.groups[g]) appData.groups[g] = { teams: [], matches: [] };
      appData.groups[g].teams = names.length >= 2 ? names : (names.length===1 ? names : []);
      appData.groups[g].matches = names.length >= 2 ? rebuildMatches(names, appData.groups[g].matches || []) : [];
    });
    saveData(); renderHome();
    const toast = document.getElementById('draw-toast');
    if (toast) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3500); }
  }

  function resetDrawPage() {
    if (!confirm('Xóa toàn bộ danh sách đội và kết quả bốc thăm?')) return;
    drawTeams = []; currentDrawGroup = 'A'; wheelAngle = 0;
    appData.drawResult = null; saveData(); renderDrawPage();
  }

  // ─── UI helpers ────────────────────────────────────────────
  let siTimer = null;
  function showSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return; el.classList.remove('hidden'); clearTimeout(siTimer);
    siTimer = setTimeout(() => el.classList.add('hidden'), 2000);
  }

  let rutTimer = null;
  function showRemoteUpdateToast() {
    const el = document.getElementById('remote-update-toast');
    if (!el) return; el.classList.remove('hidden'); clearTimeout(rutTimer);
    rutTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function spawnConfetti() {
    const c = document.getElementById('confetti'); if (!c) return;
    const colors = ['#FFD700','#FFBE00','#00FF87','#00D4FF','#FF3085','#1E6AFF','#FF6B00','#fff'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('div'); p.className = 'confetti-piece';
      p.style.cssText = `left:${Math.random()*100}%;width:${5+Math.random()*9}px;height:${5+Math.random()*9}px;background:${colors[~~(Math.random()*colors.length)]};animation-duration:${2.2+Math.random()*3}s;animation-delay:${Math.random()*1.5}s;border-radius:${Math.random()>.5?'50%':'3px'}`;
      c.appendChild(p); setTimeout(() => p.remove(), 5500);
    }
  }

  function initParticles() {
    const c = document.getElementById('particles'); if (!c) return;
    const cols = ['rgba(18,83,204,.25)','rgba(0,160,92,.22)','rgba(255,149,0,.20)','rgba(0,212,255,.18)'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('div'); p.className = 'particle';
      const s = 3+Math.random()*5;
      p.style.cssText = `left:${Math.random()*100}%;width:${s}px;height:${s}px;background:${cols[~~(Math.random()*cols.length)]};animation-duration:${14+Math.random()*18}s;animation-delay:${-Math.random()*20}s`;
      c.appendChild(p);
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── EVENTS ────────────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => showPage(btn.dataset.page)));
  document.querySelectorAll('[data-page]').forEach(btn => {
    if (!btn.classList.contains('nav-btn'))
      btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  document.getElementById('results-tabs')?.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => { currentResultsGroup=btn.dataset.group; setActiveTab('results-tabs',currentResultsGroup); renderMatchesList(); }));
  document.getElementById('standings-tabs')?.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => { currentStandingsGroup=btn.dataset.group; setActiveTab('standings-tabs',currentStandingsGroup); renderStandings(); }));

  document.getElementById('btn-save-setup')?.addEventListener('click', saveSetup);
  document.getElementById('btn-reset-setup')?.addEventListener('click', () => { if (confirm('Xóa tất cả đội và lịch đấu?')) resetSetup(); });

  // await saveData() trước khi chuyển trang để đảm bảo đã ghi Firebase xong
  document.getElementById('btn-save-results')?.addEventListener('click', async () => {
    await saveData();
    spawnConfetti();
    currentStandingsGroup = currentResultsGroup;
    showPage('standings', currentResultsGroup);
  });

  document.getElementById('btn-reset-group')?.addEventListener('click', () => { if (confirm('Reset kết quả Bảng '+currentResultsGroup+'?')) resetGroup(currentResultsGroup); });
  document.getElementById('btn-reset-standings')?.addEventListener('click', () => { if (confirm('Reset kết quả Bảng '+currentStandingsGroup+'?')) resetGroup(currentStandingsGroup); });

  document.getElementById('btn-draw-add')?.addEventListener('click', () => {
    const inp = document.getElementById('draw-team-input'); if (!inp) return;
    const name = inp.value.trim();
    if (!name) { inp.focus(); inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),400); return; }
    if (drawTeams.find(t => t.name.toLowerCase()===name.toLowerCase())) { alert('Đội này đã có!'); return; }
    drawTeams.push({name, group:null}); inp.value=''; inp.focus();
    persistDrawState(); renderDrawTeamList(); renderWheel(); renderDrawGroupSlots();
  });
  document.getElementById('draw-team-input')?.addEventListener('keydown', e => {
    if (e.key==='Enter') document.getElementById('btn-draw-add')?.click();
  });
  document.getElementById('btn-spin')?.addEventListener('click', spinWheel);
  document.getElementById('btn-commit-draw')?.addEventListener('click', commitDrawToGroups);
  document.getElementById('btn-reset-draw')?.addEventListener('click', resetDrawPage);
  document.querySelectorAll('.draw-group-tab').forEach(btn =>
    btn.addEventListener('click', () => { currentDrawGroup=btn.dataset.group; updateGroupTabActive(); }));

  document.getElementById('fb-howto-btn')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('howto-modal')?.classList.remove('hidden');
  });
  document.getElementById('fb-banner-close')?.addEventListener('click', () => {
    document.getElementById('firebase-setup-banner')?.classList.add('hidden');
  });
  document.getElementById('modal-close-btn')?.addEventListener('click', () => {
    document.getElementById('howto-modal')?.classList.add('hidden');
  });
  document.getElementById('howto-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  // ─── INIT ──────────────────────────────────────────────────
  async function init() {
    initParticles();

    if (!useFirebase) {
      const banner = document.getElementById('firebase-setup-banner');
      if (banner) banner.classList.remove('hidden');
      setBadge('local');
    }

    appData = await loadData();
    if (appData.drawResult?.teams) drawTeams = [...appData.drawResult.teams];
    showPage('home');

    if (useFirebase) {
      // Khởi động Firebase SSE — lắng nghe thay đổi real-time
      // Tất cả trình duyệt sẽ nhận cập nhật ngay lập tức khi có thay đổi
      startFirebaseStream();
    }
  }

  init();
})();
