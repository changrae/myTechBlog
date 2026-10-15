(() => {
    const saved = localStorage.getItem('theme');
    document.documentElement.setAttribute('data-theme', saved ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    const button = document.getElementById('refresh-posts');
    const status = document.getElementById('automation-status');
    const list = document.getElementById('published-list');
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    async function refresh() {
        button.disabled = true;
        status.textContent = '게시 결과를 확인하고 있습니다…';
        try {
            const {feed, stale} = await PublishedPosts.load();
            const posts = [...feed.posts].sort((a, b) => b.createdAt - a.createdAt);
            document.getElementById('published-count').textContent = posts.length + ' articles';
            if (stale) {
                status.textContent = '최신 게시 파일을 불러오지 못했습니다. HTTP 서버 연결을 확인하세요.' +
                    (posts.length ? ' 마지막으로 저장된 결과를 표시합니다.' : '');
            } else if (!posts.length) {
                status.textContent = '아직 자동 게시된 글이 없습니다. 아래 설정 안내와 Actions 실행 기록을 확인하세요.';
            } else {
                const last = feed.lastRun;
                status.textContent = '마지막 발행: ' + new Date(feed.updatedAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) +
                    ' (한국 시간)' + (last ? ' · ' + (last.sortBy === 'daily' ? '오늘 증가 Star' : '누적 Star') + ' 기준 · ' + last.count + '편' : '');
            }
            list.innerHTML = posts.slice(0, 20).map(post => {
                const repo = post.repository || {};
                return `<article class="post-card">
                    <div class="post-meta"><span class="meta-badge">자동 게시</span><span>${escape(post.publicationDay)}</span>
                        <span>★ ${escape(Number(repo.stars || 0).toLocaleString('ko-KR'))}</span></div>
                    <h3 class="post-card__title"><a href="dynamic-post.html?id=${encodeURIComponent(post.id)}">${escape(post.title)}</a></h3>
                    <p class="post-card__excerpt">${escape(repo.name)} · ${escape(repo.description)}</p>
                    <div class="post-card__footer"><a class="read-more" href="dynamic-post.html?id=${encodeURIComponent(post.id)}">요약 글 읽기 →</a></div>
                </article>`;
            }).join('') || '<div class="empty-state"><h3>첫 번째 자동 게시를 기다리고 있어요</h3><p>발행이 완료되면 이곳과 블로그 글 목록에 함께 표시됩니다.</p></div>';
        } finally {
            button.disabled = false;
        }
    }
    button.addEventListener('click', refresh);
    refresh();
})();
