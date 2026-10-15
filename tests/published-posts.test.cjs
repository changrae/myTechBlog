const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('published-posts.js', 'utf8');
const article = {id:'trending-test', title:'Review', content:'Body', date:'2026-10-16',
    author:'devlog', createdAt:1792108800000, source:'github-trending'};
const feed = {version:1, updatedAt:'2026-10-16T09:00:00+09:00', posts:[article]};
function setup(fetch, storage = new Map()) {
    const context = {window:{},fetch,AbortSignal,
        localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
    vm.runInNewContext(source,context);
    return context.window.PublishedPosts;
}
test('remote articles merge without replacing local edits', () => {
    const api=setup();
    const result=api.merge([{...article,title:'Local edit'},{...article,id:'local'}],[article]);
    assert.equal(result.length,2);
    assert.equal(result[0].title,'Local edit');
});
test('successful fetch updates cache and marks fresh', async () => {
    const storage=new Map();
    const api=setup(async()=>({ok:true,json:async()=>feed}),storage);
    const result=await api.load();
    assert.equal(result.stale,false);
    assert.equal(result.feed.posts.length,1);
    assert.ok(storage.has('devlogTrendingFeed'));
});
test('network failure preserves cached feed', async () => {
    const api=setup(async()=>{throw Error('offline')},new Map([['devlogTrendingFeed',JSON.stringify(feed)]]));
    const result=await api.load();
    assert.equal(result.stale,true);
    assert.equal(result.feed.posts[0].id,article.id);
});
test('invalid remote data cannot poison cache', async () => {
    const api=setup(async()=>({ok:true,json:async()=>({version:1,posts:[{}]})}),
        new Map([['devlogTrendingFeed',JSON.stringify(feed)]]));
    const result=await api.load();
    assert.equal(result.stale,true);
    assert.equal(result.feed.posts.length,1);
});
test('empty feed is valid; duplicate ids are rejected', () => {
    const api=setup();
    assert.equal(api.validate({version:1,posts:[]}).posts.length,0);
    assert.throws(()=>api.validate({...feed,posts:[article,article]}));
});
