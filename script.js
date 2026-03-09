(function () {
  'use strict';

  const STORAGE_KEY = 'fcm_v5_data';
  const GROUPS = ['A', 'B', 'C', 'D'];
  const PLACEHOLDER_NAMES = {
    A: ['Đội A1', 'Đội A2', 'Đội A3', 'Đội A4'],
    B: ['Đội B1', 'Đội B2', 'Đội B3', 'Đội B4'],
    C: ['Đội C1', 'Đội C2', 'Đội C3', 'Đội C4'],
    D: ['Đội D1', 'Đội D2', 'Đội D3', 'Đội D4'],
  };

  // ═══════════════════════════════════════════
  //  BULLETPROOF MULTI-LAYER STORAGE
  //  Layer 1: localStorage (primary, persistent)
  //  Layer 2: sessionStorage (tab backup)
  //  Layer 3: window global (memory fallback)
  //  + Save on tab hide / page unload
  // ═══════════════════════════════════════════
  function writeAll(dataStr) {
    try { localStorage.setItem(STORAGE_KEY, dataStr); } catch(e) { console.warn('localStorage failed', e); }
    try { sessionStorage.setItem(STORAGE_KEY, dataStr); } catch(e) {}
    try { window['__fcm_backup__'] = dataStr; } catch(e) {}
  }

  function readAll() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch(e) {}
    if (!raw) { try { raw = sessionStorage.getItem(STORAGE_KEY); } catch(e) {} }
    if (!raw) { try { raw = window['__fcm_backup__'] || null; } catch(e) {} }
    return raw;
  }

  function createDefaultData() {
    const data = { teamNames: {}, matches: {}, drawResult: null };
    GROUPS.forEach(g => {
      data.teamNames[g] = ['', '', '', ''];
      data.matches[g] = generateMatches(PLACEHOLDER_NAMES[g]);
    });
    return data;
  }

  function generateMatches(teams) {
    const pairs = [];
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++)
        pairs.push({ team1: teams[i], team2: teams[j], score1: null, score2: null });
    return pairs;
  }

  function loadData() {
    try {
      const raw = readAll();
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.teamNames && p.matches) {
          if (!p.drawResult) p.drawResult = null;
          return p;
        }
      }
    } catch (e) { console.warn('Load failed', e); }
    return createDefaultData();
  }

  let saveTimeout = null;
  function saveData(immediate) {
    const serialized = JSON.stringify(appData);
    if (immediate) { writeAll(serialized); showSaveIndicator(); return; }
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => { writeAll(JSON.stringify(appData)); showSaveIndicator(); }, 300);
  }

  // Save on tab hide / close
  window.addEventListener('beforeunload', () => { try { writeAll(JSON.stringify(appData)); } catch(e) {} });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') try { writeAll(JSON.stringify(appData)); } catch(e) {}
  });

  let appData = loadData();

  // ═══════════════════════════════════════════
  //  STANDINGS CALCULATION
  // ═══════════════════════════════════════════
  function calculateStandings(group) {
    const teams = appData.teamNames[group];
    const stats = {};
    teams.forEach(t => { if (t && t.trim()) stats[t] = { team: t, played:0, win:0, draw:0, lose:0, gf:0, ga:0, gd:0, pts:0 }; });
    (appData.matches[group] || []).forEach(m => {
      const s1 = m.score1 == null ? null : Number(m.score1);
      const s2 = m.score2 == null ? null : Number(m.score2);
      if (s1 === null || s2 === null || isNaN(s1) || isNaN(s2) || !stats[m.team1] || !stats[m.team2]) return;
      stats[m.team1].played++; stats[m.team2].played++;
      stats[m.team1].gf += s1; stats[m.team1].ga += s2;
      stats[m.team2].gf += s2; stats[m.team2].ga += s1;
      if (s1 > s2) { stats[m.team1].win++; stats[m.team1].pts += 3; stats[m.team2].lose++; }
      else if (s1 < s2) { stats[m.team2].win++; stats[m.team2].pts += 3; stats[m.team1].lose++; }
      else { stats[m.team1].draw++; stats[m.team1].pts++; stats[m.team2].draw++; stats[m.team2].pts++; }
    });
    return Object.values(stats).map(s => ({ ...s, gd: s.gf - s.ga })).sort((a,b) => b.pts-a.pts || b.gd-a.gd || b.gf-a.gf);
  }

  // ═══════════════════════════════════════════
  //  PAGE ROUTING
  // ═══════════════════════════════════════════
  let currentResultsGroup = 'A', currentStandingsGroup = 'A';

  function showPage(pageId, group) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    const btn = document.querySelector('.nav-btn[data-page="' + pageId + '"]');
    if (page) page.classList.add('active');
    if (btn) btn.classList.add('active');
    if (pageId === 'home') renderHome();
    if (pageId === 'setup') renderSetup();
    if (pageId === 'draw') renderDrawPage();
    if (pageId === 'results') { if (group) currentResultsGroup = group; setActiveTab('results-tabs', currentResultsGroup); renderMatchesList(); }
    if (pageId === 'standings') { if (group) currentStandingsGroup = group; setActiveTab('standings-tabs', currentStandingsGroup); renderStandings(); }
  }

  function setActiveTab(id, group) {
    document.getElementById(id)?.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.group === group));
  }

  // ═══════════════════════════════════════════
  //  HOME
  // ═══════════════════════════════════════════
  function renderHome() {
    const grid = document.getElementById('home-groups-grid');
    if (!grid) return;
    grid.innerHTML = GROUPS.map(g => {
      const teams = appData.teamNames[g] || ['','','',''];
      const items = teams.map((t,i) => {
        const label = t && t.trim() ? t : PLACEHOLDER_NAMES[g][i];
        const isEmpty = !t || !t.trim();
        return `<div class="group-team-item${isEmpty?' team-empty':''}"><span class="team-dot"></span>${escHtml(label)}</div>`;
      }).join('');
      return `<article class="group-card" data-group="${g}">
        <div class="group-card-header"><div class="group-letter">${g}</div><h3>Bảng ${g}</h3></div>
        <div class="group-card-teams">${items}</div>
        <div class="group-card-btns">
          <button class="btn btn-gold btn-sm" data-goto="standings" data-group="${g}">🏅 Xếp hạng</button>
          <button class="btn btn-ghost btn-sm" data-goto="results" data-group="${g}">📋 Kết quả</button>
        </div></article>`;
    }).join('');
    grid.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); showPage(btn.dataset.goto, btn.dataset.group); }));
    grid.querySelectorAll('.group-card').forEach(card => card.addEventListener('click', () => showPage('standings', card.dataset.group)));
  }

  // ═══════════════════════════════════════════
  //  SETUP
  // ═══════════════════════════════════════════
  function renderSetup() {
    GROUPS.forEach(g => {
      (appData.teamNames[g] || ['','','','']).forEach((name, idx) => {
        const inp = document.querySelector(`.team-name-input[data-group="${g}"][data-idx="${idx}"]`);
        if (inp) inp.value = name || '';
      });
    });
  }

  function saveSetup() {
    GROUPS.forEach(g => {
      const newNames = Array.from({length:4}, (_,idx) => {
        const inp = document.querySelector(`.team-name-input[data-group="${g}"][data-idx="${idx}"]`);
        return inp ? inp.value.trim() : '';
      });
      const resolved = newNames.map((n,i) => n || PLACEHOLDER_NAMES[g][i]);
      const oldMatches = appData.matches[g] || [];
      const newMatches = [];
      let pos = 0;
      for (let i = 0; i < 4; i++) for (let j = i+1; j < 4; j++) {
        const old = oldMatches[pos] || {};
        newMatches.push({ team1: resolved[i], team2: resolved[j], score1: old.score1??null, score2: old.score2??null });
        pos++;
      }
      appData.teamNames[g] = newNames;
      appData.matches[g] = newMatches;
    });
    saveData(true); renderHome();
    const toast = document.getElementById('setup-toast');
    if (toast) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 2800); }
  }

  function setupAutoSave() {
    document.querySelectorAll('.team-name-input').forEach(inp => inp.addEventListener('input', () => {
      const g = inp.dataset.group, idx = parseInt(inp.dataset.idx);
      if (appData.teamNames[g]) appData.teamNames[g][idx] = inp.value.trim();
      saveData();
    }));
  }

  function resetSetup() {
    GROUPS.forEach(g => {
      appData.teamNames[g] = ['','','',''];
      appData.matches[g] = generateMatches(PLACEHOLDER_NAMES[g]);
      for (let idx=0; idx<4; idx++) {
        const inp = document.querySelector(`.team-name-input[data-group="${g}"][data-idx="${idx}"]`);
        if (inp) inp.value = '';
      }
    });
    saveData(true);
  }

  // ═══════════════════════════════════════════
  //  DRAW PAGE — WHEEL OF FORTUNE
  // ═══════════════════════════════════════════
  let drawTeams = [];
  let wheelSpinning = false;
  let currentDrawGroup = 'A';
  let wheelAngle = 0;

  function renderDrawPage() {
    if (appData.drawResult && appData.drawResult.teams) drawTeams = [...appData.drawResult.teams];
    renderDrawTeamList();
    renderDrawGroupSlots();
    renderWheel();
    updateGroupTabActive();
  }

  function renderDrawTeamList() {
    const container = document.getElementById('draw-team-list');
    if (!container) return;
    if (drawTeams.length === 0) {
      container.innerHTML = `<div class="draw-empty-hint">✏️ Nhập tên đội bên trên rồi nhấn <strong>+ Thêm</strong> để bắt đầu</div>`;
      return;
    }
    container.innerHTML = drawTeams.map((t, i) => `
      <div class="draw-team-chip">
        <span class="dtc-num">${i+1}</span>
        <span class="dtc-name">${escHtml(t.name)}</span>
        ${t.group ? `<span class="dtc-badge grp-${t.group}">Bảng ${t.group}</span>` : '<span class="dtc-badge dtc-pending">Chờ bốc</span>'}
        <button class="dtc-remove" data-idx="${i}" title="Xóa">✕</button>
      </div>`).join('');
    container.querySelectorAll('.dtc-remove').forEach(btn => btn.addEventListener('click', e => {
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
      if (badge) {
        badge.textContent = `${inGroup.length}/4`;
        badge.className = `dgb-count ${inGroup.length >= 4 ? 'full' : ''}`;
      }
    });
  }

  const WHEEL_COLORS = [
    '#1253CC','#E0220A','#007A48','#FF9500',
    '#6040E0','#00A05C','#FF3085','#0099CC',
    '#B07800','#2ECC8B','#FF6B00','#5A9AFF',
    '#A0C030','#D44000','#8050D0','#00BFAE',
  ];

  function renderWheel() {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width, cx = size/2, cy = size/2, r = size/2 - 6;
    ctx.clearRect(0, 0, size, size);

    const unassigned = drawTeams.filter(t => !t.group);

    if (unassigned.length === 0) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = '#0A1A3A'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,0,.5)'; ctx.lineWidth = 4; ctx.stroke();
      // Decorative ring
      ctx.beginPath(); ctx.arc(cx, cy, r-12, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,190,0,.15)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.font = 'bold 14px Barlow Condensed, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const msg = drawTeams.length === 0 ? 'Thêm đội để bắt đầu' : 'Tất cả đã phân bảng! 🎉';
      ctx.fillText(msg, cx, cy);
      return;
    }

    const n = unassigned.length;
    const slice = (Math.PI*2) / n;

    // Outer glow ring
    const grad = ctx.createRadialGradient(cx,cy,r-8,cx,cy,r+4);
    grad.addColorStop(0,'rgba(255,190,0,.0)');
    grad.addColorStop(1,'rgba(255,190,0,.3)');
    ctx.beginPath(); ctx.arc(cx,cy,r+4,0,Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();

    unassigned.forEach((team, i) => {
      const start = i * slice + wheelAngle;
      const end = start + slice;
      // Slice
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,start,end); ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length]; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 2; ctx.stroke();
      // Text
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(start + slice/2);
      const fs = n > 12 ? 10 : n > 8 ? 12 : 14;
      const maxLen = n > 10 ? 8 : 12;
      const label = team.name.length > maxLen ? team.name.substring(0,maxLen)+'…' : team.name;
      ctx.font = `bold ${fs}px Barlow Condensed, sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
      ctx.fillText(label, r*0.85, 0); ctx.restore();
    });

    // Center hub
    ctx.beginPath(); ctx.arc(cx,cy,24,0,Math.PI*2);
    const hubGrad = ctx.createRadialGradient(cx,cy,0,cx,cy,24);
    hubGrad.addColorStop(0,'#1E3070'); hubGrad.addColorStop(1,'#0A1428');
    ctx.fillStyle = hubGrad; ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,0,.9)'; ctx.lineWidth = 3; ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(255,190,0,.6)'; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⚽', cx, cy);
  }

  function spinWheel() {
    if (wheelSpinning) return;
    const unassigned = drawTeams.filter(t => !t.group);
    if (unassigned.length === 0) { alert('Tất cả đội đã được phân bảng!'); return; }
    const inCurrent = drawTeams.filter(t => t.group === currentDrawGroup);
    if (inCurrent.length >= 4) { alert(`Bảng ${currentDrawGroup} đã đủ 4 đội! Hãy chọn bảng khác.`); return; }

    wheelSpinning = true;
    const spinBtn = document.getElementById('btn-spin');
    if (spinBtn) spinBtn.classList.add('spinning');

    const winnerIdx = Math.floor(Math.random() * unassigned.length);
    const n = unassigned.length;
    const slice = (Math.PI*2) / n;
    // Pointer is at top (-π/2); calculate where winner slice center should be
    const targetCenter = winnerIdx * slice + slice/2;
    // We need wheelAngle + targetCenter ≡ -π/2 (mod 2π)
    const targetFinal = -Math.PI/2 - targetCenter;
    const currentNorm = ((wheelAngle % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
    const targetNorm = ((targetFinal % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
    let delta = targetNorm - currentNorm;
    if (delta <= 0) delta += Math.PI*2;
    const totalRotation = (5 + Math.floor(Math.random()*4)) * Math.PI*2 + delta;

    const startAngle = wheelAngle;
    const duration = 4500 + Math.random()*1500;
    const startTime = performance.now();

    function easeOut(t) { return 1 - Math.pow(1-t, 4); }

    function animate(now) {
      const t = Math.min((now - startTime) / duration, 1);
      wheelAngle = startAngle + totalRotation * easeOut(t);
      renderWheel();
      if (t < 1) { requestAnimationFrame(animate); return; }
      // Done
      wheelSpinning = false;
      if (spinBtn) spinBtn.classList.remove('spinning');
      const winner = unassigned[winnerIdx];
      const found = drawTeams.find(x => x.name === winner.name && !x.group);
      if (found) found.group = currentDrawGroup;
      persistDrawState(); renderDrawTeamList(); renderDrawGroupSlots(); renderWheel();
      showSpinResult(winner.name, currentDrawGroup);
      // Auto-advance to next group needing teams
      const remaining = drawTeams.filter(t => !t.group);
      if (remaining.length > 0) {
        for (const g of GROUPS) {
          if (drawTeams.filter(t => t.group === g).length < 4) { currentDrawGroup = g; break; }
        }
        updateGroupTabActive();
      }
    }
    requestAnimationFrame(animate);
  }

  function showSpinResult(name, group) {
    const overlay = document.getElementById('spin-result-overlay');
    const nameEl = document.getElementById('spin-result-name');
    const groupEl = document.getElementById('spin-result-group');
    if (!overlay) return;
    if (nameEl) nameEl.textContent = name;
    if (groupEl) groupEl.textContent = `Bảng ${group}`;
    overlay.classList.add('visible');
    spawnConfetti();
    setTimeout(() => overlay.classList.remove('visible'), 3800);
  }

  function updateGroupTabActive() {
    document.querySelectorAll('.draw-group-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.group === currentDrawGroup));
  }

  function persistDrawState() {
    appData.drawResult = { teams: [...drawTeams] };
    saveData(true);
  }

  function commitDrawToGroups() {
    const allFilled = GROUPS.every(g => drawTeams.filter(t => t.group === g).length === 4);
    if (!allFilled && !confirm('Chưa đủ 16 đội (4 bảng × 4 đội). Áp dụng kết quả hiện tại?')) return;
    GROUPS.forEach(g => {
      const names = drawTeams.filter(t => t.group === g).map(t => t.name);
      while (names.length < 4) names.push('');
      appData.teamNames[g] = names.slice(0,4);
      const resolved = names.slice(0,4).map((n,i) => n || PLACEHOLDER_NAMES[g][i]);
      appData.matches[g] = generateMatches(resolved);
    });
    saveData(true); renderHome();
    const toast = document.getElementById('draw-toast');
    if (toast) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3500); }
  }

  function resetDrawPage() {
    if (!confirm('Xóa toàn bộ danh sách đội và kết quả bốc thăm?')) return;
    drawTeams = []; currentDrawGroup = 'A'; wheelAngle = 0;
    appData.drawResult = null; saveData(true); renderDrawPage();
  }

  // ═══════════════════════════════════════════
  //  RESULTS
  // ═══════════════════════════════════════════
  function renderMatchesList() {
    const group = currentResultsGroup;
    const container = document.getElementById('matches-list');
    if (!container) return;
    container.innerHTML = (appData.matches[group] || []).map((m, i) => {
      const s1 = m.score1 != null ? m.score1 : '', s2 = m.score2 != null ? m.score2 : '';
      return `<div class="match-row${s1!==''&&s2!==''?' has-result':''}" data-idx="${i}">
        <span class="match-team">${escHtml(m.team1)}</span>
        <div class="match-inputs">
          <input type="number" min="0" step="1" value="${s1}" placeholder="—" data-score="1">
          <span class="score-dash">:</span>
          <input type="number" min="0" step="1" value="${s2}" placeholder="—" data-score="2">
        </div>
        <span class="match-team right">${escHtml(m.team2)}</span>
      </div>`;
    }).join('');
    container.querySelectorAll('.match-row').forEach(row => {
      const idx = parseInt(row.dataset.idx);
      const [in1, in2] = row.querySelectorAll('input');
      const update = () => {
        const v1 = in1.value.trim(), v2 = in2.value.trim();
        const m = appData.matches[group][idx];
        m.score1 = v1===''?null:parseInt(v1,10); m.score2 = v2===''?null:parseInt(v2,10);
        row.classList.toggle('has-result', v1!==''&&v2!=='');
        saveData();
      };
      in1.addEventListener('input', update); in2.addEventListener('input', update);
    });
  }

  function resetGroup(group) {
    const teams = (appData.teamNames[group] || []).map((n,i) => n&&n.trim()?n:PLACEHOLDER_NAMES[group][i]);
    appData.matches[group] = generateMatches(teams);
    saveData(true); renderMatchesList(); renderStandings();
  }

  // ═══════════════════════════════════════════
  //  STANDINGS
  // ═══════════════════════════════════════════
  function renderStandings() {
    const group = currentStandingsGroup;
    const standings = calculateStandings(group);
    const tbody = document.getElementById('standings-body');
    if (!tbody) return;
    tbody.innerHTML = standings.map((row,i) => {
      const rank=i+1, rankClass=rank===1?'rank-1':rank===2?'rank-2':'';
      const badge=['','r1','r2','r3','r4'][rank]||'r4';
      const gd=row.gd>=0?'+'+row.gd:''+row.gd;
      const gdClass=row.gd>0?'gd-positive':row.gd<0?'gd-negative':'';
      return `<tr class="${rankClass}" style="animation:rowIn .4s ${i*.07}s both">
        <td><span class="rank-badge ${badge}">${rank}</span></td>
        <td><div class="team-cell"><div class="team-flag">${rank<=2?(rank===1?'🥇':'🥈'):'⚽'}</div><strong>${escHtml(row.team)}</strong></div></td>
        <td>${row.played}</td><td>${row.win}</td><td>${row.draw}</td><td>${row.lose}</td>
        <td>${row.gf}</td><td>${row.ga}</td><td class="${gdClass}">${gd}</td>
        <td class="pts-cell">${row.pts}</td></tr>`;
    }).join('');
    if (!document.getElementById('row-anim-style')) {
      const s=document.createElement('style'); s.id='row-anim-style';
      s.textContent='@keyframes rowIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}';
      document.head.appendChild(s);
    }
    const advEl = document.getElementById('advancing-teams');
    if (advEl) {
      const [f,s] = standings;
      advEl.innerHTML=(f?`<div class="advance-card first" style="animation-delay:0s"><span class="advance-icon">🥇</span><div><div class="advance-label">NHẤT BẢNG</div><div class="advance-team">${escHtml(f.team)}</div></div></div>`:'')+
        (s?`<div class="advance-card second" style="animation-delay:.12s"><span class="advance-icon">🥈</span><div><div class="advance-label">NHÌ BẢNG</div><div class="advance-team">${escHtml(s.team)}</div></div></div>`:'');
    }
  }

  // ═══════════════════════════════════════════
  //  SAVE INDICATOR
  // ═══════════════════════════════════════════
  let siTimer = null;
  function showSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.remove('hidden'); clearTimeout(siTimer);
    siTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // ═══════════════════════════════════════════
  //  CONFETTI
  // ═══════════════════════════════════════════
  function spawnConfetti() {
    const c = document.getElementById('confetti'); if (!c) return;
    const colors=['#FFD700','#FFBE00','#00FF87','#00D4FF','#FF3085','#1E6AFF','#FF6B00','#fff'];
    for (let i=0;i<70;i++) {
      const p=document.createElement('div'); p.className='confetti-piece';
      p.style.cssText=`left:${Math.random()*100}%;width:${5+Math.random()*9}px;height:${5+Math.random()*9}px;background:${colors[~~(Math.random()*colors.length)]};animation-duration:${2.2+Math.random()*3}s;animation-delay:${Math.random()*1.5}s;border-radius:${Math.random()>.5?'50%':'3px'}`;
      c.appendChild(p); setTimeout(()=>p.remove(),5500);
    }
  }

  function initParticles() {
    const c=document.getElementById('particles'); if (!c) return;
    const colors=['rgba(18,83,204,.25)','rgba(0,160,92,.22)','rgba(255,149,0,.20)','rgba(0,212,255,.18)'];
    for (let i=0;i<18;i++) {
      const p=document.createElement('div'); p.className='particle';
      const size=3+Math.random()*5;
      p.style.cssText=`left:${Math.random()*100}%;width:${size}px;height:${size}px;background:${colors[~~(Math.random()*colors.length)]};animation-duration:${14+Math.random()*18}s;animation-delay:${-Math.random()*20}s`;
      c.appendChild(p);
    }
  }

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ═══════════════════════════════════════════
  //  EVENTS
  // ═══════════════════════════════════════════
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.page)));
  document.querySelectorAll('[data-page]').forEach(btn => { if (!btn.classList.contains('nav-btn')) btn.addEventListener('click', () => showPage(btn.dataset.page)); });

  document.getElementById('results-tabs')?.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => { currentResultsGroup=btn.dataset.group; setActiveTab('results-tabs',currentResultsGroup); renderMatchesList(); }));
  document.getElementById('standings-tabs')?.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => { currentStandingsGroup=btn.dataset.group; setActiveTab('standings-tabs',currentStandingsGroup); renderStandings(); }));

  document.getElementById('btn-save-setup')?.addEventListener('click', saveSetup);
  document.getElementById('btn-reset-setup')?.addEventListener('click', () => { if (confirm('Đặt lại tất cả tên đội?')) resetSetup(); });
  document.getElementById('btn-save-results')?.addEventListener('click', () => { saveData(true); spawnConfetti(); currentStandingsGroup=currentResultsGroup; showPage('standings',currentResultsGroup); });
  document.getElementById('btn-reset-group')?.addEventListener('click', () => { if (confirm('Reset kết quả Bảng '+currentResultsGroup+'?')) resetGroup(currentResultsGroup); });
  document.getElementById('btn-reset-standings')?.addEventListener('click', () => { if (confirm('Reset kết quả Bảng '+currentStandingsGroup+'?')) resetGroup(currentStandingsGroup); });

  // Draw page
  document.getElementById('btn-draw-add')?.addEventListener('click', () => {
    const inp = document.getElementById('draw-team-input');
    if (!inp) return;
    const name = inp.value.trim();
    if (!name) { inp.focus(); inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),400); return; }
    if (drawTeams.find(t => t.name.toLowerCase()===name.toLowerCase())) { alert('Đội này đã có trong danh sách!'); return; }
    drawTeams.push({ name, group: null });
    inp.value = ''; inp.focus();
    persistDrawState(); renderDrawTeamList(); renderWheel(); renderDrawGroupSlots();
  });
  document.getElementById('draw-team-input')?.addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('btn-draw-add')?.click(); });
  document.getElementById('btn-spin')?.addEventListener('click', spinWheel);
  document.getElementById('btn-commit-draw')?.addEventListener('click', commitDrawToGroups);
  document.getElementById('btn-reset-draw')?.addEventListener('click', resetDrawPage);
  document.querySelectorAll('.draw-group-tab').forEach(btn => btn.addEventListener('click', () => { currentDrawGroup=btn.dataset.group; updateGroupTabActive(); }));

  // ═══════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════
  initParticles();
  setupAutoSave();
  if (appData.drawResult?.teams) drawTeams = [...appData.drawResult.teams];
  showPage('home');
})();
