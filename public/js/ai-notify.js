// Dynamic import used to avoid circular dependency:
// comment-section-renderer → ai-notify → comment-loader → comment-section-renderer
const _getLoader = () => import('./comment-loader.js').then(m => m.loadCommentsForMessage);

const FIRST_POLL_DELAY = 5000;
const POLL_INTERVAL    = 3500;
const MAX_POLLS        = 22;
const AI_USERNAME      = 'GoldieRill';

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

    _showWaitingBanner(messageId);

    const check = async () => {
        state.count++;
        if (state.count > MAX_POLLS) {
            stopAIReplyPoll(messageId);
            _removeBanner(_waitingId(messageId));
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
                _removeBanner(_waitingId(messageId));
                _showReplyBanner(messageId, newAI[0]);
            }
        } catch { /* network hiccup */ }
    };

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

// ── Shared inline style for all banners ─────────────────────────────────────

const _BASE_STYLE = {
    position:   'fixed',
    top:        '58px',
    left:       '50%',
    transform:  'translateX(-50%)',
    zIndex:     '99999',
    display:    'flex',
    alignItems: 'center',
    gap:        '10px',
    padding:    '6px 14px',
    fontSize:   '11px',
    fontFamily: 'Tahoma, Verdana, Arial, sans-serif',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
    boxShadow:  '2px 2px 0 #000000',
    border:     '2px solid',
    color:      '#FFFFFF',
};

const _applyStyle = (el, extra) => Object.assign(el.style, _BASE_STYLE, extra);

const _waitingId = (id) => `ai-waiting-${id}`;
const _bannerId  = (id) => `ai-notify-${id}`;

const _removeBanner = (id) => document.getElementById(id)?.remove();

// ── Waiting indicator ────────────────────────────────────────────────────────

const _showWaitingBanner = (messageId) => {
    _removeBanner(_waitingId(messageId));

    const el = document.createElement('div');
    el.id = _waitingId(messageId);
    _applyStyle(el, {
        background:   '#808080',
        borderColor:  '#DFDFDF #606060 #606060 #DFDFDF',
        cursor:       'default',
    });

    // Animated dots via JS so there's no CSS dependency
    let dots = 0;
    const span = document.createElement('span');
    span.textContent = 'GoldieRill is thinking.';
    el.appendChild(span);
    const timer = setInterval(() => {
        dots = (dots + 1) % 4;
        span.textContent = 'GoldieRill is thinking' + '.'.repeat(dots || 1);
    }, 400);
    el._dotTimer = timer;

    document.body.appendChild(el);
};

// ── Reply notification banner ────────────────────────────────────────────────

const _showReplyBanner = (messageId, aiComment) => {
    _removeBanner(_bannerId(messageId));

    const banner = document.createElement('div');
    banner.id = _bannerId(messageId);
    _applyStyle(banner, {
        background:  '#000080',
        borderColor: '#4444CC #000033 #000033 #4444CC',
        cursor:      'pointer',
    });

    const text = document.createElement('span');
    text.textContent = 'GoldieRill replied — click to jump there ↓';
    banner.appendChild(text);

    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
        background:  'none',
        border:      '1px solid rgba(255,255,255,0.4)',
        color:       '#fff',
        fontSize:    '9px',
        cursor:      'pointer',
        padding:     '1px 4px',
        fontFamily:  'inherit',
    });
    closeBtn.textContent = '✕';
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);

    const dismiss = () => banner.remove();

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });

    banner.addEventListener('click', async () => {
        dismiss();
        const loadComments = await _getLoader();
        await loadComments(messageId, 1, true);
        setTimeout(() => {
            const target = document.querySelector(`[data-comment-id="${aiComment.id}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.style.transition = 'background-color 0.3s ease';
                target.style.backgroundColor = '#FFFF80';
                setTimeout(() => { target.style.backgroundColor = ''; }, 2000);
            } else {
                document.querySelector(`[data-message-id="${messageId}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 350);
    });

    setTimeout(dismiss, 30000);
};
