import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** The tag that a `</` ending at `pos` closes. Null if it isn't a closing tag, or nothing is open. */
export function tagToClose(state: EditorState, pos: number): string | null {
  const typed = syntaxTree(state).resolveInner(pos, -1);
  if (typed.from !== pos - 2 || (typed.name !== 'IncompleteCloseTag' && typed.name !== 'StartCloseTag')) return null;
  const element = typed.parent;
  if (element?.name !== 'Element' || element.lastChild?.name === 'CloseTag') return null;
  const name = element.firstChild?.getChild('TagName');
  return name ? state.sliceDoc(name.from, name.to) : null;
}

/**
 * Typing `</` finishes the closing tag, as Sublime does. Unlike the grammars' own version, this
 * adds nothing on `>`: `</` can only mean a closing tag, whereas `>` may not want one.
 * The name is a separate undo step, so one Undo goes back to exactly the `</` that was typed.
 */
export const closeTagAfterSlash = EditorView.inputHandler.of((view, from, to, text, insert) => {
  // Every keystroke comes through here, so ordinary typing has to stop at the first two checks.
  if (text !== '/' || view.state.sliceDoc(from - 1, from) !== '<' || from !== to || view.composing || view.state.readOnly) return false;
  const typed = insert();
  const { state } = typed;
  const finished = state.changeByRange((range) => {
    const name = range.empty ? tagToClose(state, range.head) : null;
    if (!name) return { range };
    const end = range.head + (state.sliceDoc(range.head, range.head + 1) === '>' ? 1 : 0);
    return {
      changes: { from: range.head, to: end, insert: `${name}>` },
      range: EditorSelection.cursor(range.head + name.length + 1, -1),
    };
  });
  if (finished.changes.empty) return false;
  view.dispatch([typed, state.update(finished, { userEvent: 'input.complete', scrollIntoView: true })]);
  return true;
});
