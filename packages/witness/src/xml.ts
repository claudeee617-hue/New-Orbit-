/**
 * A small, strict-enough XML reader for report files (Cobertura, JUnit). It never expands custom
 * entities, never fetches anything and refuses DOCTYPE declarations, so hostile reports cannot
 * trigger entity expansion or external reads. Malformed input throws XmlError.
 */
export class XmlError extends Error {}

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

const MAX_DEPTH = 200;
const MAX_ELEMENTS = 2_000_000;

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '';
      }
    }
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(input: string): XmlElement {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (/<!DOCTYPE/i.test(text)) throw new XmlError('DOCTYPE declarations are not accepted');
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let count = 0;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('unterminated comment');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('unterminated CDATA section');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlError('unterminated processing instruction');
      i = end + 2;
      continue;
    }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + 1;
    let quote = '';
    while (j < text.length) {
      const c = text[j] as string;
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j += 1;
    }
    if (j >= text.length) throw new XmlError('unterminated tag');
    const body = text.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      const open = stack.pop();
      if (!open || stack.length === 0 || open.name !== name)
        throw new XmlError(`unexpected closing tag </${name}>`);
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^([^\s/>]+)/.exec(inner);
    if (!nameMatch) throw new XmlError('tag without a name');
    const name = nameMatch[1] as string;
    const attrs: Record<string, string> = {};
    ATTR.lastIndex = 0;
    for (let m = ATTR.exec(inner.slice(name.length)); m; m = ATTR.exec(inner.slice(name.length)))
      attrs[m[1] as string] = decode((m[2] ?? m[3]) as string);
    count += 1;
    if (count > MAX_ELEMENTS) throw new XmlError('document has too many elements');
    const element: XmlElement = { name, attrs, children: [] };
    (stack[stack.length - 1] as XmlElement).children.push(element);
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > MAX_DEPTH) throw new XmlError('document is nested too deeply');
    }
  }
  if (stack.length !== 1) throw new XmlError(`unclosed element <${stack[stack.length - 1]?.name}>`);
  const top = root.children[0];
  if (!top) throw new XmlError('document has no root element');
  return top;
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name);
}
