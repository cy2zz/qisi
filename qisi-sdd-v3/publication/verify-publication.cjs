const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),pub=path.join(root,'publication');
const read=f=>{const b=fs.readFileSync(f);return b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
const response=f=>{const l=read(f).split(/\r?\n/).find(x=>x.startsWith('{"ok":'));if(!l)throw Error('Missing response '+f);const r=JSON.parse(l);if(!r.ok)throw Error("API failure "+f);return r;};
function findDoc(o){if(!o||typeof o!=='object')return null;if(typeof o.content==='string')return o;for(const v of Object.values(o)){const r=findDoc(v);if(r)return r;}return null;}
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
const flat=s=>decode(s.replace(/<[^>]*>/g,'')).replace(/\s+/g,'');
const headings=s=>[...s.matchAll(/<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/gs)].map(m=>flat(m[1]));
const count=(s,t)=>(s.match(new RegExp('<'+t+'\\b','g'))||[]).length;
const links=s=>[...s.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"]/g)].map(m=>decode(m[1]));
const codeBodies=s=>[...s.matchAll(/<code-block\b[^>]*>([\s\S]*?)<\/code-block>/g)].map(m=>decode(m[1]).replace(/\r\n/g,'\n'));
const tableCells=s=>[...s.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m=>flat(m[1]));
const docs=JSON.parse(read(path.join(pub,'documents.json'))),checks=[];
for(const d of docs){
 const actual=findDoc(response(path.join(pub,d.key+'-readback.json')));if(!actual)throw Error('No doc '+d.key);
 const original=read(path.join(pub,d.key+'.popo.html'));
 fs.writeFileSync(path.join(pub,d.key+'-readback.html'),actual.content,'utf8');
 const result={key:d.key,title:actual.title,owner:actual.ownerName,type:actual.type,normalizedTextMatch:flat(original)===flat(actual.content),headingsMatch:JSON.stringify(headings(original))===JSON.stringify(headings(actual.content)),tables:count(actual.content,'table'),diagrams:count(actual.content,'diagram'),codeBlocks:count(actual.content,'code-block'),links:links(actual.content).length,missingLinks:links(original).filter(l=>!links(actual.content).includes(l)),attachments:count(actual.content,'attachment'),containsTemporaryFileMarker:actual.content.includes('@file:'),containsGeneratedMarker:actual.content.includes('GENERATED_APPENDIX')};
 result.codeBlocksMatch=JSON.stringify(codeBodies(original))===JSON.stringify(codeBodies(actual.content));
 result.tableCellsMatch=JSON.stringify(tableCells(original))===JSON.stringify(tableCells(actual.content));
 if(d.key==='prd'){const attachment=JSON.parse(read(path.join(pub,'attachment.json')));result.attachmentUrlPreserved=actual.content.includes(attachment.url);result.attachmentSizePreserved=(actual.content.includes('file-size="'+attachment.size+'"')||actual.content.includes("file-size='"+attachment.size+"'"));}
 result.passed=result.codeBlocksMatch&&result.tableCellsMatch&&result.title===d.title&&result.type===1&&result.normalizedTextMatch&&result.headingsMatch&&result.missingLinks.length===0&&!result.containsTemporaryFileMarker&&!result.containsGeneratedMarker&&['table','diagram','code-block','attachment'].every(t=>count(original,t)===count(actual.content,t))&&(d.key!=='prd'||result.attachmentUrlPreserved&&result.attachmentSizePreserved);
 if(!result.normalizedTextMatch){let i=0,a=flat(original),b=flat(actual.content);while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;result.firstDifference={index:i,source:a.slice(i,i+100),stored:b.slice(i,i+100)};}
 checks.push(result);
}
fs.writeFileSync(path.join(pub,'publication-verification.json'),JSON.stringify({verified_at:new Date().toISOString(),method:'API_readback_content_not_visual_review',documents:checks},null,2),'utf8');
console.log(JSON.stringify(checks,null,2));if(checks.some(x=>!x.passed))process.exitCode=1;