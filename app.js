// --- AUTHENTICATION HELPERS ---

/**
 * A simple "hashing" function for demonstration.
 * IMPORTANT: This is NOT a secure hashing algorithm.
 * In a real application, use a library like bcrypt.
 * @param {string} str The string to "hash".
 * @returns {string} The "hashed" string.
 */
function simpleHash(str) {
    return str.split('').reverse().join('');
}

/**
 * Checks if the user is logged in by looking for a session token.
 * If not found, redirects to the login page.
 */
function checkAuth() {
    const sessionToken = localStorage.getItem('sessionToken');
    const isAuthPage = window.location.pathname.includes('login.html') || window.location.pathname.includes('signup.html');
    
    if (!sessionToken && !isAuthPage) {
        window.location.href = 'login.html';
    }
}

/**
 * Logs the user out by clearing the session token and redirecting to login.
 */
function handleLogout() {
    localStorage.removeItem('sessionToken');
    window.location.href = 'login.html';
}

/**
 * Updates the navigation bar to show user-specific links (e.g., Logout).
 */
function updateNav() {
    const navUl = document.getElementById('nav-list');
    if (!navUl) return;

    const loggedIn = !!localStorage.getItem('sessionToken');
    const path = window.location.pathname;
    const onIndex = path.includes('index.html') || path.endsWith('/AI/') ||
        path.endsWith('/AI') || path === '/';
    const homeClass = onIndex ? 'nav-link is-active' : 'nav-link';

    navUl.innerHTML = loggedIn
        ? `
            <li><a class="${homeClass}" href="index.html">홈</a></li>
            <li><a class="nav-link nav-link--accent" href="create-post.html">새 글 작성</a></li>
            <li><a class="nav-link nav-link--danger" href="#" id="logout-btn">로그아웃</a></li>
        `
        : `
            <li><a class="${homeClass}" href="index.html">홈</a></li>
            <li><a class="nav-link nav-link--accent" href="login.html">로그인</a></li>
        `;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });
    }
}

// --- THEME (light / dark) ---

/**
 * Applies the saved theme (or the system preference) to the document.
 */
function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Wires up the header theme toggle button (if the page has one).
 */
function initThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') === 'dark'
            ? 'dark'
            : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    });
}

// --- RENDERING HELPERS ---

/**
 * Escapes text so user generated content never breaks the markup.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * A short, one line excerpt from a post body.
 * Code fences (```) are stripped so the list preview stays readable.
 * @param {string} content
 * @param {number} length
 * @returns {string}
 */
function makeExcerpt(content, length = 150) {
    const flat = String(content || '')
        .replace(/```[a-zA-Z]*\n?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return flat.length > length ? `${flat.substring(0, length)}…` : flat;
}

/**
 * Rough reading time in minutes for Korean/English mixed text.
 * @param {string} content
 * @returns {number}
 */
function readingTime(content) {
    return Math.max(1, Math.ceil(String(content || '').length / 500));
}

/**
 * Renders a post body as safe HTML.
 * Supports ``` fenced code blocks and paragraph breaks (blank lines).
 * @param {string} content
 * @returns {string}
 */
function renderContent(content) {
    const segments = String(content || '').split(/```([\s\S]*?)```/);

    return segments
        .map((segment, index) => {
            // 홀수 인덱스 = ```로 감싼 코드 블록
            if (index % 2 === 1) {
                let code = escapeHtml(segment).replace(/^\n/, '').replace(/\n$/, '');

                // 첫 줄이 언어 힌트(예: js, python)라면 제거합니다.
                const lines = code.split('\n');
                if (lines.length > 1 && /^[A-Za-z0-9+#_.-]{1,20}$/.test(lines[0].trim())) {
                    lines.shift();
                    code = lines.join('\n');
                }

                return `<pre><code>${code}</code></pre>`;
            }

            const prose = escapeHtml(segment).trim();
            if (!prose) return '';

            return prose
                .split(/\n{2,}/)
                .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
                .join('');
        })
        .join('');
}


// --- MAIN LOGIC ---

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    const isAuthPage = path.includes('login.html') || path.includes('signup.html');

    // 테마는 로그인 여부와 관계없이 모든 페이지에서 초기화합니다.
    initTheme();
    initThemeToggle();

    if (isAuthPage) {
        // --- Logic for Signup Page ---
        if (path.includes('signup.html')) {
            console.log('Signup page detected'); // Debug log
            const signupForm = document.getElementById('signup-form');
            if (signupForm) {
                console.log('Signup form found'); // Debug log
                signupForm.addEventListener('submit', (event) => {
                    event.preventDefault();
                    console.log('Signup form submitted'); // Debug log
                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;
                    
                    let users = JSON.parse(localStorage.getItem('blogUsers')) || [];
                    console.log('Current users:', users); // Debug log
                    
                    if (users.find(u => u.username === username)) {
                        alert('이미 존재하는 사용자 이름입니다.');
                        return;
                    }

                    const newUser = {
                        username,
                        password: simpleHash(password) // Insecure, for demo only!
                    };
                    users.push(newUser);
                    localStorage.setItem('blogUsers', JSON.stringify(users));
                    console.log('User saved:', newUser); // Debug log

                    alert(`회원가입이 완료되었습니다. '${username}'님, 환영합니다! 바로 블로그 메인 페이지로 이동합니다.`);
                    localStorage.setItem('sessionToken', `token-for-${username}`); // Automatically log in
                    window.location.href = 'index.html'; // Redirect to homepage
                });
            } else {
                console.error('Signup form NOT found'); // Debug log
            }
        }

        // --- Logic for Login Page ---
        if (path.includes('login.html')) {
            const loginForm = document.getElementById('login-form');
            if (loginForm) {
                loginForm.addEventListener('submit', (event) => {
                    event.preventDefault();
                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;

                    let users = JSON.parse(localStorage.getItem('blogUsers')) || [];
                    const foundUser = users.find(u => u.username === username && u.password === simpleHash(password));

                    if (foundUser) {
                        localStorage.setItem('sessionToken', `token-for-${username}`);
                        window.location.href = 'index.html';
                    } else {
                        alert('사용자 이름 또는 비밀번호가 잘못되었습니다.');
                    }
                });
            }
        }

    } else {
        // --- Protected Page Logic ---
        checkAuth();
        updateNav();

        // --- Logic for index.html ---
        if (path.includes('index.html') || path.endsWith('/AI/') || path.endsWith('/AI') || path === '/') {
            const postsContainer = document.getElementById('posts-container');
            if (postsContainer) {
                let posts = JSON.parse(localStorage.getItem('blogPosts')) || [];
                // 최신순(내림차순) 정렬: 타임스탬프 기준, 기본은 등록 역순
                posts.reverse();
                posts.sort((a, b) => {
                    const timeA = parseInt((a.id || '').replace('post-', '')) || 0;
                    const timeB = parseInt((b.id || '').replace('post-', '')) || 0;
                    if (timeA && timeB) {
                        return timeB - timeA;
                    }
                    return 0;
                });

                // 히어로 영역 통계 갱신
                const statPosts = document.getElementById('stat-posts');
                const postsCount = document.getElementById('posts-count');
                if (statPosts) statPosts.textContent = posts.length;
                if (postsCount) postsCount.textContent = `${posts.length} articles`;

                postsContainer.innerHTML = '';

                if (posts.length === 0) {
                    postsContainer.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state__icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                                    aria-hidden="true">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                                </svg>
                            </div>
                            <h3>아직 작성된 글이 없어요</h3>
                            <p>첫 번째 글을 작성해 보세요. 배운 것을 기록할 때 더 오래 기억됩니다.</p>
                            <a href="create-post.html" class="btn btn--primary">첫 글 작성하기 →</a>
                        </div>
                    `;
                } else {
                    posts.forEach(post => {
                        const modified = post.lastModified
                            ? `<span class="meta-sep" aria-hidden="true"></span><span class="meta-badge">수정됨</span>`
                            : '';
                        const postPreview = `
                            <article class="post-card" id="${escapeHtml(post.id)}">
                                <div class="post-meta">
                                    <time datetime="${escapeHtml(post.id.replace('post-', ''))}">${escapeHtml(post.date)}</time>
                                    <span class="meta-sep" aria-hidden="true"></span>
                                    <span>by ${escapeHtml(post.author)}</span>
                                    <span class="meta-sep" aria-hidden="true"></span>
                                    <span>${readingTime(post.content)} min read</span>
                                    ${modified}
                                </div>
                                <h2 class="post-card__title">
                                    <a href="dynamic-post.html?id=${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a>
                                </h2>
                                <p class="post-card__excerpt">${escapeHtml(makeExcerpt(post.content))}</p>
                                <div class="post-card__footer">
                                    <a class="read-more" href="dynamic-post.html?id=${encodeURIComponent(post.id)}">더 읽기 →</a>
                                    <div class="card-actions">
                                        <a class="btn btn--ghost btn--sm"
                                            href="edit-post.html?id=${encodeURIComponent(post.id)}">수정</a>
                                    </div>
                                </div>
                            </article>
                        `;
                        postsContainer.insertAdjacentHTML('beforeend', postPreview);
                    });
                }
            }
        }

        // --- Logic for dynamic-post.html ---
        if (path.includes('dynamic-post.html')) {
            const urlParams = new URLSearchParams(window.location.search);
            const postId = urlParams.get('id');

            if (postId) {
                const posts = JSON.parse(localStorage.getItem('blogPosts')) || [];
                const post = posts.find(p => p.id === postId);
                const mainContainer = document.querySelector('main .container');

                if (post && mainContainer) {
                    document.title = `${post.title} — devlog`;

                    const modified = post.lastModified
                        ? `<span class="meta-sep" aria-hidden="true"></span><span class="meta-badge">수정됨 ${escapeHtml(post.lastModified)}</span>`
                        : '';

                    mainContainer.innerHTML = `
                        <article class="post-full">
                            <header>
                                <div class="post-meta">
                                    <span>${escapeHtml(post.date)}</span>
                                    <span class="meta-sep" aria-hidden="true"></span>
                                    <span>by ${escapeHtml(post.author)}</span>
                                    <span class="meta-sep" aria-hidden="true"></span>
                                    <span>${readingTime(post.content)} min read</span>
                                    ${modified}
                                </div>
                                <h1 class="post-full__title">${escapeHtml(post.title)}</h1>
                            </header>
                            <div class="post-full__divider" aria-hidden="true"></div>
                            <div class="post-content">
                                ${renderContent(post.content)}
                            </div>
                            <footer class="post-full__footer">
                                <a class="btn btn--ghost" href="index.html">← 목록으로</a>
                                <a class="btn btn--primary" href="edit-post.html?id=${encodeURIComponent(post.id)}">이 글 수정</a>
                            </footer>
                        </article>
                    `;
                } else if (mainContainer) {
                    mainContainer.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state__icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                                    aria-hidden="true">
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="m21 21-4.3-4.3" />
                                </svg>
                            </div>
                            <h3>게시물을 찾을 수 없습니다</h3>
                            <p>삭제되었거나 잘못된 주소일 수 있어요.</p>
                            <a href="index.html" class="btn btn--primary">목록으로 돌아가기</a>
                        </div>
                    `;
                }
            }
        }
        
        // --- Logic for create-post.html ---
        if (path.includes('create-post.html')) {
            const newPostForm = document.getElementById('new-post-form');
            if (newPostForm) {
                newPostForm.addEventListener('submit', (event) => {
                    event.preventDefault();

                    const title = document.getElementById('post-title').value;
                    const author = document.getElementById('post-author').value || '익명';
                    const content = document.getElementById('post-content').value;
                    const date = new Date().toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const postId = `post-${Date.now()}`;

                    const newPost = { id: postId, title, author, date, content, lastModified: null };

                    let posts = JSON.parse(localStorage.getItem('blogPosts')) || [];
                    posts.push(newPost);
                    localStorage.setItem('blogPosts', JSON.stringify(posts));

                    alert('게시물이 성공적으로 작성되었습니다!');
                    window.location.href = 'index.html';
                });
            }
        }

        // --- Logic for edit-post.html ---
        if (path.includes('edit-post.html')) {
            const urlParams = new URLSearchParams(window.location.search);
            const postId = urlParams.get('id');
            const editForm = document.getElementById('edit-post-form');

            if (postId && editForm) {
                let posts = JSON.parse(localStorage.getItem('blogPosts')) || [];
                const post = posts.find(p => p.id === postId);

                if (post) {
                    document.getElementById('post-id').value = post.id;
                    document.getElementById('post-title').value = post.title;
                    document.getElementById('post-content').value = post.content;

                    editForm.addEventListener('submit', (event) => {
                        event.preventDefault();
                        const updatedTitle = document.getElementById('post-title').value;
                        const updatedContent = document.getElementById('post-content').value;
                        const lastModified = new Date().toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

                        const postIndex = posts.findIndex(p => p.id === postId);
                        if (postIndex > -1) {
                            posts[postIndex].title = updatedTitle;
                            posts[postIndex].content = updatedContent;
                            posts[postIndex].lastModified = lastModified;
                        }

                        localStorage.setItem('blogPosts', JSON.stringify(posts));
                        alert('게시물이 성공적으로 수정되었습니다!');
                        window.location.href = `dynamic-post.html?id=${postId}`;
                    });
                } else {
                    document.querySelector('main .container').innerHTML = `
                        <div class="empty-state">
                            <h3>수정할 게시물을 찾을 수 없습니다</h3>
                            <a href="index.html" class="btn btn--primary">목록으로 돌아가기</a>
                        </div>
                    `;
                }
            }
        }
    }
});