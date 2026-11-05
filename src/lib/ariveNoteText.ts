import { Parser } from 'htmlparser2';

const ignoredTags = new Set(['script', 'style', 'template', 'noscript', 'head', 'svg', 'math', 'iframe', 'object']);
const blockTags = new Set(['p', 'div', 'blockquote', 'section', 'article', 'header', 'footer', 'address', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);
const paragraphTags = new Set(['p', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Presentation only: never modifies the raw imported note or returns HTML to render. */
export function ariveNotePlainText(raw: string): string {
  // This only chooses whitespace handling; the parser handles all markup and entities.
  const hasMarkup = /<\/?[a-z][\w:-]*(?:\s[^<>]*|\s*)>/i.test(raw);
  let text = '';
  let ignoredDepth = 0;
  let preDepth = 0;
  let listItemDepth = 0;
  const lists: { ordered: boolean; next: number }[] = [];
  function lineBreak(count = 1) {
    text = text.replace(/[ \t]+$/g, '');
    if (!text) return;
    const existing = text.match(/\n*$/)?.[0].length || 0;
    if (existing < count) text += '\n'.repeat(count - existing);
  }
  function listNumber(value: string | undefined, fallback: number) {
    const number = Number(value);
    return value && /^-?\d+$/.test(value) && Number.isSafeInteger(number) && Math.abs(number) <= 100000 ? number : fallback;
  }
  const parser = new Parser({
    onopentag(name, attributes) {
      if (ignoredDepth) { ignoredDepth++; return; }
      if (ignoredTags.has(name)) { ignoredDepth = 1; return; }
      if (name === 'ul' || name === 'ol') {
        lineBreak();
        lists.push({ ordered: name === 'ol', next: listNumber(attributes.start, 1) });
      } else if (name === 'li') {
        lineBreak();
        listItemDepth++;
        const list = lists.at(-1);
        if (list?.ordered) list.next = listNumber(attributes.value, list.next);
        text += `${'  '.repeat(Math.min(20, Math.max(0, lists.length - 1)))}${list?.ordered ? `${list.next++}.` : '•'} `;
      } else if (name === 'br') {
        text = text.replace(/[ \t]+$/g, '') + '\n';
      } else if (name === 'hr') {
        lineBreak(2);
      } else if (blockTags.has(name)) {
        const justOpenedListItem = listItemDepth > 0 && /^[ \t]*(?:•|[-\d]+\.) $/.test(text.slice(text.lastIndexOf('\n') + 1));
        if (!justOpenedListItem) lineBreak(listItemDepth ? 1 : paragraphTags.has(name) ? 2 : 1);
      }
      if (name === 'pre') preDepth++;
    },
    ontext(value) {
      if (ignoredDepth) return;
      let valueText = value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
      if (hasMarkup && !preDepth) {
        valueText = valueText.replace(/[ \t\n\f]+/g, ' ');
        if (!text || /[ \n]$/.test(text)) valueText = valueText.replace(/^ +/, '');
      }
      text += valueText;
    },
    onclosetag(name) {
      if (ignoredDepth) { ignoredDepth--; return; }
      if (name === 'pre') preDepth = Math.max(0, preDepth - 1);
      if (name === 'li') { listItemDepth = Math.max(0, listItemDepth - 1); lineBreak(); }
      else if (name === 'ul' || name === 'ol') { lists.pop(); lineBreak(); }
      else if (name === 'td' || name === 'th') { text += '\t'; }
      else if (blockTags.has(name)) lineBreak(listItemDepth ? 1 : paragraphTags.has(name) ? 2 : 1);
    },
  }, { decodeEntities: true, xmlMode: false });
  parser.end(raw);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
