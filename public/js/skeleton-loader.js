// Skeleton loading cards + top progress bar for initial page load

let _bar = null;
let _intervalId = null;
let _progress = 0;

const _setWidth = (pct) => {
    _progress = Math.min(pct, 100);
    if (_bar) _bar.style.width = _progress + '%';
};

export const startProgressBar = () => {
    if (_bar) return;
    _bar = document.createElement('div');
    _bar.id = 'hb-progress-bar';
    document.body.appendChild(_bar);

    // Quick burst to 25%, then creep slowly toward 72%
    setTimeout(() => _setWidth(25), 60);
    setTimeout(() => _setWidth(42), 250);
    _intervalId = setInterval(() => {
        if (_progress < 72) {
            _setWidth(_progress + Math.random() * 2.5 + 0.5);
        } else {
            clearInterval(_intervalId);
            _intervalId = null;
        }
    }, 500);
};

export const completeProgressBar = () => {
    if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
    _setWidth(100);
    setTimeout(() => {
        if (_bar) { _bar.style.opacity = '0'; }
        setTimeout(() => { _bar?.remove(); _bar = null; }, 350);
    }, 180);
};

const _skeletonLine = (widthPct, height = 10, mb = 5) =>
    `<span class="skeleton-line" style="width:${widthPct}%;height:${height}px;margin-bottom:${mb}px;border-radius:0;"></span>`;

const _createSkeletonCard = () => {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            ${_skeletonLine(18, 9, 0)}
            ${_skeletonLine(12, 9, 0)}
        </div>
        ${_skeletonLine(95, 10, 5)}
        ${_skeletonLine(88, 10, 5)}
        ${_skeletonLine(70, 10, 5)}
        ${_skeletonLine(50, 10, 0)}
        <div class="skeleton-footer">
            ${_skeletonLine(8, 18, 0)}
            ${_skeletonLine(8, 18, 0)}
            ${_skeletonLine(10, 18, 0)}
        </div>
    `;
    return card;
};

export const showSkeletonCards = (count = 3) => {
    const list = document.getElementById('message-list');
    if (!list) return;
    list.innerHTML = '';
    for (let i = 0; i < count; i++) {
        list.appendChild(_createSkeletonCard());
    }
};
