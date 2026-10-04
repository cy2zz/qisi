import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const resources = JSON.parse(readFileSync(join(directory, 'resources.json'), 'utf8'));
const lines = readFileSync(join(directory, 'README.md'), 'utf8').split(/\r?\n/);
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const blocks = [];
let index = 0;
while (index < lines.length) {
  const line = lines[index];
  if (!line.trim()) { index++; continue; }
  const heading = /^(#{1,6}) (.+)$/.exec(line);
  if (heading) { const level = heading[1].length; blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); index++; continue; }
  const image = /^!\[(.*?)\]\((.*?)\)$/.exec(line);
  if (image) { const url = resources.images[image[2]]; if (!url) throw new Error('Missing uploaded image: ' + image[2]); blocks.push('<img src="' + url + '"/>'); blocks.push('<p>' + inline(image[1]) + '</p>'); index++; continue; }
  if (line.startsWith('```')) {
    const language = line.slice(3).trim() || 'text';
    const code = [];
    index++;
    while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
    if (index === lines.length) throw new Error('Unclosed code fence');
    blocks.push('<code-block language="' + escape(language) + '">' + escape(code.join('\n')) + '</code-block>');
    index++;
    continue;
  }
  if (line.startsWith('|')) {
    const rows = [];
    while (index < lines.length && lines[index].startsWith('|')) {
      const cells = lines[index++].split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
      rows.push('<tr>' + cells.map(cell => '<td><p>' + inline(cell) + '</p></td>').join('') + '</tr>');
    }
    blocks.push('<table title-line-open="true"><tbody>' + rows.join('') + '</tbody></table>');
    continue;
  }
  const paragraph = [line];
  index++;
  while (index < lines.length && lines[index].trim() && !/^(#|\||!\[|```)/.test(lines[index])) paragraph.push(lines[index++]);
  blocks.push('<p>' + inline(paragraph.join(' ')) + '</p>');
}
blocks.push('<h2>附：可编辑流程图源文件</h2><p>三张图可下载后使用 draw.io 打开编辑；正文图片与源文件对应。</p>');
for (const [name, url] of Object.entries(resources.attachments)) {
  blocks.push('<attachment file-name="' + escape(name) + '" file-size="' + statSync(join(directory,name)).size + '" src="' + url + '"/>');
}
const content = '<doc>' + blocks.join('\n') + '</doc>';
if ((content.match(/<img /g) || []).length !== 3) throw new Error('Expected three diagrams');
if ((content.match(/<code-block /g) || []).length !== 2) throw new Error('Expected two code blocks');
writeFileSync(join(directory, 'popo-content.html'), content, 'utf8');
writeFileSync(join(directory, 'popo-command.json'), JSON.stringify({ type: 'doc.replace_page', content }), 'utf8');
console.log(JSON.stringify({ characters: content.length, blocks: blocks.length, tables: (content.match(/<table /g) || []).length, images: 3, attachments: 3, codeBlocks: 2 }));

