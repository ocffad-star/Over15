// ============================================================
//  OVER 1.5 GOALS ANALYZER v4 — ENGINE
//  Primary: The Odds API (fixtures + Paddy Power odds)
//  Secondary: Football-Data.org (H2H + team stats)
//  Auto verdict: BET / MARGINAL / SKIP
// ============================================================

let allMatches = [];
let currentFilter = 'all';

// ── ENTRY POINT ──────────────────────────────────────────────
async function runScan() {
  setStatus('SCANNING...');
  setLoadStep('Connecting to The Odds API...');
  showLoader(true);
  showError('');
  document.getElementById('results').innerHTML = '';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('scanBtn').disabled = true;

  try {
    // STEP 1: Fetch all fixtures + Paddy Power odds from The Odds API
    setLoadStep('Fetching today\'s fixtures & Paddy Power odds...');
    const oddsData = await fetchAllOdds();

    if (!oddsData.length) {
      showLoader(false);
      showError('No fixtures found with Paddy Power Over 1.5 odds for today. Markets may not be open yet.');
      document.getElementById('empty-state').style.display = 'block';
      document.getElementById('empty-state').querySelector('p').textContent =
        'No fixtures available — try again closer to kick-off time.';
      resetBtn();
      return;
    }

    setLoadStep(`Found ${oddsData.length} fixtures. Enriching with stats...`);

    // STEP 2: Enrich with H2H + team form from football-data.org
    const enriched = await enrichWithStats(oddsData);

    // STEP 3: Score and verdict
    allMatches = enriched.map(scoreMatch);
    allMatches.sort((a, b) => b.score - a.score);

    // STEP 4: Render
    renderAll();
    updateSummary();
    setStatus(`SCAN COMPLETE — ${allMatches.length} MATCHES`);
    document.getElementById('last-updated').textContent =
      'UPDATED: ' + new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('refreshBtn').style.display = 'inline-block';

  } catch (err) {
    console.error(err);
    showError('Scan failed: ' + err.message);
    document.getElementById('empty-state').style.display = 'block';
  } finally {
    showLoader(false);
    resetBtn();
  }
}

// ── THE ODDS API ─────────────────────────────────────────────
async function fetchAllOdds() {
  const today = new Date();
  const commenceFrom = new Date(today);
  commenceFrom.setHours(0, 0, 0, 0);
  const commenceTo = new Date(today);
  commenceTo.setHours(23, 59, 59, 999);

  const fromISO = commenceFrom.toISOString();
  const toISO = commenceTo.toISOString();

  const allFixtures = [];
  let remainingQuota = null;

  for (const sport of CONFIG.SPORTS) {
    try {
      const url = new URL(`${CONFIG.ODDS_API_BASE}/sports/${sport}/odds`);
      url.searchParams.set('apiKey', CONFIG.ODDS_API_KEY);
      url.searchParams.set('regions', 'uk');
      url.searchParams.set('markets', CONFIG.MARKET);
      url.searchParams.set('bookmakers', CONFIG.BOOKMAKER);
      url.searchParams.set('commenceTimeFrom', fromISO);
      url.searchParams.set('commenceTimeTo', toISO);
      url.searchParams.set('oddsFormat', 'decimal');

      const res = await fetch(url.toString());

      if (!res.ok) {
        const body = await res.text();
        console.warn(`Odds API ${sport}: ${res.status} — ${body}`);
        continue;
      }

      remainingQuota = res.headers.get('x-requests-remaining');
      const data = await res.json();

      for (const fixture of data) {
        const ppOdds = extractPPOdds(fixture);
        if (ppOdds === null) continue;
        if (ppOdds < CONFIG.MIN_ODDS || ppOdds > CONFIG.MAX_ODDS) continue;

        allFixtures.push({
          id: fixture.id,
          sport_key: sport,
          sport_title: fixture.sport_title,
          commence_time: fixture.commence_time,
          home_team: fixture.home_team,
          away_team: fixture.away_team,
          pp_odds: ppOdds,
          // enrichment fields (filled later)
          h2h: null,
          home_form: null,
          away_form: null,
          home_avg_goals: null,
          away_avg_goals: null,
          enriched: false,
        });
      }

      setLoadStep(`Fetched ${sport.replace('soccer_','')} — ${allFixtures.length} total fixtures so far...`);

    } catch (e) {
      console.warn(`Failed sport ${sport}:`, e.message);
    }
  }

  if (remainingQuota !== null) {
    console.log(`Odds API requests remaining: ${remainingQuota}`);
  }

  return allFixtures;
}

function extractPPOdds(fixture) {
  if (!fixture.bookmakers || !fixture.bookmakers.length) return null;

  const pp = fixture.bookmakers.find(b => b.key === CONFIG.BOOKMAKER);
  if (!pp) return null;

  const totalsMarket = pp.markets.find(m => m.key === CONFIG.MARKET);
  if (!totalsMarket) return null;

  // Find Over 1.5
  const over = totalsMarket.outcomes.find(o =>
    o.name.toLowerCase() === 'over' && parseFloat(o.point) === CONFIG.OVER_LINE
  );

  return over ? parseFloat(over.price) : null;
}

// ── FOOTBALL-DATA.ORG ENRICHMENT ─────────────────────────────
async function enrichWithStats(fixtures) {
  const toEnrich = fixtures.slice(0, CONFIG.MAX_ENRICHMENTS);
  const rest = fixtures.slice(CONFIG.MAX_ENRICHMENTS);

  const enriched = [];
  let done = 0;

  for (const fixture of toEnrich) {
    try {
      setLoadStep(`Enriching ${done + 1}/${toEnrich.length}: ${fixture.home_team} vs ${fixture.away_team}...`);

      // Search for the match in FD
      const fdData = await fetchFDMatch(fixture.home_team, fixture.away_team);

      if (fdData) {
        fixture.h2h = fdData.h2h;
        fixture.home_form = fdData.home_form;
        fixture.away_form = fdData.away_form;
        fixture.home_avg_goals = fdData.home_avg_goals;
        fixture.away_avg_goals = fdData.away_avg_goals;
        fixture.enriched = true;
      }

    } catch (e) {
      console.warn(`Enrichment failed for ${fixture.home_team}:`, e.message);
    }

    done++;
    enriched.push(fixture);

    // Throttle to respect FD rate limit (10 calls/min on free tier)
    await sleep(500);
  }

  return [...enriched, ...rest];
}

async function fetchFDMatch(homeTeam, awayTeam) {
  try {
    // Search for competitions to find the right one
    // Use the matches endpoint with team search
    const today = new Date().toISOString().split('T')[0];
    const url = `${CONFIG.FD_BASE}/matches?dateFrom=${today}&dateTo=${today}&limit=100`;

    const res = await fetch(url, {
      headers: { 'X-Auth-Token': CONFIG.FD_API_KEY }
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.matches) return null;

    // Find matching fixture (fuzzy name match)
    const match = data.matches.find(m =>
      fuzzyMatch(m.homeTeam.name, homeTeam) &&
      fuzzyMatch(m.awayTeam.name, awayTeam)
    );

    if (!match) return null;

    // Fetch H2H
    const h2hData = await fetchH2H(match.id);

    // Extract form from last 5 home/away games if available
    return {
      h2h: h2hData,
      home_form: extractFormFromH2H(h2hData, match.homeTeam.id, 'home'),
      away_form: extractFormFromH2H(h2hData, match.awayTeam.id, 'away'),
      home_avg_goals: calcAvgGoals(h2hData, match.homeTeam.id),
      away_avg_goals: calcAvgGoals(h2hData, match.awayTeam.id),
    };

  } catch (e) {
    return null;
  }
}

async function fetchH2H(matchId) {
  try {
    const res = await fetch(`${CONFIG.FD_BASE}/matches/${matchId}/head2head?limit=10`, {
      headers: { 'X-Auth-Token': CONFIG.FD_API_KEY }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.matches || [];
  } catch (e) {
    return [];
  }
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  const clean = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ca = clean(a), cb = clean(b);
  return ca.includes(cb) || cb.includes(ca) || ca === cb;
}

function extractFormFromH2H(h2h, teamId, side) {
  if (!h2h || !h2h.length) return null;
  const relevant = h2h.slice(0, 5);
  return relevant.map(m => {
    const isHome = m.homeTeam && m.homeTeam.id === teamId;
    const scored = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const conceded = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    if (scored === null) return null;
    const total = scored + conceded;
    return total > 1.5 ? 1 : 0;
  }).filter(v => v !== null);
}

function calcAvgGoals(h2h, teamId) {
  if (!h2h || !h2h.length) return null;
  const totals = h2h.slice(0, 5).map(m => {
    const home = m.score.fullTime.home;
    const away = m.score.fullTime.away;
    if (home === null || away === null) return null;
    return home + away;
  }).filter(v => v !== null);
  if (!totals.length) return null;
  return totals.reduce((a, b) => a + b, 0) / totals.length;
}

// ── SCORING ENGINE ───────────────────────────────────────────
//
//  Max score: 100
//  Signals:
//    1. Paddy Power Over 1.5 odds implied probability     (25 pts)
//    2. H2H — % of last 10 with 2+ goals                 (20 pts)
//    3. Combined team avg goals per game (H2H)            (20 pts)
//    4. Home form (Over 1.5 rate last 5)                  (15 pts)
//    5. Away form (Over 1.5 rate last 5)                  (15 pts)
//    6. Kick-off time bonus (evening games score slightly higher) (5 pts)

function scoreMatch(fixture) {
  const signals = [];
  let score = 0;

  // 1. Implied probability from PP odds
  const impliedProb = 1 / fixture.pp_odds;
  const oddsPoints = Math.min(25, Math.round(impliedProb * 25));
  score += oddsPoints;
  signals.push({
    label: 'Implied Prob (PP)',
    value: (impliedProb * 100).toFixed(1) + '%',
    points: oddsPoints,
    max: 25,
    positive: oddsPoints >= 15,
  });

  // 2. H2H over rate
  let h2hPoints = 0;
  let h2hStr = 'No data';
  if (fixture.h2h && fixture.h2h.length >= 3) {
    const completed = fixture.h2h.filter(m =>
      m.score && m.score.fullTime.home !== null
    );
    if (completed.length > 0) {
      const over15 = completed.filter(m =>
        (m.score.fullTime.home + m.score.fullTime.away) > 1.5
      ).length;
      const rate = over15 / completed.length;
      h2hPoints = Math.round(rate * 20);
      score += h2hPoints;
      h2hStr = `${over15}/${completed.length} (${(rate * 100).toFixed(0)}%)`;
    }
  }
  signals.push({
    label: 'H2H Over 1.5 Rate',
    value: h2hStr,
    points: h2hPoints,
    max: 20,
    positive: h2hPoints >= 12,
    neutral: h2hStr === 'No data',
  });

  // 3. Combined avg goals
  let avgPoints = 0;
  let avgStr = 'No data';
  if (fixture.home_avg_goals !== null && fixture.away_avg_goals !== null) {
    const combined = (fixture.home_avg_goals + fixture.away_avg_goals) / 2;
    // Scale: 2.0 goals = full 20pts, linear
    avgPoints = Math.min(20, Math.round((combined / 2.5) * 20));
    score += avgPoints;
    avgStr = combined.toFixed(2) + ' avg goals/game';
  } else if (fixture.home_avg_goals !== null) {
    avgPoints = Math.min(10, Math.round((fixture.home_avg_goals / 2.5) * 10));
    score += avgPoints;
    avgStr = fixture.home_avg_goals.toFixed(2) + ' avg (home only)';
  }
  signals.push({
    label: 'Avg Goals (H2H)',
    value: avgStr,
    points: avgPoints,
    max: 20,
    positive: avgPoints >= 12,
    neutral: avgStr === 'No data',
  });

  // 4. Home form
  let homeFormPoints = 0;
  let homeFormStr = 'No data';
  if (fixture.home_form && fixture.home_form.length > 0) {
    const rate = fixture.home_form.reduce((a, b) => a + b, 0) / fixture.home_form.length;
    homeFormPoints = Math.round(rate * 15);
    score += homeFormPoints;
    homeFormStr = fixture.home_form.reduce((a,b)=>a+b,0) + '/' + fixture.home_form.length + ' O1.5';
  }
  signals.push({
    label: 'Home Form (last 5)',
    value: homeFormStr,
    points: homeFormPoints,
    max: 15,
    positive: homeFormPoints >= 9,
    neutral: homeFormStr === 'No data',
  });

  // 5. Away form
  let awayFormPoints = 0;
  let awayFormStr = 'No data';
  if (fixture.away_form && fixture.away_form.length > 0) {
    const rate = fixture.away_form.reduce((a, b) => a + b, 0) / fixture.away_form.length;
    awayFormPoints = Math.round(rate * 15);
    score += awayFormPoints;
    awayFormStr = fixture.away_form.reduce((a,b)=>a+b,0) + '/' + fixture.away_form.length + ' O1.5';
  }
  signals.push({
    label: 'Away Form (last 5)',
    value: awayFormStr,
    points: awayFormPoints,
    max: 15,
    positive: awayFormPoints >= 9,
    neutral: awayFormStr === 'No data',
  });

  // 6. Kick-off time bonus (evening games — more open play)
  let koPoints = 0;
  const kickoff = new Date(fixture.commence_time);
  const hour = kickoff.getUTCHours();
  if (hour >= 17 && hour <= 21) {
    koPoints = 5;
    score += 5;
  }
  signals.push({
    label: 'Evening K/O Bonus',
    value: hour >= 17 && hour <= 21 ? `${kickoff.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'})}` : 'No bonus',
    points: koPoints,
    max: 5,
    positive: koPoints > 0,
    neutral: koPoints === 0,
  });

  // Verdict
  let verdict;
  if (score >= CONFIG.BET_THRESHOLD) verdict = 'bet';
  else if (score >= CONFIG.MARGINAL_LOW) verdict = 'marginal';
  else verdict = 'skip';

  // Reason summary
  const reason = buildReason(verdict, score, fixture, signals);

  return {
    ...fixture,
    score,
    signals,
    verdict,
    reason,
  };
}

function buildReason(verdict, score, fixture, signals) {
  const impliedSig = signals[0];
  const h2hSig = signals[1];
  const avgSig = signals[2];

  let parts = [];

  if (verdict === 'bet') {
    parts.push(`Strong score of ${score}/100.`);
    if (signals[0].points >= 18) parts.push(`Paddy Power pricing implies ${impliedSig.value} probability.`);
    if (h2hSig.points >= 12) parts.push(`H2H history: ${h2hSig.value} with 2+ goals.`);
    if (avgSig.points >= 12) parts.push(`Combined ${avgSig.value}.`);
  } else if (verdict === 'marginal') {
    parts.push(`Borderline score ${score}/100 — proceed with caution.`);
    if (h2hSig.neutral && avgSig.neutral) parts.push('Limited historical data — odds-only signal.');
    else if (h2hSig.points < 10) parts.push('H2H record is mixed on goals.');
  } else {
    parts.push(`Weak score ${score}/100.`);
    if (signals[0].points < 15) parts.push(`Odds suggest lower probability (${impliedSig.value}).`);
    if (h2hSig.points < 8 && !h2hSig.neutral) parts.push(`H2H record: ${h2hSig.value} — low-scoring tendency.`);
  }

  return parts.join(' ');
}

// ── RENDER ───────────────────────────────────────────────────
function renderAll() {
  const container = document.getElementById('results');
  container.innerHTML = '';

  const filtered = currentFilter === 'all'
    ? allMatches
    : allMatches.filter(m => m.verdict === currentFilter);

  if (!filtered.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text-dim)">
        No matches in this category today.
      </div>`;
    return;
  }

  filtered.forEach((m, i) => {
    container.innerHTML += renderCard(m, i);
  });
}

function renderCard(m, i) {
  const ko = new Date(m.commence_time);
  const koStr = ko.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const league = m.sport_title || m.sport_key.replace('soccer_', '').replace(/_/g, ' ').toUpperCase();
  const pct = Math.min(100, m.score);

  return `
  <div class="match-card ${m.verdict}" id="card-${i}" style="animation-delay:${i * 0.04}s">
    <div class="card-header" onclick="toggleCard(${i})">
      <div class="verdict-badge">${m.verdict.toUpperCase()}</div>
      <div class="match-teams">
        <div class="match-name">${m.home_team} vs ${m.away_team}</div>
        <div class="match-meta">${league} &middot; KO ${koStr} &middot; ${m.enriched ? '✓ Enriched' : '~ Odds only'}</div>
      </div>
      <div class="score-bar">
        <div>
          <div class="score-num">${m.score}</div>
          <div class="score-label">SCORE</div>
        </div>
        <div class="odds-chip">@${m.pp_odds.toFixed(2)}</div>
      </div>
      <div class="expand-icon">▼</div>
    </div>
    <div class="card-detail">
      <div class="detail-grid">
        <div class="detail-section">
          <h4>Signals</h4>
          ${m.signals.map(s => `
            <div class="signal-row">
              <span class="sig-label">${s.label}</span>
              <span class="sig-val ${s.neutral ? 'sig-neu' : s.positive ? 'sig-pos' : 'sig-neg'}">
                ${s.value} <small style="opacity:.6">(${s.points}/${s.max})</small>
              </span>
            </div>
          `).join('')}
          <div class="score-progress" style="margin-top:12px">
            <div class="score-progress-fill" style="width:${pct}%"></div>
          </div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim);margin-top:4px;text-align:right">
            ${m.score} / 100
          </div>
        </div>
        <div class="detail-section">
          <h4>Analysis</h4>
          <p class="reason-text">${m.reason}</p>
          <div style="margin-top:16px">
            <div class="signal-row">
              <span class="sig-label">Paddy Power Odds</span>
              <span class="sig-val sig-pos">@${m.pp_odds.toFixed(2)}</span>
            </div>
            <div class="signal-row">
              <span class="sig-label">Implied Probability</span>
              <span class="sig-val">${((1/m.pp_odds)*100).toFixed(1)}%</span>
            </div>
            <div class="signal-row">
              <span class="sig-label">Data Source</span>
              <span class="sig-val sig-neu">${m.enriched ? 'Odds + H2H Stats' : 'Odds Only'}</span>
            </div>
            <div class="signal-row">
              <span class="sig-label">Kick-off (BST)</span>
              <span class="sig-val sig-neu">${koStr}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function toggleCard(i) {
  const card = document.getElementById(`card-${i}`);
  card.classList.toggle('open');
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (allMatches.length) renderAll();
}

function updateSummary() {
  const bets = allMatches.filter(m => m.verdict === 'bet').length;
  const skips = allMatches.filter(m => m.verdict === 'skip').length;
  const marginal = allMatches.filter(m => m.verdict === 'marginal').length;

  document.getElementById('stat-total').textContent = allMatches.length;
  document.getElementById('stat-bets').textContent = bets;
  document.getElementById('stat-skips').textContent = skips;
  document.getElementById('stat-marginal').textContent = marginal;

  const betOdds = allMatches.filter(m => m.verdict === 'bet').map(m => m.pp_odds);
  if (betOdds.length) {
    const avg = betOdds.reduce((a, b) => a + b, 0) / betOdds.length;
    document.getElementById('stat-avgodds').textContent = avg.toFixed(2);
  } else {
    document.getElementById('stat-avgodds').textContent = '—';
  }
}

// ── HELPERS ──────────────────────────────────────────────────
function showLoader(on) {
  document.getElementById('loader').style.display = on ? 'block' : 'none';
}

function showError(msg) {
  const el = document.getElementById('error-box');
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg;
}

function setStatus(msg) {
  document.getElementById('status-line').textContent = msg;
}

function setLoadStep(msg) {
  document.getElementById('load-step').textContent = msg;
}

function resetBtn() {
  document.getElementById('scanBtn').disabled = false;
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}
