import { loadCommentsForMessage } from './comment-loader.js';

const FIRST_POLL_DELAY = 5000;  // wait 5s before first check (AI takes time)
const POLL_INTERVAL    = 3500;  // then poll every 3.5s
const MAX_POLLS        = 22;    // ~82s total before giving up
const AI_USERNAME      = 'GoldieRill';

// messageId → { intervalId, knownIds: Set, count }
const _polls = new Map();

const _flatten = (comments) => {
    const out = [];
    const walk = (list) => list.forEach(c => {
        out.push(c);
        if (c.replies?.length) walk(c.replies);
    });
    walk(comments || []);
    return out;
};

const _knownAIIds = (messageId) => {
    const el = document.getElementById(`comments-for-${messageId}`);
    const cached = el?.dataset.comments ? JSON.parse(el.dataset.comments) : [];
    return new Set(_flatten(cached).filter(c => c.username === AI_USERNAME).map(c => c.id));
};

export const startAIReplyPoll = (messageId) => {
    if (_polls.has(messageId)) return;

    const knownIds = _knownAIIds(messageId);
    const state = { intervalId: null, knownIds, count: 0 };
    _polls.set(messageId, state);

    _showWaitingIndicator(messageId);

    const check = async () => {
        state.count++;
        if (state.count > MAX_POLLS) {
            stopAIReplyPoll(messageId);
            _removeWaitingIndicator(messageId);
            return;
        }
        try {
            const resp = await fetch(`/api/comments?messageId=${messageId}&page=1&limit=50`);
            if (!resp.ok) return;
            const { comments } = await resp.json();
            const newAI = _flatten(comments).filter(
                c => c.username === AI_USERNAME && !state.knownIds.has(c.id)
            );
            if (newAI.length > 0) {
                stopAIReplyPoll(messageId);
                _removeWaitingIndicator(messageId);
                _showBanner(messageId, newAI[0]);
            }
        } catch { /* network hiccup, retry next tick */ }
    };

    // First check after delay, then repeat
    setTimeout(() => {
        if (!_polls.has(messageId)) return;
        check();
        state.intervalId = setInterval(check, POLL_INTERVAL);
    }, FIRST_POLL_DELAY);
};

export const stopAIReplyPoll = (messageId) => {
    const s = _polls.get(messageId);
    if (!s) return;
    if (s.intervalId) clearInterval(s.intervalId);
    _polls.delete(messageId);
};

// ── Waiting indicator (shown inside comment form area) ──────────────────────

const _waitingId = (messageId) => `ai-waiting-${messageId}`;

const _showWaitingIndicator = (messageId) => {
    const container = document.getElementById(`comments-for-${messageId}`);
    if (!container) return;
    const existing = document.getElementById(_waitingId(messageId));
    if (existing) return;

    const el = document.createElement('div');
    el.id = _waitingId(messageId);
    el.className = 'ai-waiting-indicator';
    el.style.cssText = 'padding: 6px 0 2px 4px;';
    el.innerHTML = `
        <span class="ai-notify-icon">&#x1F916;</span>
        <span>GoldieRill is thinking<span class="ai-waiting-dots"></span></span>
    `;
    container.appendChild(el);
};

const _removeWaitingIndicator = (messageId) => {
    document.getElementById(_waitingId(messageId))?.remove();
};

// ── Notification banner (Twitter/X style) ───────────────────────────────────

const _bannerId = (messageId) => `ai-notify-${messageId}`;

const _showBanner = (messageId, aiComment) => {
    document.getElementById(_bannerId(messageId))?.remove();

    const banner = document.createElement('div');
    banner.id = _bannerId(messageId);
    banner.className = 'ai-reply-notify';
    banner.innerHTML = `
        <span class="ai-notify-icon">&#x1F916;</span>
        <span>GoldieRill replied &mdash; click to jump there &darr;</span>
        <button class="ai-notify-close" title="Dismiss">&#x2715;</button>
    `;

    document.body.appendChild(banner);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => banner.classList.add('ai-notify-visible'));
    });

    const dismiss = () => {
        banner.classList.remove('ai-notify-visible');
        setTimeout(() => banner.remove(), 300);
    };

    banner.querySelector('.ai-notify-close').addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
    });

    banner.addEventListener('click', async () => {
        dismiss();
        await loadCommentsForMessage(messageId, 1, true);
        setTimeout(() => {
            const target = document.querySelector(`[data-comment-id="${aiComment.id}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('ai-comment-highlight');
                setTimeout(() => target.classList.remove('ai-comment-highlight'), 2200);
            } else {
                document.querySelector(`[data-message-id="${messageId}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 350);
    });

    // Auto-dismiss after 30s
    setTimeout(dismiss, 30000);
};
