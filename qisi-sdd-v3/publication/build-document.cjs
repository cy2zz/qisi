const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const name=process.argv[2]; if(!['design','plan','prd'].includes(name))throw new Error('Expected design, plan or prd');
const filename=name==='design'?'design-v6.md':name+'.md';
const md = fs.readFileSync(path.join(root, filename), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let result = '', start = 0;
  for (const m of s.matchAll(re)) {
    result += esc(s.slice(start, m.index));
    if (m[1] !== undefined) result += '<code>' + esc(m[1]) + '</code>';
    else if (m[2] !== undefined) result += '<b>' + esc(m[2]) + '</b>';
    else result += '<a href="' + attr(m[4]) + '">' + esc(m[3]) + '</a>';
    start = m.index + m[0].length;
  }
  return result + esc(s.slice(start));
}
const lines = md.split('\n');
const blocks = [];
let i = 0, listId = 0, previousListType = null;
const cells = s => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) { previousListType = null; i++; continue; }
  if (/^<!-- GENERATED_APPENDIX -->\s*$/.test(line)) { previousListType = null; i++; continue; }
  if (/^>\s?/.test(line)) {
    const quote = []; while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
    blocks.push("<blockquote><p>" + inline(quote.join(" ")) + "</p></blockquote>"); previousListType = null; continue;
  }
  let m;
  if ((m = line.match(/^```(\w*)\s*$/))) {
    const lang = m[1] || 'text', body = []; i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
    if (i >= lines.length) throw new Error('Unclosed code block');
    i++;
    const text = body.join('\n');
    if (lang === 'json') JSON.parse(text);
    blocks.push(lang === 'mermaid' ? '<diagram language="Mermaid">' + esc(text) + '</diagram>' : '<code-block language="' + attr(lang) + '" wrap="true">' + esc(text) + '</code-block>');
    previousListType = null; continue;
  }
  if ((m = line.match(/^(#{1,6})\s+(.+)$/))) {
    const h = 'h' + m[1].length;
    blocks.push('<' + h + '>' + inline(m[2]) + '</' + h + '>');
    previousListType = null; i++; continue;
  }
  if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|\-]+\|\s*$/.test(lines[i+1])) {
    const rows = [cells(line)]; i += 2;
    while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
    const n = rows[0].length;
    if (rows.some(r => r.length !== n)) throw new Error('Table column mismatch');
    blocks.push('<table title-line-open="true"><colgroup>' + Array.from({length:n}, (_,j) => '<col style="width: ' + (j === 0 ? 160 : 270) + 'px;" />').join('') + '</colgroup><tbody>' + rows.map((r,k) => '<tr>' + r.map(c => '<' + (k ? 'td' : 'th') + '><p>' + inline(c) + '</p></' + (k ? 'td' : 'th') + '>').join('') + '</tr>').join('') + '</tbody></table>');
    previousListType = null; continue;
  }
  if ((m = line.match(/^(?:([-*])|\d+\.)\s+(.+)$/))) {
    const type = m[1] ? 'unordered' : 'ordered';
    if (previousListType !== type) listId++;
    blocks.push('<doc-li list-id="v3-list-' + listId + '" list-type="' + type + '">' + inline(m[2]) + '</doc-li>');
    previousListType = type; i++; continue;
  }
  const para = [line.trim()]; i++;
  while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||[-*]\s|\d+\.\s|>\s?|<!-- GENERATED_APPENDIX -->)/.test(lines[i])) para.push(lines[i++].trim());
  blocks.push('<p>' + inline(para.join(' ')) + '</p>');
  previousListType = null;
}
let html = '<doc>\n' + blocks.join('\n') + '\n</doc>';
if(name==='prd' && fs.existsSync(path.join(root,'publication/attachment.json'))){const a=JSON.parse(fs.readFileSync(path.join(root,'publication/attachment.json'),'utf8'));html=html.replace('</doc>','<attachment src="'+attr(a.url)+'" file-size="'+a.size+'" />\n</doc>');}
const command = {type: 'doc.replace_page', content: html};
fs.writeFileSync(path.join(root,'publication',name+'.popo.html'), html, 'utf8');
fs.writeFileSync(path.join(root,'publication',name+'.popo-command.json'), JSON.stringify(command), 'utf8');
const headings = [...html.matchAll(/<h[1-6]>(.*?)<\/h[1-6]>/g)].map(m=>m[1]);
const refs = [...new Set([...md.matchAll(/\[R(\d+)\]/g)].map(m=>m[1]))];

if (html.includes('@file:')) throw new Error('Unexpected file marker');
const summary = {markdownChars:md.length, htmlChars:html.length, bytes:Buffer.byteLength(html), topLevelBlocks:blocks.length, headings:headings.length, tables:(html.match(/<table\b/g)||[]).length, diagrams:(html.match(/<diagram\b/g)||[]).length, jsonExamples:(md.match(/```json/g)||[]).length, references:refs, firstHeading:headings[0], lastHeading:headings.at(-1)};
fs.writeFileSync(path.join(root,'publication',name+'.build-check.json'), JSON.stringify(summary,null,2),'utf8');
console.log(JSON.stringify(summary,null,2));
