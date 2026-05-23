import {
    createCommentElement
} from './comment-element.js';
import {
    handlePostComment
} from './comment-post.js';
import {
    handleLike
} from './comment-vote.js';
import {
    handleEditComment
} from './comment-edit.js';
import {
    handleDeleteComment
} from './comment-delete.js';
import {
    handleReply
} from './reply-handler.js';
import {
    createStackEditButton
} from './utils.js';
import {
    startAIReplyPoll
} from './ai-notify.js';

/**
 * Flattens the nested comment structure into a sorted, flat list for rendering.
 */
const flattenAndSortComments = (comments) => {
    const commentMap = new Map();
    const repliesMap = new Map();

    function processComments(commentList, parentId = null) {
        commentList.forEach(comment => {
            comment.parentId = parentId;
            commentMap.set(comment.id, comment);

            if (parentId) {
                if (!repliesMap.has(parentId)) {
                    repliesMap.set(parentId, []);
                }
                repliesMap.get(parentId).push(comment);
            }

            if (comment.replies && comment.replies.length > 0) {
                processComments(comment.replies, comment.id);
            }
        });
    }

    processComments(comments);

    const topLevelComments = comments.sort((a, b) => new Date(a.time) - new Date(b.time));

    const flatComments = [];
    const addedComments = new Set();

    function addCommentWithReplies(comment) {
        if (addedComments.has(comment.id)) return;

        flatComments.push(comment);
        addedComments.add(comment.id);

        const childReplies = repliesMap.get(comment.id);
        if (childReplies) {
            childReplies.sort((a, b) => new Date(a.time) - new Date(b.time));
            childReplies.forEach(reply => {
                addCommentWithReplies(reply);
            });
        }
    }

    topLevelComments.forEach(comment => {
        addCommentWithReplies(comment);
    });

    return {
        flatComments,
        commentMap
    };
};


// Render the complete comment section structure
export const renderCommentSection = (container, messageId, comments, pagination) => {
    container.innerHTML = '';

    const {
        flatComments,
        commentMap
    } = flattenAndSortComments(comments);

    // 1. Comments List
    const commentsListContainer = document.createElement('div');
    commentsListContainer.className = 'comments-list';

    if (flatComments.length > 0) {
        flatComments.forEach(comment => {
            commentsListContainer.appendChild(createCommentElement(comment, messageId, comment.parentId, commentMap));
        });
    }
    container.appendChild(commentsListContainer);

    let commentForm = null;

    // 2. Comment Form and Toggle Button
    if (true) {
        const formContainer = document.createElement('div');
        formContainer.className = 'mt-4';

        commentForm = document.createElement('form');
        commentForm.className = `flex flex-col gap-2 hidden`;
        commentForm.innerHTML = `
            <textarea
                class="input-bp min-h-[60px] text-xs"
                rows="2"
                placeholder="Add a comment..."></textarea>
            <div class="flex justify-end gap-2" id="comment-form-actions">
                <button type="submit" class="btn-bp-primary text-xs py-1 px-4">
                    Post Comment
                </button>
            </div>
            <div class="comment-error-message hidden text-red-800 text-center font-bold p-2 bg-[#FFC0C0] text-xs" style="border: 2px inset #808080;" role="alert"></div>
        `;

        const textarea = commentForm.querySelector('textarea');
        const actionsContainer = commentForm.querySelector('#comment-form-actions');
        const postBtn = actionsContainer.querySelector('button[type="submit"]');

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-bp-outline text-xs py-1 px-4 comment-cancel-btn';
        cancelBtn.textContent = 'Cancel';
        actionsContainer.insertBefore(cancelBtn, postBtn);

        const stackeditBtn = createStackEditButton(textarea, commentForm);
        actionsContainer.insertBefore(stackeditBtn, cancelBtn);

        const toggleFormButton = document.createElement('button');
        toggleFormButton.className = 'btn-bp-icon ml-auto text-xs font-bold text-gray-600';
        toggleFormButton.title = 'Post a new comment';
        toggleFormButton.textContent = '[+]';

        toggleFormButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isFormVisible = !commentForm.classList.contains('hidden');

            if (isFormVisible) {
                commentForm.classList.add('hidden');
                commentForm.querySelector('textarea').value = '';
            } else {
                commentForm.classList.remove('hidden');
                commentForm.querySelector('textarea').focus();
            }
        });

        commentForm.querySelector('.comment-cancel-btn').addEventListener('click', (e) => {
            e.preventDefault();
            commentForm.classList.add('hidden');
            commentForm.querySelector('textarea').value = '';
        });

        const lastCommentElement = commentsListContainer.lastChild;
        if (lastCommentElement) {
            const lastActionsElement = lastCommentElement.querySelector('div.flex.items-center.gap-2.text-\\[10px\\]');
            if (lastActionsElement) {
                lastActionsElement.appendChild(toggleFormButton);
            } else {
                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'flex items-center gap-2 text-[10px]';
                actionsContainer.appendChild(toggleFormButton);
                lastCommentElement.appendChild(actionsContainer);
            }

            lastCommentElement.parentNode.insertBefore(commentForm, lastCommentElement.nextSibling);
        } else {
            const actionsContainer = document.createElement('div');
            actionsContainer.className = 'flex items-center gap-2 text-[10px]';
            actionsContainer.appendChild(toggleFormButton);
            commentsListContainer.appendChild(actionsContainer);

            commentsListContainer.appendChild(commentForm);
        }
    }

    // 3. Comments Pagination
    const commentsPaginationContainer = document.createElement('div');
    commentsPaginationContainer.className = 'comments-pagination-container mt-3 text-xs text-gray-500 text-center';
    if (pagination && pagination.totalPages > 1) {
        const paginationElement = document.createElement('div');
        paginationElement.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
        commentsPaginationContainer.appendChild(paginationElement);
    }
    container.appendChild(commentsPaginationContainer);

    // 4. Form submit handler
    if (commentForm) {
        commentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = commentForm.querySelector('textarea');
            const errorDiv = commentForm.querySelector('.comment-error-message');

            const hadAIMention = await handlePostComment(messageId, null, input, errorDiv);
            if (hadAIMention) startAIReplyPoll(messageId);
        });
    }

    // 5. Delegated event listeners
    commentsListContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        const button = e.target.closest('button');
        if (!button) return;

        const action = button.dataset.action;
        const commentId = button.dataset.id;

        if (action === 'like') {
            handleLike(commentId, messageId);
        } else if (action === 'edit') {
            handleEditComment(commentId, messageId, commentsListContainer);
        } else if (action === 'delete') {
            handleDeleteComment(commentId, messageId);
        } else if (action === 'reply') {
            const commentElement = button.closest('[data-comment-id]');
            handleReply(commentId, messageId, commentElement);
        } else if (action === 'copy') {
            const commentElement = button.closest('[data-comment-id]');
            const rawText = commentElement?.querySelector('.raw-comment-text');
            if (rawText && navigator.clipboard) {
                navigator.clipboard.writeText(rawText.textContent.trim())
                    .then(() => {
                        const original = button.innerHTML;
                        button.innerHTML = '<span style="font-size:50%">Copied!</span>';
                        setTimeout(() => { button.innerHTML = original; }, 1500);
                    })
                    .catch(err => console.error('Failed to copy comment:', err));
            }
        }
    });
};
