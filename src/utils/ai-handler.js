const axios = require('axios');

let activeAICalls = 0;
const MAX_CONCURRENT_AI_CALLS = 2;

async function getAIResponse(messageContent, userComment, ragService) {
  const { AI_CHAT_API_URL, AI_CHAT_API_KEY, AI_CHAT_MODEL } = process.env;

  if (!AI_CHAT_API_URL || !AI_CHAT_API_KEY || !AI_CHAT_MODEL) {
    console.error('AI_CHAT env vars not configured.');
    return null;
  }

  if (activeAICalls >= MAX_CONCURRENT_AI_CALLS) {
    console.log(`[AI] Skipping — ${activeAICalls} calls already in progress`);
    return null;
  }

  activeAICalls++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  try {
    const truncatedMessage = (messageContent || '').substring(0, 3000);
    const truncatedComment = (userComment || '').substring(0, 1000);

    let ragContext = '';
    if (ragService) {
      try {
        ragContext = await ragService.buildContext(truncatedComment + ' ' + truncatedMessage, 3);
      } catch (err) {
        console.error('[AI] RAG context failed:', err.message);
      }
    }

    let systemPrompt = `You are a helpful and insightful assistant on an anonymous message board.
Your name is GoldieRill.
A user has posted a message, and another user has mentioned you in a comment.
Your task is to provide a helpful and relevant response to the comment, based on the context of the original message.
Be concise and stay on topic.
Respond to the user in Simplified Chinese.`;

    if (ragContext) {
      systemPrompt += `\n\nHere is some relevant context from the board's history that may help you respond:\n${ragContext}`;
    }

    const userPrompt = `Original Message:
---
${truncatedMessage}
---

User's Comment (that mentioned you):
---
${truncatedComment}
---

Your response:`;

    const response = await axios.post(
      AI_CHAT_API_URL,
      {
        model: AI_CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_CHAT_API_KEY}`,
        },
        timeout: 60000,
        signal: controller.signal,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      console.log(`[AI] Response size: ${content.length} chars`);
      return content.trim().substring(0, 4000);
    } else {
      console.error('Unexpected LLM response structure:', response.data);
      return null;
    }
  } catch (error) {
    if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
      console.error('[AI] Request aborted due to timeout');
    } else {
      console.error('Error calling LLM API:', error.response ? error.response.data : error.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
    activeAICalls--;
  }
}

module.exports = { getAIResponse };
