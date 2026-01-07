/**
 * 声家 (coeya) 統合スクリプト - 最終完成版
 * 機能：階層自動判定、年号更新、メニュー制御、強化版自作スクロール、ニュース読み込み
 */
(function() {
    // 1. パス・階層判定
    const isLocal = window.location.hostname === 'localhost';
    const path = window.location.pathname;
    const segments = path.split('/').filter(p => p !== '' && !p.includes('.html'));
    const effectiveSegments = isLocal && segments[0] === 'coeya' ? segments.slice(1) : segments;
    const ROOT_REL = '../'.repeat(effectiveSegments.length);

    document.addEventListener('DOMContentLoaded', () => {
        
        // --- 2. 強化版スムーズスクロール (ロゴ・トップ戻り対応) ---
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                const targetId = this.getAttribute('href');
                
                // ターゲット要素を特定（# だけ、または #mainHeader なら最上部を目指す）
                const targetElement = (targetId === '#' || targetId === '#mainHeader') 
                                      ? document.body 
                                      : document.querySelector(targetId);
                
                if (targetElement) {
                    e.preventDefault();
                    
                    const startPosition = window.pageYOffset;
                    const headerHeight = 70; 
                    
                    // 目的地計算：トップに戻る時は 0、それ以外は要素位置 - ヘッダー高
                    let targetPosition = 0;
                    if (targetId !== '#' && targetId !== '#mainHeader') {
                        targetPosition = targetElement.getBoundingClientRect().top + startPosition - headerHeight;
                    }
                    
                    const distance = targetPosition - startPosition;
                    const duration = 800; // スクロール速度（ミリ秒）
                    let start = null;

                    function step(timestamp) {
                        if (!start) start = timestamp;
                        const progress = timestamp - start;
                        const run = easeInOutQuad(progress, startPosition, distance, duration);
                        window.scrollTo(0, run);
                        if (progress < duration) window.requestAnimationFrame(step);
                    }

                    function easeInOutQuad(t, b, c, d) {
                        t /= d / 2;
                        if (t < 1) return c / 2 * t * t + b;
                        t--;
                        return -c / 2 * (t * (t - 2) - 1) + b;
                    }
                    window.requestAnimationFrame(step);

                    // メニューが開いていたら閉じる
                    if (nav && nav.classList.contains('open')) {
                        nav.classList.remove('open');
                        if (icon) icon.className = 'fas fa-bars';
                    }
                }
            });
        });

        // --- 3. 年号自動更新 ---
        const yearEl = document.getElementById('year');
        if (yearEl) yearEl.innerText = new Date().getFullYear();

        // --- 4. ハンバーガーメニュー制御 ---
        const toggler = document.getElementById('menuToggle');
        const nav = document.getElementById('mainNav');
        const icon = toggler ? toggler.querySelector('i') : null;

        if (toggler && nav) {
            toggler.onclick = (e) => {
                e.stopPropagation();
                const isOpen = nav.classList.toggle('open');
                if (icon) icon.className = isOpen ? 'fas fa-times' : 'fas fa-bars';
            };
            document.onclick = () => {
                nav.classList.remove('open');
                if (icon) icon.className = 'fas fa-bars';
            };
        }

        // --- 5. ニュース動的読み込み (news/news.json) ---
        const activeContainer = document.getElementById('news-container') || document.getElementById('all-news-container');
        if (activeContainer) {
            fetch(ROOT_REL + 'news/news.json')
                .then(res => {
                    if (!res.ok) throw new Error('Network response was not ok');
                    return res.json();
                })
                .then(data => {
                    const isTop = !!document.getElementById('news-container');
                    const displayData = isTop ? data.slice(0, 2) : data;
                    let html = '';
                    displayData.forEach(item => {
                        let link = item.link;
                        if (link) {
                            link = path.includes('/news/') ? link.replace('news/', '') : ROOT_REL + link;
                        }
                        const tag = link ? 'a' : 'div';
                        const href = link ? `href="${link}"` : '';
                        html += `
                            <${tag} ${href} class="list-group-item list-group-item-action p-4 border-bottom text-decoration-none text-dark">
                                <div class="d-flex w-100 justify-content-between align-items-center mb-2">
                                    <span class="badge ${item.badgeClass || 'bg-secondary'} rounded-pill px-3">${item.category}</span>
                                    <small class="text-muted">${item.date}</small>
                                </div>
                                <h5 class="fw-bold mb-1">${item.title}</h5>
                                <p class="mb-0 small text-muted">${item.content}</p>
                            </${tag}>`;
                    });
                    activeContainer.innerHTML = html;
                })
                .catch(err => {
                    console.error("News Load Error:", err);
                    activeContainer.innerHTML = '<p class="text-center py-4 text-muted">お知らせを読み込めませんでした。</p>';
                });
        }
    });
})();