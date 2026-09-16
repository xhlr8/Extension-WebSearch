import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { createChatTracker } from '../chat-guard.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
const turn = () => new Promise(r => setTimeout(r, 0));
function chat(id) { return {characterId:1, groupId:null, chatId:id, chat:[{mes:'search',is_user:true}],chatMetadata:{},saveMetadata:async()=>{}}; }
async function fixture({upload} = {}) {
    let current=chat('a'); const initial=current, prompts=[],uploads=[],media=[];
    const settings={websearch:{enabled:true,use_function_tool:false,source:'tavily',position:0,depth:0,insertionTemplate:'{{text}}',visit_enabled:true,visit_target:0,include_images:false}};
    const overrides={getContext:()=>current,extension_settings:settings,extension_prompt_types:{IN_PROMPT:0},getRequestHeaders:()=>({}),
        setExtensionPrompt:(_id,text)=>prompts.push({id:current.chatId,text}),
        substituteParamsExtended:(_template,values)=>values.text,
        appendMediaToMessage:(...args)=>media.push(args),
        appendFileContent:async(_m,text)=>text,
        uploadFileAttachment:async()=>{uploads.push(current.chatId);return upload ? upload() : '/user/files/test.txt';},
        bufferToBase64:async()=> 'base64',SECRET_KEYS:{},secret_state:{},
    };
    const context=createContext({console:{debug(){},error(){},log(){}},URL,Map,Set,AbortController,AbortSignal,structuredClone,TextEncoder,TextDecoder,Uint8Array,Blob,Response,
        window:{btoa:()=> 'base64'},document:{},SillyTavern:{getContext:()=>current},jQuery:()=>{},$:()=>({length:1}),toastr:{info(){},warning(){},error(){}},unescape,encodeURIComponent});
    let source=await readFile(new URL('../index.js',import.meta.url),'utf8');
    source += '\nexport const probes = { onWebSearchPrompt, visitLinksAndAttachToMessage, importWebDocuments, chatTracker };\nexport function inject(search,visit,upload) { performSearchRequest=search; visitLinks=visit; extractSearchQuery=()=>"query"; isSearchAvailable=async()=>true; }';
    const stubs=new Map();
    for(const [,names,spec] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)){
        if(spec.startsWith('./'))continue;
        const keys=names.split(',').map(x=>x.trim()).filter(Boolean);
        stubs.set(spec,new SyntheticModule(keys,function(){for(const k of keys)this.setExport(k,overrides[k]??(()=>{}));},{context}));
    }
    const locals=new Map();
    async function local(spec){
        if(locals.has(spec))return locals.get(spec);
        const mod=new SourceTextModule(await readFile(new URL('../'+spec.slice(2),import.meta.url),'utf8'),{context,identifier:spec});locals.set(spec,mod);await mod.link(s=>local(s));return mod;
    }
    const mod=new SourceTextModule(source,{context});await mod.link(s=>s.startsWith('./')?local(s):stubs.get(s));await mod.evaluate();
    return {api:mod.namespace, initial, settings,prompts,uploads,media,setChat(c){current=c;},get current(){return current;}};
}
test('chat guard rejects switching away/back, changed message, superseded work',()=>{
    let c=chat('a');const tracker=createChatTracker(()=>c);const g=tracker.capture();g.bindMessage(0);g.assert();
    c.chat[0]={mes:'different'};assert.throws(()=>g.assert(),e=>e.code==='STALE_CHAT');
    const h=tracker.capture();tracker.invalidate();assert.equal(h.signal.aborted,true);assert.throws(()=>h.assert());
});
test('slow search cannot attach or inject into a different chat',async()=>{
    const f=await fixture(),d=deferred();let started=false,visits=0;
    f.api.inject(async()=>{started=true;return d.promise;},async()=>{visits++;return 'page';});
    const pending=f.api.probes.onWebSearchPrompt([{index:0,is_user:true,mes:'search'}],0,null,'normal');
    while(!started)await turn();f.setChat(chat('b'));d.resolve({text:'OLD EVIDENCE',links:['https://example.com'],images:[]});await pending;
    assert.equal(visits,0);assert.equal(f.uploads.length,0);assert.ok(!f.prompts.some(p=>p.text));assert.equal(f.current.chat[0].extra,undefined);
});
test('slow page read cannot upload/attach into another chat',async()=>{
    const f=await fixture(),d=deferred();let started=false;
    f.api.inject(async()=>({text:'search evidence',links:['https://example.com'],images:[]}),async()=>{started=true;return d.promise;});
    const pending=f.api.probes.onWebSearchPrompt([{index:0,is_user:true,mes:'search'}],0,null,'normal');
    while(!started)await turn();f.setChat(chat('b'));d.resolve('old page');await pending;
    assert.equal(f.uploads.length,0);assert.equal(f.media.length,0);assert.equal(f.current.chat[0].extra,undefined);assert.ok(!f.prompts.some(p=>p.text));
});
test('superseded automatic generation cannot override new evidence',async()=>{
    const f=await fixture(),d=deferred();let n=0;f.settings.websearch.visit_enabled=false;
    f.api.inject(async()=>++n===1?d.promise:{text:'new',links:[],images:[]},async()=> '');
    const old=f.api.probes.onWebSearchPrompt([{index:0,is_user:true,mes:'search'}],0,null,'normal');while(n<1)await turn();
    await f.api.probes.onWebSearchPrompt([{index:0,is_user:true,mes:'search'}],0,null,'normal');d.resolve({text:'old',links:[],images:[]});await old;
    assert.equal(f.prompts.filter(p=>p.text).length,1);assert.equal(f.prompts.at(-1).text,'new');
});

test('slow attachment upload never mutates the newly selected chat',async()=>{
    const d=deferred();let started=false;const f=await fixture({upload:async()=>{started=true;return d.promise;}});
    f.api.inject(async()=>({text:'search evidence',links:['https://example.com'],images:[]}),async()=> 'old page');
    const pending=f.api.probes.onWebSearchPrompt([{index:0,is_user:true,mes:'search'}],0,null,'normal');
    while(!started)await turn();f.setChat(chat('b'));d.resolve('/user/files/old.txt');await pending;
    assert.deepEqual(f.uploads,['a']);assert.equal(f.media.length,0);assert.equal(f.current.chat[0].extra,undefined);assert.ok(!f.prompts.some(p=>p.text));
});
test('automatic Data Bank upload uses the original guard across slow upload',async()=>{
    const d=deferred();let started=false;const f=await fixture({upload:async()=>{started=true;return d.promise;}});
    const guard=f.api.probes.chatTracker.capture();
    const pending=f.api.probes.importWebDocuments([{title:'page',content:'old evidence'}],guard);
    while(!started)await turn();f.setChat(chat('b'));d.resolve('/user/files/old.txt');
    await assert.rejects(pending,e=>e.code==='STALE_CHAT');
    assert.equal(f.current.chatMetadata.attachments,undefined);assert.equal(f.initial.chatMetadata.attachments,undefined);
});
test('unchanged chat gets requested evidence and attachment normally',async()=>{
    const f=await fixture(); f.api.inject(async()=>({text:'search evidence',links:['https://example.com'],images:[]}),async()=> 'page');
    await f.api.probes.onWebSearchPrompt([{index:0,is_user:true,mes:'search'}],0,null,'normal');
    assert.equal(f.uploads.length,1);assert.equal(f.initial.chat[0].extra.file.url,'/user/files/test.txt');assert.equal(f.prompts.at(-1).text,'search evidence');
});
