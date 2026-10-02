// Minimal, dependency-free markdown renderer for session transcripts.
// Chat text is not arbitrary attacker content, but we still escape all HTML
// and only emit a small whitelist of tags we control the styling for.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Inline {
  re: RegExp;
  fn: (m: RegExpExecArray) => string;
}

// Applied repeatedly until no substitution happens, so `**a _b_**` nests.
const INLINE_RULES: Inline[] = [
  { re: /`([^`]+)`/, fn: m => '<code>' + m[1] + '</code>' },
  { re: /\*\*([^*]+)\*\*/, fn: m => '<strong>' + m[1] + '</strong>' },
  { re: /(^|[\s(])\*([^*\s][^*]*)\*/, fn: m => m[1] + '<em>' + m[2] + '</em>' },
  { re: /(^|[\s(])_([^_\s][^_]*)_/, fn: m => m[1] + '<em>' + m[2] + '</em>' },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, fn: m => '<a href="' + m[2] + '" target="_blank" rel="noreferrer noopener">' + m[1] + '</a>' },
];

function renderInline(text: string): string {
  let out = escapeHtml(text);
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const rule of INLINE_RULES) {
      const next = out.replace(new RegExp(rule.re.source, 'g'), (match: string, ...groups: string[]) =>
        rule.fn([match, ...groups] as unknown as RegExpExecArray));
      if (next !== out) { out = next; changed = true; }
    }
    if (!changed) break;
  }
  // Autolink bare URLs after escaping; URLs cannot contain quotes so this stays safe.
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>"')]+[^\s<>"').,;:!?)])/g,
    (match: string, pre: string, url: string) => pre + '<a href="' + url + '" target="_blank" rel="noreferrer noopener">' + url + '</a>');
  return out;
}

const STRUCTURAL = /^(\s*```|#{1,6}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s)/;
const HR = /^\s*(?:[-*_]\s*){3,}$/;

/**
 * Render a markdown transcript chunk to HTML. Only the whitelisted constructs
 * above produce markup; everything else is plain, escaped text.
 */
export function renderMarkdown(source: string): string {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let index = 0;
  const pushList = (ordered: boolean, start: number) => {
    const items: string[] = [];
    const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
    while (index < lines.length && re.test(lines[index])) {
      items.push('<li>' + renderInline(lines[index].replace(re, '$1')) + '</li>');
      index++;
    }
    html.push((ordered ? '<ol start="' + start + '">' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
  };
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      index++;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) { code.push(lines[index]); index++; }
      index++; // consume the closing fence when present
      html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
      index++;
      continue;
    }
    if (HR.test(line)) { html.push('<hr>'); index++; continue; }
    if (/^>/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>/.test(lines[index])) { body.push(lines[index].replace(/^>\s?/, '')); index++; }
      html.push('<blockquote>' + renderInline(body.join(' ')) + '</blockquote>');
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) { pushList(false, 1); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const startMatch = line.match(/^\s*(\d+)[.)]\s/);
      pushList(true, startMatch ? Number(startMatch[1]) : 1);
      continue;
    }
    if (!line.trim()) { index++; continue; }
    // Paragraph: merge consecutive non-empty, non-structural lines.
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !STRUCTURAL.test(lines[index])) {
      paragraph.push(lines[index]);
      index++;
    }
    html.push('<p>' + renderInline(paragraph.join('\n')) + '</p>');
  }
  return html.join('');
}
