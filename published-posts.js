/* Shared automatic posts are separate from locally authored/edited posts. */
window.PublishedPosts = (() => {
    const CACHE_KEY = 'devlogTrendingFeed';
    function validate(feed) {
        if (!feed || feed.version !== 1 || !Array.isArray(feed.posts)) throw new Error('게시 데이터 형식이 올바르지 않습니다.');
        const ids = new Set();
        for (const post of feed.posts) {
            if (!post || typeof post.id !== 'string' || ids.has(post.id) ||
                typeof post.title !== 'string' || typeof post.content !== 'string' ||
                typeof post.date !== 'string' || typeof post.author !== 'string' ||
                !Number.isFinite(post.createdAt) || post.createdAt <= 0 ||
                post.source !== 'github-trending') throw new Error('게시글 데이터 검증에 실패했습니다.');
            ids.add(post.id);
        }
        return feed;
    }
    function cached() {
        try { return validate(JSON.parse(localStorage.getItem(CACHE_KEY))); }
        catch { return {version: 1, updatedAt: null, posts: []}; }
    }
    async function load() {
        try {
            const response = await fetch('data/trending-posts.json', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const feed = validate(await response.json());
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(feed)); } catch { /* cache is optional */ }
            return {feed, stale: false};
        } catch (error) {
            return {feed: cached(), stale: true, error};
        }
    }
    function merge(local, published) {
        // Local edits win; automatic posts are never copied into the local-authoring collection.
        return [...new Map([...published, ...local].map(post => [post.id, post])).values()];
    }
    return {load, merge, validate};
})();
