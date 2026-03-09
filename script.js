(function () {
  'use strict';

  const STORAGE_KEY = 'fcm_v3_data';
  const GROUPS = ['A', 'B', 'C', 'D'];
  const DEFAULT_TEAM_NAMES = {
    A: ['Brazil', 'Germany', 'France', 'Argentina'],
    B: ['Spain', 'Portugal', 'England', 'Italy'],
    C: ['Netherlands', 'Belgium', 'Croatia', 'Denmark'],
    D: ['Uruguay', 'Mexico', 'Senegal', 'Japan'],
  };

  // ===== DATA MANAGEMENT =====
  function createDefaultData() {
    const data = { teamNames: {}, matches: {} };
    GROUPS.forEach(g => {
      data.teamNames[g] = [...DEFAULT_TEAM_NAMES[g]];
      data.matches[g] = generateMatches(DEFAULT_TEAM_NAMES[g]);
    });
    return data;
  }

  function generateMatches(teams) {
    const pairs = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        pairs.push({ team1: teams[i], team2: teams[j], score1: null, score2: null });
      }
    }
    return pairs;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.teamNames && p.matches) return p;
      }
    } catch (e) { console.warn('Load failed', e); }
    return createDefaultData();
  }

  let saveTimeout = null;
  function saveData(immediate) {
    if (immediate) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      showSaveIndicator();
      return;
    }
    // Debounced auto-save — 400ms after last change
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      showSaveIndicator();
    }, 400);
  }

  let appData = loadData();

  // ===== STANDINGS CALCULATION =====
  function calculateStandings(group) {
    const teams = appData.teamNames[group];
    const stats = {};
    teams.forEach(t => {
      stats[t] = { team: t, played: 0, win: 0, draw: 0, lose: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    });

    (appData.matches[group] || []).forEach(m => {
      const s1 = m.score1 == null ? null : Number(m.score1);
      const s2 = m.score2 == null ? null : Number(m.score2);
      if (s1 === null || s2 === null || isNaN(s1) || isNaN(s2)) return;
      if (!stats[m.team1] || !stats[m.team2]) return;

      stats[m.team1].played++;
      stats[m.team2].played++;
      stats[m.team1].gf += s1; stats[m.team1].ga += s2;
      stats[m.team2].gf += s2; stats[m.team2].ga += s1;

      if (s1 > s2) {
        stats[m.team1].win++; stats[m.team1].pts += 3;
        stats[m.team2].lose++;
      } else if (s1 < s2) {
        stats[m.team2].win++; stats[m.team2].pts += 3;
        stats[m.team1].lose++;
      } else {
        stats[m.team1].draw++; stats[m.team1].pts++;
        stats[m.team2].draw++; stats[m.team2].pts++;
      }
    });

    const list = Object.values(stats).map(s => ({ ...s, gd: s.gf - s.ga }));
    list.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    return list;
  }

  // ===== PAGE ROUTING =====
  let currentResultsGroup = 'A';
  let currentStandingsGroup = 'A';

  function showPage(pageId, group) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    const btn = document.querySelector('.nav-btn[data-page="' + pageId + '"]');
    if (page) page.classList.add('active');
    if (btn) btn.classList.add('active');

    if (pageId === 'home') renderHome();
    if (pageId === 'setup') renderSetup();
    if (pageId === 'results') {
      if (group) currentResultsGroup = group;
      setActiveTab('results-tabs', currentResultsGroup);
      renderMatchesList();
    }
    if (pageId === 'standings') {
      if (group) currentStandingsGroup = group;
      setActiveTab('standings-tabs', currentStandingsGroup);
      renderStandings();
    }
  }

  function setActiveTab(tabBarId, group) {
    const bar = document.getElementById(tabBarId);
    if (!bar) return;
    bar.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.group === group);
    });
  }

  // ===== HOME PAGE =====
  function renderHome() {
    const grid = document.getElementById('home-groups-grid');
    if (!grid) return;
    grid.innerHTML = GROUPS.map(g => {
      const teams = appData.teamNames[g] || DEFAULT_TEAM_NAMES[g];
      const teamItems = teams.map(t =>
        `<div class="group-team-item"><span class="team-dot"></span>${escHtml(t)}</div>`
      ).join('');
      return `
        <article class="group-card" data-group="${g}">
          <div class="group-card-header">
            <div class="group-letter">${g}</div>
            <h3>Bảng ${g}</h3>
          </div>
          <div class="group-card-teams">${teamItems}</div>
          <div class="group-card-btns">
            <button class="btn btn-gold btn-sm" data-goto="standings" data-group="${g}">🏅 Xếp hạng</button>
            <button class="btn btn-ghost btn-sm" data-goto="results" data-group="${g}">📋 Kết quả</button>
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        showPage(btn.dataset.goto, btn.dataset.group);
      });
    });
    grid.querySelectorAll('.group-card').forEach(card => {
      card.addEventListener('click', () => showPage('standings', card.dataset.group));
    });
  }

  // ===== SETUP PAGE =====
  function renderSetup() {
    GROUPS.forEach(g => {
      const teams = appData.teamNames[g] || DEFAULT_TEAM_NAMES[g];
      teams.forEach((name, idx) => {
        const inp = document.querySelector(`.team-name-input[data-group="${g}"][data-idx="${idx}"]`);
        if (inp) inp.value = name;
      });
    });
  }

  function saveSetup() {
    GROUPS.forEach(g => {
      const newNames = [];
      for (let idx = 0; idx < 4; idx++) {
        const inp = document.querySelector(`.team-name-input[data-group="${g}"][data-idx="${idx}"]`);
        const val = inp ? inp.value.trim() : '';
        newNames.push(val || DEFAULT_TEAM_NAMES[g][idx]);
      }
      // Rebuild matches preserving scores by position
      const oldMatches = appData.matches[g] || [];
      const newMatches = [];
      let pos = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const old = oldMatches[pos] || {};
          newMatches.push({
            team1: newNames[i],
            team2: newNames[j],
            score1: old.score1 !== undefined ? old.score1 : null,
            score2: old.score2 !== undefined ? old.score2 : null,
          });
          pos++;
        }
      }
      appData.teamNames[g] = newNames;
      appData.matches[g] = newMatches;
    });
    saveData(true);
    renderHome();

    const toast = document.getElementById('setup-toast');
    if (toast) {
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 2800);
    }
  }

  // Auto-save setup on each keystroke (debounced)
  function setupAutoSave() {
    document.querySelectorAll('.team-name-input').forEach(inp => {
      inp.addEventListener('input', () => {
        // Only persist current values, not rebuild matches
        const g = inp.dataset.group;
        const idx = parseInt(inp.dataset.idx);
        if (appData.teamNames[g]) {
          appData.teamNames[g][idx] = inp.value.trim() || DEFAULT_TEAM_NAMES[g][idx];
        }
        saveData(); // debounced
      });
    });
  }

  function resetSetup() {
    GROUPS.forEach(g => {
      appData.teamNames[g] = [...DEFAULT_TEAM_NAMES[g]];
      appData.matches[g] = generateMatches(DEFAULT_TEAM_NAMES[g]);
      for (let idx = 0; idx < 4; idx++) {
        const inp = document.querySelector(`.team-name-input[data-group="${g}"][data-idx="${idx}"]`);
        if (inp) inp.value = DEFAULT_TEAM_NAMES[g][idx];
      }
    });
    saveData(true);
  }

  // ===== RESULTS PAGE =====
  function renderMatchesList() {
    const group = currentResultsGroup;
    const container = document.getElementById('matches-list');
    if (!container) return;
    const matches = appData.matches[group] || [];

    container.innerHTML = matches.map((m, i) => {
      const s1 = m.score1 != null ? m.score1 : '';
      const s2 = m.score2 != null ? m.score2 : '';
      const hasResult = s1 !== '' && s2 !== '';
      return `
        <div class="match-row ${hasResult ? 'has-result' : ''}" data-idx="${i}">
          <span class="match-team">${escHtml(m.team1)}</span>
          <div class="match-inputs">
            <input type="number" min="0" step="1" value="${s1}" placeholder="—" data-score="1">
            <span class="score-dash">:</span>
            <input type="number" min="0" step="1" value="${s2}" placeholder="—" data-score="2">
          </div>
          <span class="match-team right">${escHtml(m.team2)}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.match-row').forEach(row => {
      const idx = parseInt(row.dataset.idx);
      const [in1, in2] = row.querySelectorAll('input');
      const update = () => {
        const v1 = in1.value.trim();
        const v2 = in2.value.trim();
        const match = appData.matches[group][idx];
        match.score1 = v1 === '' ? null : parseInt(v1, 10);
        match.score2 = v2 === '' ? null : parseInt(v2, 10);
        row.classList.toggle('has-result', v1 !== '' && v2 !== '');
        saveData(); // auto-save debounced
      };
      in1.addEventListener('input', update);
      in2.addEventListener('input', update);
    });
  }

  function resetGroup(group) {
    const teams = appData.teamNames[group];
    appData.matches[group] = generateMatches(teams);
    saveData(true);
    renderMatchesList();
    renderStandings();
  }

  // ===== STANDINGS PAGE =====
  function renderStandings() {
    const group = currentStandingsGroup;
    const standings = calculateStandings(group);
    const tbody = document.getElementById('standings-body');
    if (!tbody) return;

    tbody.innerHTML = standings.map((row, i) => {
      const rank = i + 1;
      const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : '';
      const badgeClass = ['', 'r1', 'r2', 'r3', 'r4'][rank] || 'r4';
      const gdStr = row.gd >= 0 ? '+' + row.gd : '' + row.gd;
      const gdClass = row.gd > 0 ? 'gd-positive' : row.gd < 0 ? 'gd-negative' : '';
      return `
        <tr class="${rankClass}" style="animation: rowIn 0.4s ${i * 0.07}s both">
          <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
          <td><div class="team-cell"><div class="team-flag">${rank <= 2 ? (rank === 1 ? '🥇' : '🥈') : '⚽'}</div><strong>${escHtml(row.team)}</strong></div></td>
          <td>${row.played}</td>
          <td>${row.win}</td>
          <td>${row.draw}</td>
          <td>${row.lose}</td>
          <td>${row.gf}</td>
          <td>${row.ga}</td>
          <td class="${gdClass}">${gdStr}</td>
          <td class="pts-cell">${row.pts}</td>
        </tr>
      `;
    }).join('');

    if (!document.getElementById('row-anim-style')) {
      const s = document.createElement('style');
      s.id = 'row-anim-style';
      s.textContent = `@keyframes rowIn { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:translateX(0); } }`;
      document.head.appendChild(s);
    }

    const advEl = document.getElementById('advancing-teams');
    if (advEl) {
      const first = standings[0], second = standings[1];
      advEl.innerHTML = `
        ${first ? `<div class="advance-card first" style="animation-delay:0s"><span class="advance-icon">🥇</span><div><div class="advance-label">NHẤT BẢNG</div><div class="advance-team">${escHtml(first.team)}</div></div></div>` : ''}
        ${second ? `<div class="advance-card second" style="animation-delay:0.12s"><span class="advance-icon">🥈</span><div><div class="advance-label">NHÌ BẢNG</div><div class="advance-team">${escHtml(second.team)}</div></div></div>` : ''}
      `;
    }
  }

  // ===== SAVE INDICATOR =====
  let saveIndicatorTimer = null;
  function showSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.remove('hidden');
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // ===== CONFETTI =====
  function spawnConfetti() {
    const container = document.getElementById('confetti');
    if (!container) return;
    const colors = ['#FFD700','#FFBE00','#00FF87','#00D4FF','#FF3085','#1E6AFF','#FF6B00','#ffffff'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.cssText = `
        left: ${Math.random()*100}%;
        width: ${5 + Math.random()*9}px;
        height: ${5 + Math.random()*9}px;
        background: ${colors[Math.floor(Math.random()*colors.length)]};
        animation-duration: ${2.2 + Math.random()*3}s;
        animation-delay: ${Math.random()*1.5}s;
        border-radius: ${Math.random() > 0.5 ? '50%' : '3px'};
      `;
      container.appendChild(piece);
      setTimeout(() => piece.remove(), 5500);
    }
  }

  // ===== PARTICLES INIT =====
  function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const colors = ['rgba(18,83,204,.25)', 'rgba(0,160,92,.22)', 'rgba(255,149,0,.20)', 'rgba(0,212,255,.18)'];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const size = 3 + Math.random() * 5;
      p.style.cssText = `
        left: ${Math.random()*100}%;
        width: ${size}px; height: ${size}px;
        background: ${colors[Math.floor(Math.random()*colors.length)]};
        animation-duration: ${14 + Math.random()*18}s;
        animation-delay: ${-Math.random()*20}s;
      `;
      container.appendChild(p);
    }
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ===== EVENT LISTENERS =====

  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  // Hero/CTA action buttons
  document.querySelectorAll('[data-page]').forEach(btn => {
    if (!btn.classList.contains('nav-btn')) {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    }
  });

  // Results tabs
  document.getElementById('results-tabs')?.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentResultsGroup = btn.dataset.group;
      setActiveTab('results-tabs', currentResultsGroup);
      renderMatchesList();
    });
  });

  // Standings tabs
  document.getElementById('standings-tabs')?.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentStandingsGroup = btn.dataset.group;
      setActiveTab('standings-tabs', currentStandingsGroup);
      renderStandings();
    });
  });

  // Setup buttons
  document.getElementById('btn-save-setup')?.addEventListener('click', saveSetup);
  document.getElementById('btn-reset-setup')?.addEventListener('click', () => {
    if (confirm('Đặt lại tất cả tên đội về mặc định?')) resetSetup();
  });

  // Results buttons
  document.getElementById('btn-save-results')?.addEventListener('click', () => {
    saveData(true);
    spawnConfetti();
    currentStandingsGroup = currentResultsGroup;
    showPage('standings', currentResultsGroup);
  });
  document.getElementById('btn-reset-group')?.addEventListener('click', () => {
    if (confirm('Reset toàn bộ kết quả Bảng ' + currentResultsGroup + '?')) {
      resetGroup(currentResultsGroup);
    }
  });

  // Standings buttons
  document.getElementById('btn-reset-standings')?.addEventListener('click', () => {
    if (confirm('Reset toàn bộ kết quả Bảng ' + currentStandingsGroup + '?')) {
      resetGroup(currentStandingsGroup);
    }
  });

  // ===== INIT =====
  initParticles();
  setupAutoSave();
  showPage('home');
})();