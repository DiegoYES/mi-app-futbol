const axios = require('axios');
const { instalarControlCuotaAxios } = require('./apiQuota');
const https = require('https');

const httpsAgent = new https.Agent({ family: 4 });

const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-apisports-key': process.env.API_FOOTBALL_KEY
  },
  httpsAgent,
  timeout: 10000
});
instalarControlCuotaAxios(api);

async function getTeamStatistics(teamId, leagueId, season) {
  const { data } = await api.get('/teams/statistics', {
    params: { team: teamId, league: leagueId, season }
  });
  return data.response;
}

async function getTeamFixtures(teamId, season, leagueId, status = 'FT') {
  const { data } = await api.get('/fixtures', {
    params: { team: teamId, season, league: leagueId, status }
  });
  return data.response;
}

async function getTeamsByLeague(leagueId, season) {
  const { data } = await api.get('/teams', {
    params: { league: leagueId, season }
  });
  return data.response;
}

module.exports = { getTeamStatistics, getTeamFixtures, getTeamsByLeague };
