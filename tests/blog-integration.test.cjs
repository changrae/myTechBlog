const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync('app.js','utf8');
const loader = fs.readFileSync('published-posts.js','utf8');
const post = {id:'trending-test',title:'Automatic review',author:'bot',content:'## Summary\n\nBody',
    date:'2026-10-16',createdAt:Date.now(),source:'github-trending',publicationDay:'2026-10-16'};
function element() {
    return {innerHTML:'',textContent:'',value:'',children:[],events:{},
        setAttribute(){},getAttribute(){return 'light'},addEventListener(e,fn){this.events[e]=fn},
        appendChild(e){this.children.push(e)},prepend(e){this.children.unshift(e)},
        insertAdjacentHTML(_,s){this.innerHTML+=s},querySelector(){return this.list ||= element()}};
}
async function render(path, local=[]) {
    const main=element(), nodes=new Map();
    const ids=['posts-container','stat-posts','posts-count'];
    if(path.includes('edit-post')) ids.push('edit-post-form','post-id','post-title','post-content');
    ids.forEach(id=>nodes.set(id,element()));
    const values=new Map([['sessionToken','test'],['blogPosts',JSON.stringify(local)]]);
    let callback;
    const context={console,URLSearchParams,Date,AbortSignal,alert(){},
        window:{location:{pathname:path,search:'?id=trending-test'},matchMedia:()=>({matches:false})},
        localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},
        fetch:async()=>({ok:true,json:async()=>({version:1,posts:[post]})}),
        document:{documentElement:element(),getElementById:id=>nodes.get(id)||null,
            createElement:element,querySelector:()=>main,addEventListener:(_,fn)=>callback=fn}};
    vm.runInNewContext(loader,context);
    context.PublishedPosts=context.window.PublishedPosts;
    vm.runInNewContext(app,context);
    await callback();
    return {nodes,values,main};
}
test('GitHub Pages subdirectory home displays shared and local posts without copying shared posts',async()=>{
    const local={...post,id:'local',source:undefined,title:'My local post'};
    const {nodes,values}=await render('/myTechBlog/',[local]);
    const groups=nodes.get('posts-container').children;
    assert.equal(groups.length,2);
    assert.ok(groups[0].list.innerHTML.includes('Automatic review'));
    assert.ok(groups[0].list.innerHTML.includes('My local post'));
    assert.equal(JSON.parse(values.get('blogPosts')).length,1);
});
test('shared article is accessible through direct detail URL',async()=>{
    const {main}=await render('/myTechBlog/dynamic-post.html');
    assert.ok(main.innerHTML.includes('Automatic review'));
    assert.ok(main.innerHTML.includes('<h3>Summary</h3>'));
});
test('shared article can be edited locally and preserves other local posts',async()=>{
    const local={...post,id:'local',source:undefined,title:'Existing'};
    const {nodes,values}=await render('/myTechBlog/edit-post.html',[local]);
    assert.equal(nodes.get('post-title').value,'Automatic review');
    nodes.get('post-title').value='Edited locally';
    nodes.get('post-content').value='New body';
    nodes.get('edit-post-form').events.submit({preventDefault(){}});
    const saved=JSON.parse(values.get('blogPosts'));
    assert.equal(saved.length,2);
    assert.equal(saved.find(p=>p.id==='local').title,'Existing');
    assert.equal(saved.find(p=>p.id===post.id).title,'Edited locally');
});
