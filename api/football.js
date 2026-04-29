// Over 1.5 Auto v7 — Vercel API Route
// Primary: API-Football (api-sports.io) — 100 req/day free
// Fallback: football-data.org

const APIFOOTBALL_KEY = '33290ab6641c96496e9b8a49bcacf2de';
const APIFOOTBALL_BASE = 'https://v3.football.api-sports.io';

const FDORG_KEY = '5ab97ef9a9d942249c806323ac394018';
const FDORG_BASE = 'https://api.football-data.org/v4';

const LEAGUE_MAP_TO_APIF = {
  'PL':  39,
  'BL1': 78,
  'SA':  135,
  'PD':  140,
  'FL1': 61,
  'ELC': 40,
  'PPL': 94,
  'DED': 88,
  'CL':  2,
};

function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const params = req.query || {};
  const source = params.source || 'apif';

  try {
    if (source === 'apif') {
      return await handleAPIFootball(params, res);
    } else {
      return await handleFDOrg(params, res);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, source });
  }
}

async function handleAPIFootball(params, res) {
  const action = params.action;
  const season = getCurrentSeason();
  let url;

  if (action === 'fixtures') {
    const leagueId = params.league; // already numeric from frontend
    if (!leagueId) throw new Error('No league id provided');
    const today = new Date().toISOString().split('T')[0];
    url = `${APIFOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}&date=${today}`;

  } else if (action === 'team_stats') {
    const teamId = params.teamId;
    const leagueId = params.leagueId;
    url = `${APIFOOTBALL_BASE}/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;

  } else if (action === 'h2h') {
    const h2h = params.h2h;
    url = `${APIFOOTBALL_BASE}/fixtures/headtohead?h2h=${h2h}&last=10`;

  } else if (action === 'team_fixtures') {
    const teamId = params.teamId;
    const last = params.last || 10;
    url = `${APIFOOTBALL_BASE}/fixtures?team=${teamId}&last=${last}&season=${season}`;

  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  const apifRes = await fetch(url, {
    headers: { 'x-apisports-key': APIFOOTBALL_KEY },
  });

  if (!apifRes.ok) throw new Error(`API-Football HTTP ${apifRes.status}`);

  const data = await apifRes.json();

  if (data.errors && (data.errors.requests || data.errors.rateLimit)) {
    return res.status(429).json({ error: 'quota_exceeded', source: 'apif' });
  }

  return res.status(200).json({ ...data, _source: 'apif' });
}

async function handleFDOrg(params, res) {
  const path = params.path;
  if (!path) throw new Error('No path provided for fdorg');

  const url = `${FDORG_BASE}${path}`;

  const fdRes = await fetch(url, {
    headers: { 'X-Auth-Token': FDORG_KEY },
  });

  if (!fdRes.ok) throw new Error(`football-data.org HTTP ${fdRes.status}`);

  const data = await fdRes.json();
  return res.status(200).json({ ...data, _source: 'fdorg' });
}
