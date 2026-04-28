// Over 1.5 Auto v7 — Dual Source Netlify Function
// Primary: API-Football (api-sports.io) — 100 req/day free
// Fallback: football-data.org — when API-Football fails or quota hit

const APIFOOTBALL_KEY = '33290ab6641c96496e9b8a49bcacf2de';
const APIFOOTBALL_BASE = 'https://v3.football.api-sports.io';

const FDORG_KEY = '5ab97ef9a9d942249c806323ac394018';
const FDORG_BASE = 'https://api.football-data.org/v4';

// League ID mappings between the two APIs
const LEAGUE_MAP_TO_APIF = {
  'PL':  39,   // Premier League
  'BL1': 78,   // Bundesliga
  'SA':  135,  // Serie A
  'PD':  140,  // La Liga
  'FL1': 61,   // Ligue 1
  'ELC': 40,   // Championship
  'PPL': 94,   // Primeira Liga
  'DED': 88,   // Eredivisie
  'CL':  2,    // Champions League
};

// Get current season year for API-Football
function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const source = params.source || 'apif'; // apif or fdorg

  try {
    if (source === 'apif') {
      return await handleAPIFootball(params, headers);
    } else {
      return await handleFDOrg(params, headers);
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message, source }),
    };
  }
};

// ── API-FOOTBALL HANDLER ──────────────────────────────────────────────────────
async function handleAPIFootball(params, headers) {
  const action = params.action;
  const season = getCurrentSeason();
  let url;

  if (action === 'fixtures') {
    // Today's fixtures for a league
    const leagueCode = params.league;
    const leagueId = LEAGUE_MAP_TO_APIF[leagueCode];
    if (!leagueId) throw new Error(`Unknown league: ${leagueCode}`);
    const today = new Date().toISOString().split('T')[0];
    url = `${APIFOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}&date=${today}`;

  } else if (action === 'team_stats') {
    // Team statistics for GPG, form, conceded
    const teamId = params.teamId;
    const leagueId = params.leagueId;
    url = `${APIFOOTBALL_BASE}/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;

  } else if (action === 'h2h') {
    // Head to head history
    const h2h = params.h2h; // format: "teamId1-teamId2"
    url = `${APIFOOTBALL_BASE}/fixtures/headtohead?h2h=${h2h}&last=10`;

  } else if (action === 'team_fixtures') {
    // Last N fixtures for a team (for form calculation)
    const teamId = params.teamId;
    const last = params.last || 10;
    url = `${APIFOOTBALL_BASE}/fixtures?team=${teamId}&last=${last}&season=${season}`;

  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  const res = await fetch(url, {
    headers: {
      'x-apisports-key': APIFOOTBALL_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`API-Football HTTP ${res.status}`);
  }

  const data = await res.json();

  // Check for quota exceeded
  if (data.errors && (data.errors.requests || data.errors.rateLimit)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'quota_exceeded', source: 'apif' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ...data, _source: 'apif' }),
  };
}

// ── FOOTBALL-DATA.ORG HANDLER (FALLBACK) ─────────────────────────────────────
async function handleFDOrg(params, headers) {
  const path = params.path;
  if (!path) throw new Error('No path provided for fdorg');

  const url = `${FDORG_BASE}${path}`;

  const res = await fetch(url, {
    headers: {
      'X-Auth-Token': FDORG_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`football-data.org HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ...data, _source: 'fdorg' }),
  };
}
