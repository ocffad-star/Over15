const API_KEY = '5ab97ef9a9d942249c806323ac394018';
const BASE    = 'https://api.football-data.org/v4';

exports.handler = async function(event) {
  const path = event.queryStringParameters?.path || '';

  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { 'X-Auth-Token': API_KEY }
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
