import {
    currentPage,
    totalPages,
    currentPrivateKey,
    currentUser,
    isPrivateFilterMode,
    currentFeedType,
    setCurrentPage,
    setTotalPages,
    setCurrentPrivateKey,
    setMessages
} from './state.js';
import {
    privateKeyInput,
    messageList,
    errorMessage
} from './ui-elements.js';
import {
    paginationContainer
} from './ui-elements.js';
import {
    checkAuthStatus
} from './utils.js';
import {
    renderMessage
} from './main-rendering-function.js';
import {
    loadCommentsForMessage
} from './comment-loader.js';
import {
    renderPagination,
    updateURL
} from './pagination.js';
import {
    completeProgressBar
} from './skeleton-loader.js';


// Main function to fetch and render messages from the API
export const fetchAndRenderMessages = async (page = 1) => {

    try {
        // 更新当前页码
        setCurrentPage(page);

        // 获取当前输入的 private key
        setCurrentPrivateKey(privateKeyInput.value.trim());

        // 构建 URL
        let url;
        if (currentFeedType === 'trending') {
            url = `/api/messages/trending?page=${page}&limit=5`;
        } else if (currentFeedType === 'liked') {
            url = `/api/messages/liked?page=${page}&limit=5`;
        } else {
            url = `/api/messages?page=${page}&limit=5`;
            if (currentFeedType && currentFeedType !== 'latest') {
                url += `&type=${currentFeedType}`;
            }
        }

        if (currentPrivateKey) {
            url += `&privateKey=${encodeURIComponent(currentPrivateKey)}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch messages.');

        const data = await response.json();
        setMessages(data.messages || []);
        setTotalPages(data.pagination ? data.pagination.totalPages : 1);


        // 更新用户状态（如果API返回了userId）
        if (data.userId && !currentUser) {
            // 如果API返回了userId但前端不知道，重新检查认证状态
            await checkAuthStatus();
        }

        completeProgressBar();

        // 渲染消息
        messageList.innerHTML = '';
        (data.messages || []).forEach(message => {
            // 在私有过滤模式下，只显示私有消息
            if (isPrivateFilterMode && currentPrivateKey) {
                if (message.is_private === 1) {
                    messageList.appendChild(renderMessage(message));
                    // 自动加载评论
                    loadCommentsForMessage(message.id);
                }
            } else {
                messageList.appendChild(renderMessage(message));
                // 自动加载评论
                loadCommentsForMessage(message.id);
            }
        });

        // 在私有过滤模式下，隐藏分页控件
        if (isPrivateFilterMode && currentPrivateKey) {
            paginationContainer.innerHTML = '';
        } else {
            // 渲染分页控件
            renderPagination();
        }

        // 错误提示处理
        if (currentPrivateKey) {
            // 使用后端返回的 hasPrivateMessages 标志，如果不存在则回退到前端检查
            const hasPrivateMessages = data.hasPrivateMessages !== undefined ?
                data.hasPrivateMessages :
                (data.messages || []).some(m => m.is_private === 1);

            if (!hasPrivateMessages) {
                errorMessage.textContent = 'No matching message found';
                errorMessage.classList.remove('hidden');
            } else {
                errorMessage.classList.add('hidden');
            }
        } else {
            errorMessage.classList.add('hidden');
        }

        // 更新URL状态
        updateURL();
    } catch (error) {
        completeProgressBar();
        console.error('Error:', error);
        messageList.innerHTML = '<p class="text-red-500 text-center">Could not load messages.</p>';
        errorMessage.classList.add('hidden');
    }
};

export const fetchAndRenderSearchResults = async (query, page = 1) => {
    if (!query || query.trim() === '') {
        // If query is empty, just fetch the latest messages
        await fetchAndRenderMessages(1);
        return;
    }

    try {
        setCurrentPage(page);

        const url = `/api/search?q=${encodeURIComponent(query)}&page=${page}&limit=5`;
        const response = await fetch(url);

        if (!response.ok) throw new Error('Failed to fetch search results.');

        const data = await response.json();
        setMessages(data.messages || []);
        setTotalPages(data.pagination.totalPages || 1);

        // Render results
        messageList.innerHTML = '';
        if (data.messages.length === 0) {
            messageList.innerHTML = `<p class="text-center text-gray-500 text-sm">No results found for "${data.searchQuery}"</p>`;
        } else {
            data.messages.forEach(message => {
                messageList.appendChild(renderMessage(message));
                loadCommentsForMessage(message.id);
            });
        }

        // Render pagination for search results
        renderPagination(async (newPage) => {
            await fetchAndRenderSearchResults(query, newPage);
        });

    } catch (error) {
        console.error('Error fetching search results:', error);
        messageList.innerHTML = '<p class="text-red-500 text-center">Could not load search results.</p>';
    }
};