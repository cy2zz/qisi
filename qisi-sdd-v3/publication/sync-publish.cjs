const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const pub=__dirname,root=path.resolve(pub,'..');
const docs=JSON.parse(fs.readFileSync(path.join(pub,'documents.json'),'utf8'));
const allowed=new Set(['a3ceafa9c4ac4a1ebab7ebd04068a9c2','98264ae3b38941a5aaf1b62e59abc31c','0de4566fcbef4f9ebd7f9e474cf4b718']);
if(docs.length!==3||docs.some(d=>!allowed.has(d.docId)))throw Error('Unexpected publication targets');
const attachment=JSON.parse(fs.readFileSync(path.join(pub,'attachment.json'),'utf8'));
const archive=fs.readFileSync(path.resolve(root,'..','qisi-sdd-v3.zip'));
if(crypto.createHash('sha256').update(archive).digest('hex')!==attachment.sha256||archive.length!==attachment.size)throw Error('Archive changed after upload');
function parse(text,label){const line=text.replace(/^\uFEFF/,'').split(/\r?\n/).find(x=>x.startsWith('{"ok":'));if(!line)throw Error('Missing API response '+label);const r=JSON.parse(line);if(r.ok!==true)throw Error('API failed '+label+': '+JSON.stringify(r));return r;}
function loadResponse(file){const b=fs.readFileSync(path.join(pub,file));return parse(b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8'),file);}
function walk(o,fn){if(o&&typeof o==='object'){fn(o);for(const v of Object.values(o))walk(v,fn);}}
function assertSuccess(o,label){let success=false;walk(o,x=>{if('downstream_http_status' in x&&x.downstream_http_status!==200)throw Error('Downstream failure '+label);if('status'in x){if(x.status===1)success=true;else if(typeof x.status==='number')throw Error('Operation status failure '+label+': '+x.status);}});if(!success)throw Error('No downstream success '+label);}
function findDoc(o){let found=null;walk(o,x=>{if(typeof x.content==='string'&&typeof x.title==='string'&&x.type===1)found=x;});if(!found)throw Error('Missing POPO document');return found;}
function call(args,file){const r=cp.spawnSync(process.execPath,[path.join(pub,'run-popo.mjs'),'popo',...args],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,windowsHide:true});fs.writeFileSync(path.join(pub,file),r.stdout||'','utf8');if(r.stderr)fs.writeFileSync(path.join(pub,file+'.stderr.log'),r.stderr,'utf8');if(r.error)throw r.error;if(r.status!==0)throw Error('CLI failed '+file+': '+r.status);const result=parse(r.stdout||'',file);assertSuccess(result,file);return result;}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
const flat=s=>decode(s.replace(/<[^>]*>/g,'')).replace(/\s+/g,'');
function signature(html){return JSON.stringify({text:flat(html),headings:[...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)].map(m=>flat(m[1])),links:[...html.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"]/g)].map(m=>decode(m[1])),code:[...html.matchAll(/<code-block\b[^>]*>([\s\S]*?)<\/code-block>/g)].map(m=>decode(m[1]).replace(/\r\n/g,'\n')),cells:[...html.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m=>flat(m[1])),attachments:[...html.matchAll(/<attachment\b[^>]*src=['"]([^'"]+)['"]/g)].map(m=>decode(m[1]))});}
let state={baseline:'qisi-3.0',status:'publishing',started_at:new Date().toISOString(),zip_uploaded:true,attachment:{file:attachment.file,bytes:attachment.size,sha256:attachment.sha256},documents:[]};
const save=()=>fs.writeFileSync(path.join(pub,'live-publication-status.json'),JSON.stringify(state,null,2)+'\n','utf8');
save();
try{
 for(const d of docs){
  const before=findDoc(loadResponse(d.key+'-prepublish.json'));
  const command=JSON.parse(fs.readFileSync(path.join(pub,d.key+'.popo-command.json'),'utf8'));
  if(command.type!=='doc.replace_page'||!command.content.startsWith('<doc>')||!command.content.endsWith('</doc>')||command.content.includes('@file:')||command.content.includes('GENERATED_APPENDIX'))throw Error('Invalid publication content '+d.key);
  const current=findDoc(call(['doc_get_doc_detail','docId='+d.docId],d.key+'-just-before.json'));
  const alreadyCurrent=current.title===d.title&&signature(current.content)===signature(command.content);
  if(!alreadyCurrent&&(current.title!==before.title||signature(current.content)!==signature(before.content)))throw Error('Concurrent edits detected; not overwriting '+d.key);
  if(!alreadyCurrent)call(['doc_update_doc','docId='+d.docId,'title='+d.title,'command=@file:'+path.join(pub,d.key+'.popo-command.json')],d.key+'-update.json');
  call(['doc_get_doc_detail','docId='+d.docId],d.key+'-readback.json');
  state.documents.push({key:d.key,doc_id:d.docId,title:d.title,url:d.url,status:alreadyCurrent?'already_current':'updated',readback_received:true});save();
  console.log(d.key+': '+(alreadyCurrent?'already current':'updated')+'; readback received');
 }
 state.status='updated_pending_verification';state.updated_at=new Date().toISOString();save();
}catch(e){state.status='partial_or_failed';state.error=e.message;save();console.error(e.message);process.exitCode=1;}