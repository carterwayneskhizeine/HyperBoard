import {
    initAuthHandlers
} from './auth-handlers.js';
import {
    initEventListeners
} from './initial-setup.js';
import {
    fetchAndRenderMessages
} from './api-rendering-logic.js';
import {
    parseURLParams
} from './pagination.js';
import { initSearchHandler } from './search-handler.js';
import { initHeaderScroll } from './header-scroll.js';
import { initDragDropUpload } from './drag-drop-upload.js';
import './comment-styles.js';
import { startProgressBar, showSkeletonCards } from './skeleton-loader.js';

// Show skeleton immediately — before DOMContentLoaded fires for the message list
// (the message list div is already in the DOM at parse time)
showSkeletonCards(3);
startProgressBar();

document.addEventListener('DOMContentLoaded', () => {
    console.log("Application initializing...");

    // 0. Initialize header scroll behavior
    initHeaderScroll();

    // 1. 解析URL参数
    parseURLParams();

    // 2. 检查认证状态并获取初始消息
    fetchAndRenderMessages().catch(error => {
        console.error('Error fetching initial messages:', error);
    });

    // 3. 绑定认证UI事件
    initAuthHandlers();

    // 4. 绑定所有其他的UI事件监听器
    initEventListeners();

    // 5. 初始化拖拽上传功能
    initDragDropUpload();

    // 6. 绑定搜索事件
    initSearchHandler();

    console.log("Application initialized successfully using ES Modules.");
});