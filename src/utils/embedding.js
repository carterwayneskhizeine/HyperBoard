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
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 2 * 1024 * 1024,
    }
  );

  if (response.data && response.data.data && response.data.data.length > 0) {
    const vector = response.data.data[0].embedding;
    console.log(`[Embed] ${EMBEDDING_MODEL} → dim=${vector.length}, resp≈${JSON.stringify(response.data).length}B`);
    return vector;
  }

  throw new Error('Unexpected embedding API response structure');
}

module.exports = { embed };
