// ============================================================
//  OVER 1.5 GOALS ANALYZER v4 — CONFIG
//  Do NOT commit real keys to public repos.
//  Use Netlify environment variables for production.
// ============================================================

const CONFIG = {
  // Primary: The Odds API
  ODDS_API_KEY: 'e796f7f5a836415a68ccbe7ef1fbd22e',
  ODDS_API_BASE: 'https://api.the-odds-api.com/v4',

  // Paddy Power bookmaker key on The Odds API
  BOOKMAKER: '',

  // Over/Under market key
  MARKET: 'totals',
  OVER_LINE: 1.5,

  // Secondary: Football-Data.org (H2H + stats)
  FD_API_KEY: '5ab97ef9a9d942249c806323ac394018',
  FD_BASE: 'https://api.football-data.org/v4',

  // Scoring thresholds
  BET_THRESHOLD: 65,      // score >= 65 → BET
  MARGINAL_LOW: 50,       // 50–64 → MARGINAL
  // Below 50 → SKIP

  // Odds filter: only show matches where PP Over 1.5 odds are in range
  MIN_ODDS: 1.10,
  MAX_ODDS: 1.85,

  // Leagues to scan on The Odds API (sport keys)
  SPORTS: [
    'soccer_epl',
    'soccer_efl_champ',
    'soccer_spain_la_liga',
    'soccer_germany_bundesliga',
    'soccer_italy_serie_a',
    'soccer_france_ligue_one',
    'soccer_netherlands_eredivisie',
    'soccer_portugal_primeira_liga',
    'soccer_uefa_champs_league',
    'soccer_uefa_europa_league',
    'soccer_uefa_conference_league',
    'soccer_league_one',
    'soccer_league_two',
    'soccer_scotland_premiership',
  ],

  // Max H2H enrichment calls to avoid FD rate limits (150/min)
  MAX_ENRICHMENTS: 20,
};
