// Shows a manual "refresh" button on a message card while waiting for an AI reply.
// Uses only inline styles — no CSS class dependency.
// Uses dynamic import for comment-loader to avoid circular deps.

const _flatten = (list) =>
    (list || []).flatMap(c => [c, ..._flatten(c.replies)]);

export const showAIRefreshButton = (messageId) => {
    const btnId = `ai-refresh-${messageId}`;
    if (document.getElementById(btnId)) return;

    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    const btn = document.createElement('button');
    btn.id = btnId;
    btn.type = 'button';

    const _setLabel = (text) => { btn.textContent = text; };
    _setLabel('↻ Waiting for GoldieRill... (click to refresh)');

    Object.assign(btn.style, {
        display:     'block',
        width:       '100%',
        textAlign:   'center',
        padding:     '4px 6px',
        marginTop:   '6px',
        fontSize:    '10px',
        fontFamily:  'Tahoma, Verdana, Arial, sans-serif',
        fontWeight:  'bold',
        color:       '#000080',
        background:  '#C0C0C0',
        border:      '2px outset #DFDFDF',
        cursor:      'pointer',
        boxSizing:   'border-box',
        boxShadow:   '1px 1px 0 #000',
    });

    btn.addEventListener('click', async () => {
        _setLabel('↻ Refreshing...');
        btn.disabled = true;
        btn.style.opacity = '0.6';

        try {
            const { loadCommentsForMessage } = await import('./comment-loader.js');
            await loadCommentsForMessage(messageId, 1, true);

            const container = document.getElementById(`comments-for-${messageId}`);
            const cached = container?.dataset.comments
                ? JSON.parse(container.dataset.comments) : [];
            const all = _flatten(cached);
            const aiComment = all.find(c => c.username === 'GoldieRill');

            if (aiComment) {
                btn.remove();
                setTimeout(() => {
                    const el = document.querySelector(`[data-comment-id="${aiComment.id}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.style.transition = 'background-color 0.3s ease';
                        el.style.backgroundColor = '#FFFF80';
                        setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
                    }
                }, 150);
            } else {
                _setLabel('↻ No reply yet — click to refresh');
                btn.style.opacity = '1';
                btn.disabled = false;
            }
        } catch (e) {
            _setLabel('↻ Error — click to retry');
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    });

    // Place the button between the message footer and the comments container
    const commentsContainer = document.getElementById(`comments-for-${messageId}`);
    if (commentsContainer && commentsContainer.parentNode === messageEl) {
        messageEl.insertBefore(btn, commentsContainer);
    } else {
        messageEl.appendChild(btn);
    }
};
