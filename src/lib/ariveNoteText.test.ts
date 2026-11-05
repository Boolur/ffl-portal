import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ariveNotePlainText } from './ariveNoteText';

describe('Arive note plain-text presentation', () => {
  it('removes Froala attributes and preserves paragraph and line breaks', () => {
    const raw = '<p fr-original-style="" style="margin-top:0">Pending Items: paystubs<br>Updated insurance</p><p>Scheduled Signing: Friday</p>';
    expect(ariveNotePlainText(raw)).toBe('Pending Items: paystubs\nUpdated insurance\n\nScheduled Signing: Friday');
    expect(raw).toContain('fr-original-style');
  });
  it('keeps plain notes and comparisons readable', () => {
    expect(ariveNotePlainText('Income < 5; A&B > C\nPending Items: two paystubs')).toBe('Income < 5; A&B > C\nPending Items: two paystubs');
  });
  it('decodes named, numeric, and nonbreaking-space entities', () => {
    expect(ariveNotePlainText('<p>A&amp;B&nbsp;&lt; 5 &mdash; &#x1F4C4; &#169; &quot;done&quot;</p>')).toBe('A&B < 5 — 📄 © "done"');
  });
  it('handles nested paragraphs and formatting without adding inline gaps', () => {
    expect(ariveNotePlainText('<div>\n <p><strong>Pending</strong> Items: <em>income</em></p>\n <div><p>Insurance</p></div></div>')).toBe('Pending Items: income\n\nInsurance');
  });
  it('formats unordered, ordered, and nested list items', () => {
    expect(ariveNotePlainText('<ul><li><p>Paystubs</p></li><li>Insurance<ul><li>Declarations</li></ul></li></ul><ol start="3"><li>Review</li><li>Complete</li></ol>')).toBe('• Paystubs\n• Insurance\n  • Declarations\n3. Review\n4. Complete');
  });
  it('retains consecutive line breaks', () => {
    expect(ariveNotePlainText('<p>First<br><br>Second</p>')).toBe('First\n\nSecond');
  });
  it('retains preformatted text', () => {
    expect(ariveNotePlainText('<pre>Item A\n  Item B</pre>')).toBe('Item A\n  Item B');
  });
  it('drops scripts, styles, templates, embedded content, and comments', () => {
    expect(ariveNotePlainText('<script>alert("private")</script><style>body { display:none }</style><template><p>Hidden</p></template><!-- comment --><svg><text>Hidden SVG</text></svg><iframe>Hidden frame</iframe><p>Visible note</p>')).toBe('Visible note');
  });
  it('retains link text while dropping every attribute and resource', () => {
    expect(ariveNotePlainText('<p><a href="javascript:alert(1)" onclick="run()" title="private attribute">Review insurance</a><img src="https://example.invalid/tracker" onerror="run()" alt="private attribute"></p>')).toBe('Review insurance');
  });
  it('renders decoded HTML-looking text as escaped React text, never markup', () => {
    const text = ariveNotePlainText('&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;alert(1)&lt;/script&gt;');
    const html = renderToStaticMarkup(createElement('p', null, text));
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });
  it('handles malformed HTML and unterminated script content safely', () => {
    expect(ariveNotePlainText('<p>First<p>Second<br>Third<script>hidden')).toBe('First\n\nSecond\nThird');
  });
  it('works during server rendering without browser DOM APIs', () => {
    expect(typeof document).toBe('undefined');
    expect(renderToStaticMarkup(createElement('p', null, ariveNotePlainText('<p>Ready &amp; reviewed</p>')))).toBe('<p>Ready &amp; reviewed</p>');
  });
});
