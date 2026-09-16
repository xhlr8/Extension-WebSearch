import { mountTavilyPanel } from '/tavily-panel.js';
const calls = []; window.mockCalls = calls;
let polls = 0, enabled = false;
const source = { id: 1, title: 'Example evidence <script>alert(1)</script>', url: 'https://example.com/article', content: 'Mock source content.', published_date: '2026-01-01', score: 0.9 };
const record = (name, result) => (...args) => { calls.push({ name, args }); return Promise.resolve(structuredClone(result)); };
const api = {
    capabilities: async () => { calls.push({name:'capabilities'}); return { version:1, configured:true, operations:['search','extract','map','crawl','research','usage'], policy:{expensive_enabled:enabled}, limits:{} }; },
    setExpensiveEnabled: async value => { calls.push({name:'preferences',enabled:value}); enabled=value; return {expensive_enabled:enabled}; },
    search: record('search',{query:'mock',sources:[source],text:source.content,links:[source.url],usage:{credits:1},request_id:'mock-search'}),
    extract: record('extract',{results:[{url:source.url,raw_content:source.content}],failed_results:[],usage:{credits:1}}),
    map: record('map',{results:[source.url,'https://example.com/two'],usage:{credits:1}}),
    crawl: record('crawl',{results:[{url:source.url,raw_content:source.content}],usage:{credits:3}}),
    createResearch: record('research',{request_id:'mock-research',status:'pending',model:'mini'}),
    getResearch: async () => { calls.push({name:'poll'}); polls++; return polls<2 ? {request_id:'mock-research',status:'in_progress'} : {request_id:'mock-research',status:'completed',content:'# Mock report\nCited evidence [1].',sources:[{title:source.title,url:source.url}],usage:{credits:4}}; },
    forgetResearch: record('forget',{provider_cancelled:false}),
    usage: record('usage',{key:{usage:12,limit:1000}}),
};
window.panel = await mountTavilyPanel({container:document.getElementById('preview'),settings:{},api,onChange:()=>calls.push({name:'save'}),importDocuments:record('import',{imported:1})});
