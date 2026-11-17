// devlog front-end. 글과 계정은 Supabase(PostgreSQL + Auth)에 저장됩니다.
// 권한은 브라우저가 아니라 DB의 RLS 정책(supabase/schema.sql)이 강제합니다.

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;
const POST_COLUMNS = 'id,title,content,author_name,author_id,source,metadata,created_at,updated_at';
const LEGACY_POSTS_KEY = 'blogPosts';
const LEGACY_BACKUP_KEY = 'blogPostsImported';
const DATE_FORMAT = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };

// --- SUPABASE ---

/**
 * Creates the Supabase client, or returns null when the SDK or the
 * project settings in supabase-config.js are missing.
 */
function createDbClient() {
    const config = window.SUPABASE_CONFIG || {};
    // 대시보드에서 REST 주소(…/rest/v1/)를 복사해 넣어도 동작하도록 프로젝트 기본 주소로 정리합니다.
    const url = typeof config.url === 'string'
        ? config.url.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '')
        : '';
    const configured = /^https:\/\/[^/]+$/.test(url) &&
        typeof config.anonKey === 'string' && config.anonKey.length > 20 &&
        !url.includes('YOUR-PROJECT-REF');
    if (!window.supabase || !configured) return null;
    return window.supabase.createClient(url, config.anonKey);
}

// SDK가 인증 링크의 #access_token / #error 해시를 처리하고 지우기 전에 원본을 기록해 둡니다.
const INITIAL_HASH = String((window.location && window.location.hash) || '');

const db = createDbClient();

/** Absolute URL of a page next to the current one (works under /myTechBlog/ on Pages). */
function pageUrl(page) {
    return new URL(page, window.location.href).href;
}

/**
 * Reads an error that Supabase put in the URL hash after an e-mail link
 * (e.g. #error=access_denied&error_code=otp_expired&error_description=...).
 */
function hashAuthError(hash) {
    const params = new URLSearchParams(String(hash).replace(/^#/, ''));
    const code = params.get('error_code') || params.get('error');
    if (!code) return null;
    if (code === 'otp_expired') {
        return '인증 링크가 만료되었거나 이미 사용되었습니다. 먼저 로그인해 보시고, 안 되면 로그인 화면에서 확인 메일을 다시 받으세요.';
    }
    return '메일 링크 인증에 실패했습니다. 로그인 화면에서 다시 시도하세요.';
}

/** Turns a DB row into the shape the renderers use. */
function fromRow(row) {
    const createdAt = Date.parse(row.created_at) || 0;
    return {
        id: row.id,
        title: row.title,
        content: row.content,
        author: row.author_name,
        authorId: row.author_id,
        source: row.source,
        metadata: row.metadata || {},
        createdAt,
        date: new Date(createdAt).toLocaleString('ko-KR', DATE_FORMAT),
        lastModified: row.updated_at ? new Date(row.updated_at).toLocaleString('ko-KR', DATE_FORMAT) : null
    };
}

async function fetchPosts() {
    const { data, error } = await db.from('posts').select(POST_COLUMNS)
        .order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map(fromRow);
}

async function fetchPost(id) {
    const { data, error } = await db.from('posts').select(POST_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : null;
}

async function getCurrentUser() {
    const { data, error } = await db.auth.getSession();
    if (error) return null;
    return (data && data.session && data.session.user) || null;
}

async function getUsername(user) {
    const { data } = await db.from('profiles').select('username').eq('id', user.id).maybeSingle();
    return (data && data.username) || (user.user_metadata && user.user_metadata.username) || null;
}

/**
 * Maps Supabase errors to messages that do not leak internals.
 * @param {{message?: string, code?: string, status?: number}} error
 */
function friendlyError(error) {
    const message = String((error && error.message) || '');
    const code = String((error && error.code) || '');
    // 원인 파악용으로 코드만 남깁니다(이메일·비밀번호 등 입력값은 기록하지 않음).
    if (error && typeof console !== 'undefined') console.warn('[devlog] Supabase error', code || error.status || '', message);
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(message)) return '이메일 또는 비밀번호가 잘못되었습니다.';
    if (code === 'email_not_confirmed' || /Email not confirmed/i.test(message)) return '이메일 인증을 완료한 뒤 로그인하세요.';
    if (code === 'user_already_exists' || /already registered|already exists/i.test(message)) return '이미 가입된 이메일입니다.';
    if (/Database error saving new user/i.test(message)) return '이미 사용 중인 사용자 이름이거나 형식이 올바르지 않습니다.';
    if (code === 'same_password') return '이전과 다른 비밀번호를 입력하세요.';
    if (code === 'weak_password' || /Password should be/i.test(message)) return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
    if (/rate limit|too many/i.test(message) || code.includes('rate_limit') || (error && error.status === 429)) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
    if (error && (error.code === '42501' || error.status === 401 || error.status === 403)) return '이 작업을 할 권한이 없습니다.';
    return '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
}

// --- PAGE HELPERS ---

function showNotice(text) {
    const notice = document.createElement('p');
    notice.className = 'feed-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = text;
    const target = document.querySelector('main .container') || document.querySelector('.auth-card');
    if (target) target.prepend(notice);
}

function setBusy(form, busy) {
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = busy;
}

function readLegacyPosts() {
    try {
        const value = JSON.parse(localStorage.getItem(LEGACY_POSTS_KEY));
        return Array.isArray(value) ? value.filter(p => p && p.source !== 'github-trending') : [];
    } catch {
        return [];
    }
}

/**
 * Updates the navigation bar to show user-specific links.
 */
function updateNav(user) {
    const navUl = document.getElementById('nav-list');
    if (!navUl) return;

    const path = window.location.pathname;
    const onIndex = path.endsWith('/index.html') || path.endsWith('/');
    const homeClass = onIndex ? 'nav-link is-active' : 'nav-link';

    navUl.innerHTML = user
        ? `
            <li><a class="${homeClass}" href="index.html">홈</a></li>
            <li><a class="nav-link nav-link--accent" href="create-post.html">새 글 작성</a></li>
            <li><a class="nav-link" href="import-post.html">자동 글쓰기</a></li>
            <li><a class="nav-link nav-link--danger" href="#" id="logout-btn">로그아웃</a></li>
        `
        : `
            <li><a class="${homeClass}" href="index.html">홈</a></li>
            <li><a class="nav-link" href="import-post.html">자동 글쓰기</a></li>
            <li><a class="nav-link nav-link--accent" href="login.html">로그인</a></li>
        `;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await db.auth.signOut();
            window.location.href = 'login.html';
        });
    }
}

// --- THEME (light / dark) ---

function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch { /* storage blocked */ }
    const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

function initThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch { /* storage blocked */ }
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
        .replace(/^#{1,6}\s+/gm, ' ')
        .replace(/\*\*|`/g, '')
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
 * Parses a Korean locale date string into a timestamp (ms).
 * Handles both "2026. 10. 15. 오후 11:30:00" (toLocaleString output) and
 * "2026년 10월 15일 오후 11:30:00" style strings.
 * 오전/오후 표기가 없으면 24시간 표기로 간주합니다.
 * @param {string} str
 * @returns {number} timestamp in ms, or 0 when unparseable
 */
function parseKoreanDate(str) {
    const text = String(str || '');
    const numbers = text.match(/\d+/g);
    if (!numbers || numbers.length < 3) return 0;

    const [year, month, day, hour = 0, minute = 0, second = 0] = numbers.map(Number);

    let h = hour;
    if (/오후|저녁|낮/.test(text)) {
        if (h < 12) h += 12;
    } else if (/오전|새벽/.test(text)) {
        if (h === 12) h = 0;
    }

    return new Date(year, month - 1, day, h, minute, second).getTime() || 0;
}

/**
 * Returns a post's creation timestamp (ms) considering time of day.
 * 우선순위: createdAt 필드 → 작성 날짜 문자열(시·분·초 포함) → ID 안의 타임스탬프.
 * @param {object} post
 * @returns {number}
 */
function getPostTimestamp(post) {
    const createdAt = Number(post && post.createdAt);
    if (createdAt) return createdAt;

    const fromDate = parseKoreanDate(post && post.date);
    if (fromDate) return fromDate;

    return parseInt(String((post && post.id) || '').replace('post-', ''), 10) || 0;
}

/**
 * Inlines simple Markdown-ish syntax inside an already escaped string.
 * Supports `code`, **bold**, and [text](https://...) links.
 * @param {string} escaped
 * @returns {string}
 */
function renderInline(escaped) {
    return escaped
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
}

/**
 * Renders an escaped prose block as HTML.
 * Supports headings (#, ##, ###), unordered (-) / ordered (1.) lists,
 * blockquotes (>), and paragraphs.
 * @param {string} escaped
 * @returns {string}
 */
function renderProse(escaped) {
    return escaped
        .split(/\n{2,}/)
        .map(block => {
            const lines = block.split('\n');

            const heading = block.match(/^(#{1,3})\s+(.*)$/);
            if (heading) {
                const level = Math.min(heading[1].length + 1, 4); // h1은 글 제목이 사용
                return `<h${level}>${renderInline(heading[2])}</h${level}>`;
            }

            if (lines.every(line => /^\s*[-*]\s+/.test(line))) {
                const items = lines
                    .map(line => `<li>${renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
                    .join('');
                return `<ul>${items}</ul>`;
            }

            if (lines.every(line => /^\s*\d+\.\s+/.test(line))) {
                const items = lines
                    .map(line => `<li>${renderInline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`)
                    .join('');
                return `<ol>${items}</ol>`;
            }

            if (lines.every(line => /^&gt;\s?/.test(line))) {
                const quote = lines
                    .map(line => renderInline(line.replace(/^&gt;\s?/, '')))
                    .join('<br>');
                return `<blockquote>${quote}</blockquote>`;
            }

            return `<p>${lines.map(line => renderInline(line)).join('<br>')}</p>`;
        })
        .join('');
}

/**
 * Renders a post body as safe HTML.
 * Supports ``` fenced code blocks and Markdown-ish prose (see renderProse).
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

            return renderProse(prose);
        })
        .join('');
}


// --- PAGES ---

const ICON_PEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>`;
const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>`;

function canEdit(user, post) {
    return !!user && post.source === 'user' && post.authorId === user.id;
}

function requireUser(user) {
    if (user) return true;
    window.location.href = 'login.html';
    return false;
}

function renderPostCard(post, groupId, user) {
    const modified = post.lastModified
        ? `<span class="meta-sep" aria-hidden="true"></span><span class="meta-badge">수정됨</span>`
        : '';
    const auto = post.source === 'github-trending'
        ? `<span class="meta-badge">자동 게시</span>`
        : '';
    const edit = canEdit(user, post)
        ? `<div class="card-actions"><a class="btn btn--ghost btn--sm"
                href="edit-post.html?id=${encodeURIComponent(post.id)}">수정</a></div>`
        : '';
    return `
        <article class="post-card" id="${escapeHtml(post.id)}">
            <div class="post-meta">
                ${groupId === 'today' ? '<span class="meta-badge">NEW</span>' : ''}
                ${auto}
                <time datetime="${escapeHtml(new Date(post.createdAt).toISOString())}">${escapeHtml(post.date)}</time>
                <span class="meta-sep" aria-hidden="true"></span>
                <span>by ${escapeHtml(post.author)}</span>
                <span class="meta-sep" aria-hidden="true"></span>
                <span>${readingTime(post.content)} min read</span>
                ${modified}
            </div>
            <h3 class="post-card__title">
                <a href="dynamic-post.html?id=${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a>
            </h3>
            <p class="post-card__excerpt">${escapeHtml(makeExcerpt(post.content))}</p>
            <div class="post-card__footer">
                <a class="read-more" href="dynamic-post.html?id=${encodeURIComponent(post.id)}">더 읽기 →</a>
                ${edit}
            </div>
        </article>
    `;
}

async function importLegacyPosts(legacy) {
    const rows = legacy
        .filter(p => typeof p.title === 'string' && p.title.trim() && typeof p.content === 'string' && p.content)
        .map(p => {
            const ts = getPostTimestamp(p);
            return {
                title: p.title.trim().slice(0, 200),
                content: p.content.slice(0, 100000),
                author_name: String(p.author || '').trim().slice(0, 50) || '익명',
                created_at: new Date(ts > 0 && ts <= Date.now() ? ts : Date.now()).toISOString()
            };
        });
    if (rows.length) {
        const { error } = await db.from('posts').insert(rows);
        if (error) throw error;
    }
    // 원본은 지우지 않고 백업 키로 옮겨 둡니다.
    localStorage.setItem(LEGACY_BACKUP_KEY, localStorage.getItem(LEGACY_POSTS_KEY) || '[]');
    localStorage.removeItem(LEGACY_POSTS_KEY);
    return rows.length;
}

function offerLegacyImport(container) {
    const legacy = readLegacyPosts();
    if (!legacy.length || !container) return;

    const box = document.createElement('div');
    box.className = 'feed-notice';
    box.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = `이 브라우저에만 저장된 이전 글 ${legacy.length}개가 있습니다. `;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary btn--sm';
    button.textContent = '내 계정으로 가져오기';
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const count = await importLegacyPosts(legacy);
            alert(`${count}개의 글을 가져왔습니다.`);
            window.location.reload();
        } catch (error) {
            button.disabled = false;
            alert(friendlyError(error));
        }
    });
    box.append(text, button);
    container.prepend(box);
}

async function renderIndex(user) {
    const postsContainer = document.getElementById('posts-container');
    if (!postsContainer) return;

    if (user) offerLegacyImport(document.querySelector('main .container'));

    let posts = [];
    try {
        posts = await fetchPosts();
    } catch (error) {
        showNotice(`글 목록을 불러오지 못했습니다. ${friendlyError(error)}`);
    }
    posts.sort((a, b) => b.createdAt - a.createdAt);

    const statPosts = document.getElementById('stat-posts');
    const postsCount = document.getElementById('posts-count');
    if (statPosts) statPosts.textContent = posts.length;
    if (postsCount) postsCount.textContent = `${posts.length} articles`;

    postsContainer.innerHTML = '';

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const todayPosts = [];
    const pastPosts = [];
    posts.forEach(post => {
        (post.createdAt >= todayStart.getTime() && post.createdAt < tomorrowStart.getTime()
            ? todayPosts : pastPosts).push(post);
    });
    const groups = [
        { id: 'today', title: 'Today', description: '오늘 올라온 새로운 글', posts: todayPosts,
            empty: '오늘 올라온 글이 아직 없어요.' },
        { id: 'past', title: '지난글', description: '이전에 기록한 이야기', posts: pastPosts,
            empty: '아직 지난글이 없어요.' }
    ];
    groups.forEach(group => {
        const section = document.createElement('section');
        section.className = `post-group post-group--${group.id}`;
        section.setAttribute('aria-labelledby', `${group.id}-heading`);
        section.innerHTML = `
            <header class="post-group__head">
                <div>
                    <h2 class="post-group__title" id="${group.id}-heading">${group.title}
                        <span class="post-group__count">${group.posts.length}개</span>
                    </h2>
                    <p class="post-group__description">${group.description}</p>
                </div>
                ${group.id === 'today' ? `<span class="post-group__date">${todayStart.toLocaleDateString('ko-KR')}</span>` : ''}
            </header>
            <div class="posts"></div>
        `;
        const groupContainer = section.querySelector('.posts');
        postsContainer.appendChild(section);
        if (group.posts.length === 0) {
            groupContainer.innerHTML = `<p class="post-group__empty">${group.empty}</p>`;
            if (posts.length === 0 && group.id === 'today') {
                groupContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state__icon">${ICON_PEN}</div>
                        <h3>아직 작성된 글이 없어요</h3>
                        <p>첫 번째 글을 작성해 보세요. 배운 것을 기록할 때 더 오래 기억됩니다.</p>
                        <a href="${user ? 'create-post.html' : 'login.html'}" class="btn btn--primary">첫 글 작성하기 →</a>
                    </div>
                `;
            }
        } else {
            group.posts.forEach(post => {
                groupContainer.insertAdjacentHTML('beforeend', renderPostCard(post, group.id, user));
            });
        }
    });
}

function renderNotFound(container, title = '게시물을 찾을 수 없습니다', desc = '삭제되었거나 잘못된 주소일 수 있어요.') {
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state__icon">${ICON_SEARCH}</div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(desc)}</p>
            <a href="index.html" class="btn btn--primary">목록으로 돌아가기</a>
        </div>
    `;
}

async function renderDetail(user) {
    const mainContainer = document.querySelector('main .container');
    const postId = new URLSearchParams(window.location.search).get('id');
    if (!mainContainer) return;
    if (!postId) return renderNotFound(mainContainer);

    let post = null;
    try {
        post = await fetchPost(postId);
    } catch (error) {
        return renderNotFound(mainContainer, '게시물을 불러오지 못했습니다', friendlyError(error));
    }
    if (!post) return renderNotFound(mainContainer);

    document.title = `${post.title} — devlog`;
    const modified = post.lastModified
        ? `<span class="meta-sep" aria-hidden="true"></span><span class="meta-badge">수정됨 ${escapeHtml(post.lastModified)}</span>`
        : '';
    const edit = canEdit(user, post)
        ? `<a class="btn btn--primary" href="edit-post.html?id=${encodeURIComponent(post.id)}">이 글 수정</a>`
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
                ${edit}
            </footer>
        </article>
    `;
}

async function initCreate(user) {
    if (!requireUser(user)) return;
    const form = document.getElementById('new-post-form');
    if (!form) return;
    const username = await getUsername(user);
    const authorInput = document.getElementById('post-author');
    if (authorInput && username) authorInput.placeholder = `비우면 ${username}(으)로 표시됩니다`;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = document.getElementById('post-title').value.trim();
        const content = document.getElementById('post-content').value;
        const author = (authorInput && authorInput.value.trim()) || username || '익명';
        if (!title || !content.trim()) {
            alert('제목과 내용을 입력하세요.');
            return;
        }
        setBusy(form, true);
        const { data, error } = await db.from('posts')
            .insert({ title, content, author_name: author.slice(0, 50) })
            .select('id').single();
        setBusy(form, false);
        if (error) {
            alert(friendlyError(error));
            return;
        }
        window.location.href = `dynamic-post.html?id=${encodeURIComponent(data.id)}`;
    });
}

async function initEdit(user) {
    if (!requireUser(user)) return;
    const form = document.getElementById('edit-post-form');
    const mainContainer = document.querySelector('main .container');
    const postId = new URLSearchParams(window.location.search).get('id');
    if (!form || !mainContainer) return;

    let post = null;
    try {
        post = postId ? await fetchPost(postId) : null;
    } catch (error) {
        return renderNotFound(mainContainer, '게시물을 불러오지 못했습니다', friendlyError(error));
    }
    if (!post) return renderNotFound(mainContainer, '수정할 게시물을 찾을 수 없습니다');
    if (!canEdit(user, post)) {
        return renderNotFound(mainContainer, '수정 권한이 없습니다', '본인이 작성한 글만 수정할 수 있습니다.');
    }

    document.getElementById('post-id').value = post.id;
    document.getElementById('post-title').value = post.title;
    document.getElementById('post-content').value = post.content;

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = document.getElementById('post-title').value.trim();
        const content = document.getElementById('post-content').value;
        if (!title || !content.trim()) {
            alert('제목과 내용을 입력하세요.');
            return;
        }
        setBusy(form, true);
        const { data, error } = await db.from('posts')
            .update({ title, content }).eq('id', post.id).select('id');
        setBusy(form, false);
        if (error || !data || data.length === 0) {
            alert(error ? friendlyError(error) : '이 작업을 할 권한이 없습니다.');
            return;
        }
        window.location.href = `dynamic-post.html?id=${encodeURIComponent(post.id)}`;
    });
}

function initSignup() {
    const form = document.getElementById('signup-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!USERNAME_PATTERN.test(username)) {
            alert('사용자 이름은 영문, 숫자, _ . - 조합 3~30자로 입력하세요.');
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            alert(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
            return;
        }

        setBusy(form, true);
        const { data, error } = await db.auth.signUp({
            email, password,
            options: { data: { username }, emailRedirectTo: pageUrl('index.html') }
        });
        setBusy(form, false);
        if (error) {
            alert(friendlyError(error));
            return;
        }
        if (data && data.session) {
            window.location.href = 'index.html';
        } else {
            alert('가입 확인 메일을 보냈습니다. 메일의 링크로 인증한 뒤 로그인하세요.');
            window.location.href = 'login.html';
        }
    });
}

function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        setBusy(form, true);
        const { error } = await db.auth.signInWithPassword({ email, password });
        setBusy(form, false);
        if (!error) {
            window.location.href = 'index.html';
            return;
        }
        const notConfirmed = error.code === 'email_not_confirmed' || /Email not confirmed/i.test(String(error.message));
        if (notConfirmed && confirm('이메일 인증이 아직 완료되지 않았습니다. 확인 메일을 다시 보낼까요?')) {
            const resent = await db.auth.resend({ type: 'signup', email, options: { emailRedirectTo: pageUrl('index.html') } });
            alert(resent.error ? friendlyError(resent.error) : '확인 메일을 다시 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.');
            return;
        }
        alert(friendlyError(error));
    });

    const resetLink = document.getElementById('reset-link');
    if (resetLink) {
        resetLink.addEventListener('click', async (event) => {
            event.preventDefault();
            const email = document.getElementById('email').value.trim();
            if (!email) {
                alert('위 이메일 칸에 가입한 이메일을 입력한 뒤 다시 눌러 주세요.');
                return;
            }
            const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('reset-password.html') });
            // 가입 여부를 드러내지 않도록 성공 시 문구는 항상 같습니다.
            alert(error ? friendlyError(error) : '가입된 이메일이라면 비밀번호 재설정 메일이 발송됩니다. 메일의 링크를 눌러 주세요.');
        });
    }
}

async function initReset() {
    const form = document.getElementById('reset-form');
    if (!form) return;
    const user = await getCurrentUser();
    if (!user) {
        showNotice('재설정 링크가 만료되었거나 올바르지 않습니다. 로그인 화면에서 재설정 메일을 다시 받으세요.');
        setBusy(form, true);
        return;
    }
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = document.getElementById('password').value;
        if (password.length < MIN_PASSWORD_LENGTH) {
            alert(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
            return;
        }
        setBusy(form, true);
        const { error } = await db.auth.updateUser({ password });
        setBusy(form, false);
        if (error) {
            alert(friendlyError(error));
            return;
        }
        alert('비밀번호를 변경했습니다.');
        window.location.href = 'index.html';
    });
}

// --- MAIN ---

document.addEventListener('DOMContentLoaded', async () => {
    const path = window.location.pathname;

    initTheme();
    initThemeToggle();

    if (!db) {
        updateNav(null);
        showNotice('Supabase 연결 정보가 설정되지 않았습니다. supabase-config.js에 프로젝트 URL과 anon 키를 입력하세요.');
        return;
    }

    const linkError = hashAuthError(INITIAL_HASH);
    if (linkError) {
        showNotice(linkError);
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }

    // 재설정 메일 링크가 허용 목록 밖이라 Site URL(홈)로 돌아와도 재설정 화면으로 보냅니다.
    db.auth.onAuthStateChange(event => {
        if (event === 'PASSWORD_RECOVERY' && !window.location.pathname.includes('reset-password.html')) {
            window.location.href = 'reset-password.html';
        }
    });

    if (path.includes('reset-password.html')) return initReset();
    if (path.includes('signup.html')) return initSignup();
    if (path.includes('login.html')) return initLogin();

    const user = await getCurrentUser();
    updateNav(user);

    if (path.includes('create-post.html')) return initCreate(user);
    if (path.includes('edit-post.html')) return initEdit(user);
    if (path.includes('dynamic-post.html')) return renderDetail(user);
    if (path.endsWith('/index.html') || path.endsWith('/')) return renderIndex(user);
});
