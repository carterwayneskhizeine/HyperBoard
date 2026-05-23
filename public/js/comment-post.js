import {
    loadCommentsForMessage
} from './comment-loader.js';
import {
    startAIReplyPoll
} from './ai-notify.js';

const _mentionsAI = (text) =>
    /@goldierill/i.test(text) || /@rag\b/i.test(text);

// Handle posting a new comment (top-level or reply)
export const handlePostComment = async (messageId, parentId, inputElement, errorElement) => {
    const content = inputElement.value.trim();
    if (!content) {
        errorElement.textContent = 'Comment cannot be empty.';
        errorElement.classList.remove('hidden');
        return;
    }

    const hasAIMention = _mentionsAI(content);

    try {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messageId,
                pid: parentId,
                text: content
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to post comment');
        }

        inputElement.value = '';
        errorElement.classList.add('hidden');

        // 不再刷新页面，直接重新加载该消息的评论
        await loadCommentsForMessage(messageId, 1, true); // Force refresh

        // Start polling for AI reply if the comment mentioned @goldierill or @rag
        if (hasAIMention) {
            startAIReplyPoll(messageId);
        }

    } catch (error) {
        console.error('Error posting comment:', error);
        errorElement.textContent = error.message;
        errorElement.classList.remove('hidden');
    }
};