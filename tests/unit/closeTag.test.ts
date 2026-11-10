import { xmlLanguage } from '@codemirror/lang-xml';
import { htmlLanguage } from '@codemirror/lang-html';
import { Language } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { tagToClose } from '../../src/doc/closeTag';
import { loadGrammar } from '../../src/doc/syntax';

/** `|` marks the cursor, just after the `</`. */
function closes(language: Language, marked: string): string | null {
  const pos = marked.indexOf('|');
  const state = EditorState.create({ doc: marked.replace('|', ''), extensions: language.extension });
  return tagToClose(state, pos);
}

describe('the tag that </ closes', () => {
  it.each([
    ['<div></|', 'div'],
    ['<div class="x" id=y></|', 'div'],
    ['<div><p>a</p></|', 'div'],
    ['<ul><li>a</|', 'li'],
    ['<DIV></|', 'DIV'],
    ['<my-tag></|', 'my-tag'],
    ['<div>\n  <span>\n    a\n  </|', 'span'],
    ['<div><br></|', 'div'],
    ['<div><img src="a"></|', 'div'],
    ['<div></|>', 'div'],
    ['<p>a<p>b</|', 'p'],
  ])('html: %s', (text, tag) => expect(closes(htmlLanguage, text)).toBe(tag));

  it.each([
    ['</|'],
    ['<br></|'],
    ['<div></div></|'],
    ['<div><!-- </|'],
    ['<div title="</|'],
    ['<div></|</div>'],
    // Could be part of the code, such as a JavaScript string that holds HTML.
    ['<script>a</|'],
    ['<style>a {}</|'],
    ['a </|'],
    ['<div>'],
  ])('html, nothing to close: %s', (text) => expect(closes(htmlLanguage, text.includes('|') ? text : `${text}|`)).toBeNull());

  it.each([
    ['<a></|', 'a'],
    ['<a b="c"><d/></|', 'a'],
    ['<a><ns:d></|', 'ns:d'],
    ['<a><b></b></|', 'a'],
    ['<svg width="1"><g></|', 'g'],
  ])('xml: %s', (text, tag) => expect(closes(xmlLanguage, text)).toBe(tag));

  it.each([['</|'], ['<a></a></|'], ['<a><!-- </|'], ['<a><![CDATA[ </|'], ['<a b="</|']])('xml, nothing to close: %s', (text) =>
    expect(closes(xmlLanguage, text)).toBeNull(),
  );

  it('php: in the HTML around it, but not in the code', async () => {
    const php = (await loadGrammar('a.php'))!;
    expect(closes(php, '<?php echo 1; ?><div></|')).toBe('div');
    expect(closes(php, '<div><?php $a = "</|')).toBeNull();
  });
});
