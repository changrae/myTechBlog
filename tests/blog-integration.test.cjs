const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');

const ALICE = { id: 'u-alice', user_metadata: { username: 'alice' } };
const iso = ms => new Date(ms).toISOString();
function seedRows() {
    return [
        { id: 'trending-test', title: 'Automatic review', content: '## Summary\n\nBody', author_name: 'bot',
            author_id: null, source: 'github-trending', metadata: {}, created_at: iso(Date.now()), updated_at: null },
        { id: 'post-alice', title: 'Alice post', content: 'Mine', author_name: 'alice',
            author_id: 'u-alice', source: 'user', metadata: {}, created_at: iso(Date.now() - 86400000 * 3), updated_at: null },
        { id: 'post-bob', title: 'Bob post', content: 'Not mine', author_name: 'bob',
            author_id: 'u-bob', source: 'user', metadata: {}, created_at: iso(Date.now() - 86400000 * 2), updated_at: null }
    ];
}

/** Minimal Supabase stand-in that enforces the same ownership rules as the RLS policies. */
function fakeSupabase(state) {
    const run = q => {
        if (q.table === 'profiles') {
            const id = q.filters.find(f => f[0] === 'id')?.[1];
            return { data: state.profiles[id] ? { username: state.profiles[id] } : null, error: null };
        }
        const match = r => q.filters.every(([col, val]) => r[col] === val);
        if (q.op === 'select') {
            const rows = state.rows.filter(match);
            return { data: q.single ? rows[0] || null : rows, error: null };
        }
        if (q.op === 'insert') {
            if (!state.user) return { data: null, error: { code: '42501', message: 'rls' } };
            const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p, i) => ({
                id: `post-new-${state.rows.length + i}`, author_id: state.user.id, source: 'user', metadata: {},
                created_at: p.created_at || iso(Date.now()), updated_at: null, ...p }));
            state.rows.push(...list);
            state.inserted.push(...list);
            return { data: q.single ? { id: list[0].id } : list, error: null };
        }
        if (q.op === 'update') {
            const rows = state.rows.filter(r => match(r) && state.user && r.author_id === state.user.id && r.source === 'user');
            rows.forEach(r => Object.assign(r, q.payload, { updated_at: iso(Date.now()) }));
            return { data: rows.map(r => ({ id: r.id })), error: null };
        }
    };
    const query = table => {
        const q = { table, op: 'select', filters: [], single: false, payload: null };
        const api = {
            select() { return api; }, order() { return api; }, limit() { return api; },
            eq(col, val) { q.filters.push([col, val]); return api; },
            insert(p) { q.op = 'insert'; q.payload = p; return api; },
            update(p) { q.op = 'update'; q.payload = p; return api; },
            maybeSingle() { q.single = true; return api; }, single() { q.single = true; return api; },
            then(resolve, reject) { return Promise.resolve(run(q)).then(resolve, reject); }
        };
        return api;
    };
    return {
        createClient: (url, key) => {
            state.client = { url, key };
            return {
                from: query,
                auth: {
                    getSession: async () => ({ data: { session: state.user ? { user: state.user } : null }, error: null }),
                    signUp: async args => { state.signUp = args; return { data: { session: null }, error: null }; },
                    signInWithPassword: async args => {
                        state.signIn = args;
                        if (args.password === 'unconfirmed') return { data: {}, error: { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' } };
                        return args.password === 'right-password'
                            ? { data: { session: { user: ALICE } }, error: null }
                            : { data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } };
                    },
                    resend: async args => { state.resend = args; return { data: {}, error: null }; },
                    resetPasswordForEmail: async (email, opts) => { state.reset = { email, ...opts }; return { data: {}, error: null }; },
                    updateUser: async args => { state.updated = args; return { data: {}, error: null }; },
                    onAuthStateChange: fn => { state.authListener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
                    signOut: async () => { state.user = null; return { error: null }; }
                }
            };
        }
    };
}

function element() {
    return { innerHTML: '', textContent: '', value: '', placeholder: '', children: [], events: {},
        setAttribute() {}, getAttribute() { return 'light'; }, addEventListener(e, fn) { this.events[e] = fn; },
        appendChild(e) { this.children.push(e); }, prepend(e) { this.children.unshift(e); },
        append(...e) { this.children.push(...e); },
        insertAdjacentHTML(_, s) { this.innerHTML += s; }, querySelector() { return this.list ||= element(); } };
}

async function render(path, { user = null, search = '', hash = '', local, configured = true, url = 'https://abc.supabase.co', confirmAnswer = true, values: fields = {} } = {}) {
    const main = element(), nodes = new Map();
    ['posts-container', 'stat-posts', 'posts-count', 'nav-list', 'new-post-form', 'edit-post-form', 'reset-form', 'reset-link', 'post-id',
        'post-title', 'post-author', 'post-content', 'signup-form', 'login-form', 'email', 'username', 'password']
        .forEach(id => nodes.set(id, element()));
    Object.entries(fields).forEach(([id, value]) => { nodes.get(id).value = value; });
    const storage = new Map();
    if (local !== undefined) storage.set('blogPosts', typeof local === 'string' ? local : JSON.stringify(local));
    const state = { user, rows: seedRows(), inserted: [], profiles: { 'u-alice': 'alice' } };
    const alerts = [];
    let callback;
    const initialHref = `http://127.0.0.1:8000${path}${search}${hash}`;
    const location = { pathname: path, search, hash, href: initialHref, reload() { this.reloaded = true; } };
    const history = { replaceState: (_, __, to) => { history.replaced = to; } };
    const context = { console: { ...console, warn() {} }, URL, URLSearchParams, Date, alert: m => alerts.push(m), confirm: () => confirmAnswer,
        window: { location, history, matchMedia: () => ({ matches: false }), supabase: fakeSupabase(state),
            SUPABASE_CONFIG: configured ? { url, anonKey: 'anon-key-for-tests-0123456789' } : undefined },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        document: { title: '', documentElement: element(), getElementById: id => nodes.get(id) || null,
            createElement: element, querySelector: () => main, addEventListener: (_, fn) => { callback = fn; } } };
    vm.runInNewContext(app, context);
    await callback();
    return { nodes, main, state, storage, alerts, location, history, initialHref };
}
const submit = (nodes, id) => nodes.get(id).events.submit({ preventDefault() {} });
const html = nodes => nodes.get('posts-container').children.map(g => g.list.innerHTML).join('');

test('home page is public and lists DB posts newest first', async () => {
    const { nodes, location, initialHref } = await render('/myTechBlog/');
    assert.equal(location.href, initialHref);
    const out = html(nodes);
    assert.ok(out.indexOf('Automatic review') < out.indexOf('Bob post'));
    assert.ok(out.indexOf('Bob post') < out.indexOf('Alice post'));
    assert.ok(!out.includes('edit-post.html'), 'anonymous visitors get no edit links');
    assert.equal(nodes.get('stat-posts').textContent, 3);
});

test('edit link appears only on the signed-in author\'s own posts', async () => {
    const { nodes } = await render('/myTechBlog/index.html', { user: ALICE });
    const out = html(nodes);
    assert.ok(out.includes('edit-post.html?id=post-alice'));
    assert.ok(!out.includes('edit-post.html?id=post-bob'));
    assert.ok(!out.includes('edit-post.html?id=trending-test'));
});

test('detail page renders markdown from the DB', async () => {
    const { main } = await render('/myTechBlog/dynamic-post.html', { search: '?id=trending-test' });
    assert.ok(main.innerHTML.includes('Automatic review'));
    assert.ok(main.innerHTML.includes('<h3>Summary</h3>'));
});

test('writing requires login', async () => {
    const { location } = await render('/myTechBlog/create-post.html');
    assert.equal(location.href, 'login.html');
});

test('new post is inserted with the profile name as default author', async () => {
    const { nodes, state, location } = await render('/myTechBlog/create-post.html', { user: ALICE,
        values: { 'post-title': '  Hello  ', 'post-content': 'Body' } });
    await submit(nodes, 'new-post-form');
    assert.equal(state.inserted[0].title, 'Hello');
    assert.equal(state.inserted[0].author_name, 'alice');
    assert.equal(state.inserted[0].author_id, 'u-alice', 'owner comes from the server default, not the client');
    assert.match(location.href, /^dynamic-post\.html\?id=post-new-/);
});

test('editing another user\'s post is refused before showing the form', async () => {
    const { main, nodes } = await render('/myTechBlog/edit-post.html', { user: ALICE, search: '?id=post-bob' });
    assert.ok(main.innerHTML.includes('수정 권한이 없습니다'));
    assert.equal(nodes.get('edit-post-form').events.submit, undefined);
});

test('author can edit their own post', async () => {
    const { nodes, state, location } = await render('/myTechBlog/edit-post.html', { user: ALICE, search: '?id=post-alice' });
    assert.equal(nodes.get('post-title').value, 'Alice post');
    nodes.get('post-title').value = 'Edited';
    await submit(nodes, 'edit-post-form');
    assert.equal(state.rows.find(r => r.id === 'post-alice').title, 'Edited');
    assert.equal(location.href, 'dynamic-post.html?id=post-alice');
});

test('legacy localStorage posts can be imported once and are kept as a backup', async () => {
    const legacy = [{ id: 'post-1', title: 'Old', content: 'Old body', author: 'me', createdAt: 1700000000000 },
        { id: 'trending-x', title: 'Auto edit', content: 'x', source: 'github-trending' }];
    const { main, state, storage, alerts } = await render('/myTechBlog/', { user: ALICE, local: legacy });
    const banner = main.children[0];
    assert.ok(banner.children[0].textContent.includes('1개'));
    await banner.children[1].events.click();
    assert.equal(state.inserted.length, 1);
    assert.equal(state.inserted[0].created_at, new Date(1700000000000).toISOString());
    assert.equal(storage.get('blogPosts'), undefined);
    assert.ok(storage.get('blogPostsImported').includes('Old'));
    assert.equal(alerts[0], '1개의 글을 가져왔습니다.');
});

test('corrupted legacy storage is ignored', async () => {
    const { main, nodes } = await render('/myTechBlog/', { user: ALICE, local: '{not json' });
    assert.equal(main.children.length, 0);
    assert.equal(nodes.get('posts-container').children.length, 2);
});

test('signup validates input before calling Supabase and stores the username as metadata', async () => {
    let r = await render('/myTechBlog/signup.html', { values: { email: 'a@b.co', username: 'ab', password: 'longenough' } });
    await submit(r.nodes, 'signup-form');
    assert.equal(r.state.signUp, undefined);
    r = await render('/myTechBlog/signup.html', { values: { email: 'a@b.co', username: 'alice', password: 'short' } });
    await submit(r.nodes, 'signup-form');
    assert.equal(r.state.signUp, undefined);
    r = await render('/myTechBlog/signup.html', { values: { email: ' a@b.co ', username: 'alice', password: 'longenough' } });
    await submit(r.nodes, 'signup-form');
    assert.equal(r.state.signUp.email, 'a@b.co');
    assert.equal(r.state.signUp.options.data.username, 'alice');
    assert.equal(r.state.signUp.options.emailRedirectTo, 'http://127.0.0.1:8000/myTechBlog/index.html');
    assert.equal(r.location.href, 'login.html');
});

test('login shows a generic message on bad credentials', async () => {
    const { nodes, alerts, location, initialHref } = await render('/myTechBlog/login.html', { values: { email: 'a@b.co', password: 'nope' } });
    await submit(nodes, 'login-form');
    assert.equal(alerts[0], '이메일 또는 비밀번호가 잘못되었습니다.');
    assert.equal(location.href, initialHref);
});

test('missing Supabase config shows a notice instead of crashing', async () => {
    const { main, state } = await render('/myTechBlog/', { configured: false });
    assert.ok(main.children[0].textContent.includes('supabase-config.js'));
    assert.equal(state.client, undefined);
});

test('REST URL copied from the dashboard is normalized to the project URL', async () => {
    const { state } = await render('/myTechBlog/', { url: 'https://abc.supabase.co/rest/v1/' });
    assert.equal(state.client.url, 'https://abc.supabase.co');
});

test('unconfirmed e-mail login offers to resend the confirmation mail', async () => {
    const { nodes, state, alerts } = await render('/myTechBlog/login.html', { values: { email: 'a@b.co', password: 'unconfirmed' } });
    await submit(nodes, 'login-form');
    assert.equal(state.resend.type, 'signup');
    assert.equal(state.resend.email, 'a@b.co');
    assert.equal(state.resend.options.emailRedirectTo, 'http://127.0.0.1:8000/myTechBlog/index.html');
    assert.match(alerts[0], /다시 보냈습니다/);
});

test('password reset mail points back to the reset page', async () => {
    const { nodes, state, alerts } = await render('/myTechBlog/login.html', { values: { email: 'a@b.co' } });
    await nodes.get('reset-link').events.click({ preventDefault() {} });
    assert.deepEqual({ ...state.reset }, { email: 'a@b.co', redirectTo: 'http://127.0.0.1:8000/myTechBlog/reset-password.html' });
    assert.match(alerts[0], /재설정 메일/);
});

test('reset page needs the recovery session and then updates the password', async () => {
    let r = await render('/myTechBlog/reset-password.html');
    assert.match(r.main.children[0].textContent, /재설정 링크가 만료/);
    assert.equal(r.nodes.get('reset-form').events.submit, undefined);
    r = await render('/myTechBlog/reset-password.html', { user: ALICE, values: { password: 'new-password-1' } });
    await submit(r.nodes, 'reset-form');
    assert.equal(r.state.updated.password, 'new-password-1');
    assert.equal(r.location.href, 'index.html');
});

test('recovery link that lands on the home page is sent to the reset page', async () => {
    const { state, location } = await render('/myTechBlog/');
    state.authListener('PASSWORD_RECOVERY');
    assert.equal(location.href, 'reset-password.html');
});

test('expired e-mail link error in the URL hash is explained and removed', async () => {
    const { main, history } = await render('/myTechBlog/', { hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid' });
    assert.match(main.children[0].textContent, /만료되었거나 이미 사용/);
    assert.equal(history.replaced, '/myTechBlog/');
});
