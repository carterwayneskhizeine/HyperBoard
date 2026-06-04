const axios = require('axios');

let activeAICalls = 0;
const MAX_CONCURRENT_AI_CALLS = 2;

function cleanQuery(text) {
  return (text || '')
    .replace(/@goldierill/gi, '')
    .replace(/@rag/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dbGet(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function fetchFullContent(db, sources) {
  const parts = [];
  for (const s of sources) {
    try {
      if (s.type === 'message') {
        const row = await dbGet(db, 'SELECT content FROM messages WHERE id = ? AND is_private = 0', [s.id]);
        if (row && row.content) {
          const content = row.content.length > 8000 ? row.content.substring(0, 8000) + '\n...(long post truncated)' : row.content;
          parts.push(`[Message #${s.id}]\n${content}`);
        }
      } else if (s.type === 'comment') {
        const row = await dbGet(db, 'SELECT text FROM comments WHERE id = ? AND is_deleted = 0', [s.id]);
        if (row && row.text) {
          parts.push(`[Comment #${s.id}]\n${row.text.substring(0, 2000)}`);
        }
      }
    } catch {}
  }
  return parts.join('\n\n---\n\n');
}

async function getAIResponse(messageContent, userComment, ragService, db, useRAG = false) {
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
    if (useRAG && ragService) {
      try {
        const query = cleanQuery(truncatedComment + ' ' + truncatedMessage);
        if (query && db) {
          const sources = await ragService.findRelevantSourceIds(query);
          if (sources.length > 0) {
            console.log(`[AI] RAG found ${sources.length} sources: ${sources.map(s => `${s.type}#${s.id}`).join(', ')}`);
            ragContext = await fetchFullContent(db, sources);
          }
        }
        if (!ragContext) {
          ragContext = await ragService.buildContext(query);
        }
      } catch (err) {
        console.error('[AI] RAG context failed:', err.message);
      }
    }

    let systemPrompt = `You are GoldieRill, an AI assistant on a public message board.

IMPORTANT RULES:
- Respond in Simplified Chinese.
- Be helpful, insightful, and stay on topic.
- Answer based on the post and comment provided below.`;

    if (ragContext) {
      systemPrompt += `

ADDITIONAL RULES FOR HISTORICAL CONTEXT:
- "Relevant historical posts" below are PUBLIC posts from this board that users chose to share. They are NOT private data. You MUST use them to answer the user's question.
- When a user asks about something that appears in the historical posts (e.g. their 八字, previous discussions, reports), answer directly using that information. The user is asking about their OWN posts.
- NEVER say you cannot access or do not have the information when it is clearly provided in the historical posts below. Read them carefully and use them.

Relevant historical posts from this board:
${ragContext}`;
    }

    const commentSection = truncatedComment
      ? `Comment mentioning you:\n---\n${truncatedComment}\n---\n`
      : '';

    const userPrompt = `Message:
---
${truncatedMessage}
---

${commentSection}Your response:`;

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

// ---------------------------------------------------------------------------
// Portfolio chat: a clean request→response endpoint for the CV site (cv.goldierill.com).
// Reuses RAG retrieval + LLM, but grounds answers on 陈秋锦's resume (always injected)
// plus any knowledge-base posts found via RAG. Does NOT touch the message-board @rag flow.
// ---------------------------------------------------------------------------
async function getChatResponse({ question, history = [], resumeText = '', ragService, db }) {
  const { AI_CHAT_API_URL, AI_CHAT_API_KEY, AI_CHAT_MODEL } = process.env;

  if (!AI_CHAT_API_URL || !AI_CHAT_API_KEY || !AI_CHAT_MODEL) {
    console.error('[Chat] AI_CHAT env vars not configured.');
    return null;
  }

  if (activeAICalls >= MAX_CONCURRENT_AI_CALLS) {
    console.log(`[Chat] Skipping — ${activeAICalls} calls already in progress`);
    return { error: 'busy' };
  }

  activeAICalls++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);

  try {
    const q = cleanQuery(question).substring(0, 2000);
    if (!q) return null;

    // RAG: pull supplementary knowledge-base content (best-effort, never fatal)
    let ragContext = '';
    if (ragService && db) {
      try {
        const sources = await ragService.findRelevantSourceIds(q);
        if (sources.length > 0) {
          console.log(`[Chat] RAG found ${sources.length} sources: ${sources.map(s => `${s.type}#${s.id}`).join(', ')}`);
          ragContext = await fetchFullContent(db, sources);
        }
        if (!ragContext) {
          ragContext = await ragService.buildContext(q);
        }
      } catch (err) {
        console.error('[Chat] RAG context failed:', err.message);
      }
    }

    let systemPrompt = `你是「陈秋锦（Goldie Rill）」个人作品集网站上的 AI 助手，访客通过你了解陈秋锦其人。

规则：
- 用与用户提问相同的语言回答（默认简体中文）。
- 依据下方「简历」与「知识库」回答关于陈秋锦的技能、项目、经历、求职意向等问题。
- 用第三人称称呼他（「他 / 陈秋锦」），语气专业、友好、简洁、自信。
- 只依据简历和知识库作答，不要编造未提及的事实。被问到资料中没有的信息时，诚实说明，并建议通过邮箱 got.money@qq.com 联系他。
- 回答可适当精炼，避免大段照搬简历原文。

=== 简历（主要事实来源）===
${resumeText}`;

    if (ragContext) {
      systemPrompt += `

=== 知识库（来自他的留言板，作为补充资料）===
${ragContext}`;
    }

    const messages = [{ role: 'system', content: systemPrompt }];

    // include a short rolling window of prior turns
    if (Array.isArray(history)) {
      for (const m of history.slice(-8)) {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()) {
          messages.push({ role: m.role, content: m.content.substring(0, 2000) });
        }
      }
    }
    messages.push({ role: 'user', content: q });

    const response = await axios.post(
      AI_CHAT_API_URL,
      { model: AI_CHAT_MODEL, messages },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_CHAT_API_KEY}`,
        },
        timeout: 60000,
        signal: controller.signal,
        maxContentLength: 4 * 1024 * 1024,
        maxBodyLength: 4 * 1024 * 1024,
      }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      console.log(`[Chat] Response size: ${content.length} chars`);
      return content.trim().substring(0, 4000);
    }
    console.error('[Chat] Unexpected LLM response structure:', response.data);
    return null;
  } catch (error) {
    if (axios.isCancel(error) || error.name === 'CanceledError' || error.name === 'AbortError') {
      console.error('[Chat] Request aborted due to timeout');
    } else {
      console.error('[Chat] Error calling LLM API:', error.response ? error.response.data : error.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
    activeAICalls--;
  }
}

module.exports = { getAIResponse, getChatResponse };
