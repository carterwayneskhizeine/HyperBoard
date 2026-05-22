const axios = require('axios');

async function embed(text) {
  const { EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL } = process.env;

  if (!EMBEDDING_API_URL || !EMBEDDING_API_KEY || !EMBEDDING_MODEL) {
    throw new Error('Embedding env vars not configured (EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL)');
  }

  const input = text.length > 2000 ? text.substring(0, 2000) : text;

  const response = await axios.post(
    EMBEDDING_API_URL,
    {
      model: EMBEDDING_MODEL,
      input: input,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${EMBEDDING_API_KEY}`,
      },
      timeout: 30000,
    }
  );

  if (response.data && response.data.data && response.data.data.length > 0) {
    return response.data.data[0].embedding;
  }

  throw new Error('Unexpected embedding API response structure');
}

module.exports = { embed };
