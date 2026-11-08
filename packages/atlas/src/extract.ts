import type { Node } from 'web-tree-sitter';
import { parseSource } from './parsers.js';
import type {
  ExtractedCall,
  ExtractedImport,
  ExtractedSymbol,
  FileExtraction,
  ImportKind,
  Language,
  SourceLocation,
  SymbolKind,
  UnsupportedConstruct,
} from './types.js';

const MAX_DEPTH = 400;
const MAX_UNSUPPORTED = 100;

interface Frame {
  qualifiedName: string;
  own: number;
}

interface Ctx {
  language: Language;
  scope: string[];
  /** Whether each enclosing scope is exported/public (for method visibility). */
  scopeExported: boolean[];
  frames: Frame[];
  fileOwn: number;
  functionComplexities: number;
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
  calls: ExtractedCall[];
  unsupported: UnsupportedConstruct[];
  unsupportedOverflow: number;
  parseErrors: number;
  entryPointReasons: string[];
  packageName: string | undefined;
  deepReported: boolean;
}

function loc(node: Node): SourceLocation {
  return {
    startLine: node.startPosition.row + 1,
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

function field(node: Node, name: string): Node | null {
  return node.childForFieldName(name);
}

function named(node: Node): Node[] {
  return node.namedChildren.filter((child): child is Node => child !== null);
}

function stripQuotes(text: string): string {
  const first = text[0];
  if ((first === '"' || first === "'" || first === '`') && text.length >= 2)
    return text.slice(1, -1);
  return text;
}

function addUnsupported(ctx: Ctx, node: Node, construct: string, reason: string): void {
  if (ctx.unsupported.length >= MAX_UNSUPPORTED) {
    ctx.unsupportedOverflow += 1;
    return;
  }
  ctx.unsupported.push({ construct, reason, location: loc(node) });
}

function bump(ctx: Ctx): void {
  const frame = ctx.frames[ctx.frames.length - 1];
  if (frame) frame.own += 1;
  else ctx.fileOwn += 1;
}

function qualify(ctx: Ctx, name: string): string {
  return [...ctx.scope, name].join('.');
}

interface Declared {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  /** Function-like: opens a complexity frame and call-enclosure. */
  callable: boolean;
  /** Container: its name becomes part of nested qualified names. */
  container: boolean;
}

function declare(ctx: Ctx, node: Node, d: Declared, walkChildren: () => void): void {
  const qualifiedName = qualify(ctx, d.name);
  const symbol: ExtractedSymbol = {
    name: d.name,
    qualifiedName,
    kind: d.kind,
    location: loc(node),
    exported: d.exported,
  };
  ctx.symbols.push(symbol);
  if (d.callable) {
    const frame: Frame = { qualifiedName, own: 0 };
    ctx.frames.push(frame);
    ctx.scope.push(d.name);
    ctx.scopeExported.push(d.exported);
    walkChildren();
    ctx.scopeExported.pop();
    ctx.scope.pop();
    ctx.frames.pop();
    symbol.complexity = 1 + frame.own;
    ctx.functionComplexities += symbol.complexity;
  } else if (d.container) {
    ctx.scope.push(d.name);
    ctx.scopeExported.push(d.exported);
    walkChildren();
    ctx.scopeExported.pop();
    ctx.scope.pop();
  } else {
    walkChildren();
  }
}

function pushImport(
  ctx: Ctx,
  node: Node,
  specifier: string,
  kind: ImportKind,
  names: string[],
  confidence: number,
  relativeLevel = 0,
): void {
  ctx.imports.push({ specifier, kind, names, relativeLevel, location: loc(node), confidence });
}

function pushCall(ctx: Ctx, node: Node, callee: string, receiver?: string): void {
  const call: ExtractedCall = { callee, location: loc(node) };
  if (receiver !== undefined) call.receiver = receiver;
  const enclosing = ctx.frames[ctx.frames.length - 1]?.qualifiedName;
  if (enclosing !== undefined) call.enclosing = enclosing;
  ctx.calls.push(call);
}

// ---------------------------------------------------------------------------------------------
// TypeScript / JavaScript
// ---------------------------------------------------------------------------------------------

const JS_FUNCTION_VALUES = new Set([
  'arrow_function',
  'function_expression',
  'function',
  'generator_function',
]);

function jsExported(node: Node): boolean {
  let current: Node | null = node.parent;
  for (let i = 0; i < 3 && current; i += 1) {
    if (current.type === 'export_statement') return true;
    current = current.parent;
  }
  return false;
}

function jsDecision(node: Node, ctx: Ctx): void {
  switch (node.type) {
    case 'if_statement':
    case 'for_statement':
    case 'for_in_statement':
    case 'while_statement':
    case 'do_statement':
    case 'switch_case':
    case 'catch_clause':
    case 'ternary_expression':
      bump(ctx);
      break;
    case 'binary_expression': {
      const op = field(node, 'operator')?.text;
      if (op === '&&' || op === '||' || op === '??') bump(ctx);
      break;
    }
    default:
  }
}

function jsImportNames(node: Node): string[] {
  const names: string[] = [];
  for (const spec of node.descendantsOfType([
    'import_specifier',
    'export_specifier',
    'namespace_import',
    'namespace_export',
  ])) {
    if (!spec) continue;
    if (spec.type === 'namespace_import' || spec.type === 'namespace_export') names.push('*');
    else names.push(field(spec, 'name')?.text ?? spec.text);
  }
  for (const child of named(node)) {
    if (child.type === 'import_clause') {
      for (const part of named(child)) if (part.type === 'identifier') names.push('default');
    }
  }
  return names;
}

function jsVisit(node: Node, ctx: Ctx, recurse: (n: Node) => void): boolean {
  jsDecision(node, ctx);
  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      declare(
        ctx,
        node,
        { name, kind: 'function', exported: jsExported(node), callable: true, container: false },
        () => recurse(node),
      );
      return true;
    }
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'class': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      declare(
        ctx,
        node,
        { name, kind: 'class', exported: jsExported(node), callable: false, container: true },
        () => recurse(node),
      );
      return true;
    }
    case 'interface_declaration': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      declare(
        ctx,
        node,
        { name, kind: 'interface', exported: jsExported(node), callable: false, container: true },
        () => recurse(node),
      );
      return true;
    }
    case 'type_alias_declaration':
    case 'enum_declaration': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      const kind: SymbolKind = node.type === 'enum_declaration' ? 'enum' : 'type';
      declare(
        ctx,
        node,
        { name, kind, exported: jsExported(node), callable: false, container: false },
        () => recurse(node),
      );
      return true;
    }
    case 'internal_module':
    case 'module': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      declare(
        ctx,
        node,
        {
          name: stripQuotes(name),
          kind: 'namespace',
          exported: jsExported(node),
          callable: false,
          container: true,
        },
        () => recurse(node),
      );
      return true;
    }
    case 'method_definition': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      const accessibility = named(node).find((c) => c.type === 'accessibility_modifier')?.text;
      const classExported = ctx.scopeExported[ctx.scopeExported.length - 1] ?? false;
      const exported =
        classExported &&
        accessibility !== 'private' &&
        accessibility !== 'protected' &&
        !name.startsWith('#');
      declare(ctx, node, { name, kind: 'method', exported, callable: true, container: false }, () =>
        recurse(node),
      );
      return true;
    }
    case 'variable_declarator': {
      const value = field(node, 'value');
      const nameNode = field(node, 'name');
      if (value && nameNode?.type === 'identifier' && JS_FUNCTION_VALUES.has(value.type)) {
        declare(
          ctx,
          node,
          {
            name: nameNode.text,
            kind: 'function',
            exported: jsExported(node),
            callable: true,
            container: false,
          },
          () => recurse(value),
        );
        return true;
      }
      return false;
    }
    case 'public_field_definition':
    case 'field_definition': {
      const value = field(node, 'value');
      const nameNode = field(node, 'name') ?? field(node, 'property');
      if (value && nameNode && JS_FUNCTION_VALUES.has(value.type)) {
        const classExported = ctx.scopeExported[ctx.scopeExported.length - 1] ?? false;
        declare(
          ctx,
          node,
          {
            name: nameNode.text,
            kind: 'method',
            exported: classExported,
            callable: true,
            container: false,
          },
          () => recurse(value),
        );
        return true;
      }
      return false;
    }
    case 'import_statement': {
      const source = field(node, 'source');
      if (source) {
        // `import type { X } from …` is erased at compile time: no runtime dependency.
        const typeOnly = node.children.some((c) => c?.type === 'type');
        pushImport(
          ctx,
          node,
          stripQuotes(source.text),
          typeOnly ? 'type' : 'static',
          jsImportNames(node),
          1,
        );
      }
      return false;
    }
    case 'export_statement': {
      const source = field(node, 'source');
      if (source) {
        const names = jsImportNames(node);
        // `export * from './x'` has an anonymous `*` token rather than a named child.
        if (node.children.some((c) => c?.type === '*')) names.push('*');
        pushImport(ctx, node, stripQuotes(source.text), 'reexport', names, 1);
      }
      return false;
    }
    case 'call_expression': {
      const fn = field(node, 'function');
      const args = field(node, 'arguments');
      const firstArg = args ? named(args)[0] : undefined;
      if (fn?.type === 'import') {
        if (firstArg?.type === 'string')
          pushImport(ctx, node, stripQuotes(firstArg.text), 'dynamic', [], 0.9);
        else
          addUnsupported(
            ctx,
            node,
            'dynamic-import',
            'import() with a non-literal specifier cannot be resolved statically',
          );
      } else if (fn?.type === 'identifier' && fn.text === 'require') {
        if (firstArg?.type === 'string')
          pushImport(ctx, node, stripQuotes(firstArg.text), 'require', [], 0.95);
        else
          addUnsupported(
            ctx,
            node,
            'dynamic-require',
            'require() with a non-literal specifier cannot be resolved statically',
          );
      } else if (fn?.type === 'identifier') {
        if (fn.text === 'eval')
          addUnsupported(ctx, node, 'eval', 'eval() executes code that static analysis cannot see');
        pushCall(ctx, node, fn.text);
      } else if (fn?.type === 'member_expression') {
        const property = field(fn, 'property')?.text;
        const object = field(fn, 'object');
        if (property)
          pushCall(
            ctx,
            node,
            property,
            object && object.type === 'identifier'
              ? object.text
              : object?.type === 'this'
                ? 'this'
                : undefined,
          );
      }
      return false;
    }
    case 'new_expression': {
      const ctor = field(node, 'constructor');
      if (ctor?.type === 'identifier') {
        if (ctor.text === 'Function')
          addUnsupported(
            ctx,
            node,
            'new-function',
            'new Function() executes code that static analysis cannot see',
          );
        pushCall(ctx, node, ctor.text);
      }
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------------------------

function pyDottedText(node: Node): string {
  return node.text.replace(/\s+/g, '');
}

function pyVisit(node: Node, ctx: Ctx, recurse: (n: Node) => void): boolean {
  switch (node.type) {
    case 'if_statement': {
      bump(ctx);
      const condition = field(node, 'condition')?.text ?? '';
      if (
        ctx.frames.length === 0 &&
        condition.includes('__name__') &&
        condition.includes('__main__')
      ) {
        ctx.entryPointReasons.push('python __main__ guard');
      }
      return false;
    }
    case 'elif_clause':
    case 'for_statement':
    case 'while_statement':
    case 'except_clause':
    case 'boolean_operator':
    case 'conditional_expression':
    case 'for_in_clause':
    case 'if_clause':
    case 'case_clause':
      bump(ctx);
      return false;
    case 'function_definition': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      const inClass =
        ctx.scope.length > 0 &&
        ctx.symbols.some((s) => s.qualifiedName === ctx.scope.join('.') && s.kind === 'class');
      const topLevel = ctx.scope.length === 0;
      declare(
        ctx,
        node,
        {
          name,
          kind: inClass ? 'method' : 'function',
          exported: (topLevel || inClass) && !name.startsWith('_'),
          callable: true,
          container: false,
        },
        () => recurse(node),
      );
      return true;
    }
    case 'class_definition': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      declare(
        ctx,
        node,
        {
          name,
          kind: 'class',
          exported: ctx.scope.length === 0 && !name.startsWith('_'),
          callable: false,
          container: true,
        },
        () => recurse(node),
      );
      return true;
    }
    case 'import_statement': {
      for (const child of named(node)) {
        const target = child.type === 'aliased_import' ? field(child, 'name') : child;
        if (target?.type === 'dotted_name')
          pushImport(ctx, node, pyDottedText(target), 'static', [], 1);
      }
      return false;
    }
    case 'import_from_statement': {
      const module = field(node, 'module_name');
      if (!module) return false;
      let level = 0;
      let specifier = '';
      if (module.type === 'relative_import') {
        for (const part of named(module)) {
          if (part.type === 'import_prefix') level = part.text.length;
          else if (part.type === 'dotted_name') specifier = pyDottedText(part);
        }
      } else specifier = pyDottedText(module);
      const names: string[] = [];
      for (const child of node.childrenForFieldName('name')) {
        if (!child) continue;
        names.push(
          child.type === 'aliased_import' ? (field(child, 'name')?.text ?? child.text) : child.text,
        );
      }
      if (named(node).some((c) => c.type === 'wildcard_import')) {
        names.push('*');
        addUnsupported(
          ctx,
          node,
          'wildcard-import',
          'from … import * brings in names that are not listed',
        );
      }
      pushImport(ctx, node, specifier, 'static', names, 1, level);
      return false;
    }
    case 'call': {
      const fn = field(node, 'function');
      const args = field(node, 'arguments');
      const firstArg = args ? named(args)[0] : undefined;
      if (fn?.type === 'identifier') {
        if (fn.text === 'eval' || fn.text === 'exec')
          addUnsupported(
            ctx,
            node,
            fn.text,
            `${fn.text}() executes code that static analysis cannot see`,
          );
        if (fn.text === '__import__') {
          if (firstArg?.type === 'string')
            pushImport(
              ctx,
              node,
              stripQuotes(firstArg.text.replace(/^[rbfu]+(?=["'])/i, '')),
              'dynamic',
              [],
              0.8,
            );
          else
            addUnsupported(
              ctx,
              node,
              'dynamic-import',
              '__import__ with a non-literal argument cannot be resolved statically',
            );
        }
        pushCall(ctx, node, fn.text);
      } else if (fn?.type === 'attribute') {
        const attribute = field(fn, 'attribute')?.text;
        const object = field(fn, 'object');
        if (attribute === 'import_module' && object?.text === 'importlib') {
          if (firstArg?.type === 'string')
            pushImport(ctx, node, stripQuotes(firstArg.text), 'dynamic', [], 0.8);
          else
            addUnsupported(
              ctx,
              node,
              'dynamic-import',
              'importlib.import_module with a non-literal argument cannot be resolved statically',
            );
        }
        if (attribute)
          pushCall(ctx, node, attribute, object?.type === 'identifier' ? object.text : undefined);
      }
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------------------------

function javaModifiers(node: Node): string {
  return named(node).find((c) => c.type === 'modifiers')?.text ?? '';
}

function javaVisit(node: Node, ctx: Ctx, recurse: (n: Node) => void): boolean {
  switch (node.type) {
    case 'if_statement':
    case 'for_statement':
    case 'enhanced_for_statement':
    case 'while_statement':
    case 'do_statement':
    case 'catch_clause':
    case 'ternary_expression':
      bump(ctx);
      return false;
    case 'switch_block_statement_group':
    case 'switch_rule': {
      // `default` is the fall-through branch, not an extra decision.
      const label = named(node).find((c) => c.type === 'switch_label')?.text ?? '';
      if (!label.trim().startsWith('default')) bump(ctx);
      return false;
    }
    case 'binary_expression': {
      const op = field(node, 'operator')?.text;
      if (op === '&&' || op === '||') bump(ctx);
      return false;
    }
    case 'package_declaration': {
      const id = named(node).find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (id) ctx.packageName = id.text;
      return false;
    }
    case 'import_declaration': {
      const id = named(node).find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (!id) return false;
      const wildcard = named(node).some((c) => c.type === 'asterisk');
      const isStatic = node.children.some((c) => c?.type === 'static');
      const names = wildcard ? ['*'] : isStatic ? [id.text.split('.').pop() ?? id.text] : [];
      pushImport(ctx, node, id.text, 'static', names, 1);
      return false;
    }
    case 'class_declaration':
    case 'interface_declaration':
    case 'enum_declaration':
    case 'record_declaration':
    case 'annotation_type_declaration': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      const kind: SymbolKind =
        node.type === 'interface_declaration' || node.type === 'annotation_type_declaration'
          ? 'interface'
          : node.type === 'enum_declaration'
            ? 'enum'
            : 'class';
      declare(
        ctx,
        node,
        {
          name,
          kind,
          exported: /\bpublic\b/.test(javaModifiers(node)),
          callable: false,
          container: true,
        },
        () => recurse(node),
      );
      return true;
    }
    case 'method_declaration':
    case 'constructor_declaration': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      const modifiers = javaModifiers(node);
      if (
        node.type === 'method_declaration' &&
        name === 'main' &&
        /\bstatic\b/.test(modifiers) &&
        /\bpublic\b/.test(modifiers)
      ) {
        ctx.entryPointReasons.push('java public static void main');
      }
      declare(
        ctx,
        node,
        {
          name,
          kind: 'method',
          exported: /\bpublic\b/.test(modifiers),
          callable: true,
          container: false,
        },
        () => recurse(node),
      );
      return true;
    }
    case 'method_invocation': {
      const name = field(node, 'name')?.text;
      const object = field(node, 'object');
      if (name)
        pushCall(
          ctx,
          node,
          name,
          object && (object.type === 'identifier' || object.type === 'this')
            ? object.text
            : undefined,
        );
      return false;
    }
    case 'object_creation_expression': {
      const type = field(node, 'type');
      if (type) pushCall(ctx, node, type.text.split('<')[0] ?? type.text);
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// C / C++
// ---------------------------------------------------------------------------------------------

function cFunctionName(declarator: Node | null): string | undefined {
  let current: Node | null = declarator;
  for (let i = 0; i < 8 && current; i += 1) {
    if (current.type === 'function_declarator') {
      const inner = field(current, 'declarator');
      if (!inner) return undefined;
      if (
        inner.type === 'identifier' ||
        inner.type === 'field_identifier' ||
        inner.type === 'qualified_identifier' ||
        inner.type === 'destructor_name' ||
        inner.type === 'operator_name' ||
        inner.type === 'template_function'
      ) {
        return inner.text;
      }
      if (inner.type === 'parenthesized_declarator') {
        current = inner;
        continue;
      }
      return undefined;
    }
    current = field(current, 'declarator') ?? named(current)[0] ?? null;
  }
  return undefined;
}

function cVisit(node: Node, ctx: Ctx, recurse: (n: Node) => void): boolean {
  switch (node.type) {
    case 'if_statement':
    case 'for_statement':
    case 'for_range_loop':
    case 'while_statement':
    case 'do_statement':
    case 'catch_clause':
    case 'conditional_expression':
      bump(ctx);
      return false;
    case 'case_statement':
      if (field(node, 'value')) bump(ctx);
      return false;
    case 'binary_expression': {
      const op = field(node, 'operator')?.text;
      if (op === '&&' || op === '||') bump(ctx);
      return false;
    }
    case 'preproc_include': {
      const path = field(node, 'path');
      if (!path) return false;
      if (path.type === 'system_lib_string')
        pushImport(ctx, node, path.text.replace(/^<|>$/g, ''), 'include-system', [], 1);
      else if (path.type === 'string_literal')
        pushImport(ctx, node, stripQuotes(path.text), 'include-local', [], 1);
      else
        addUnsupported(
          ctx,
          node,
          'computed-include',
          '#include with a macro-computed path cannot be resolved',
        );
      return false;
    }
    case 'preproc_ifdef':
    case 'preproc_if':
      addUnsupported(
        ctx,
        node,
        'conditional-compilation',
        'Both branches are parsed; which branch is active depends on build flags',
      );
      return false;
    case 'preproc_function_def':
      addUnsupported(ctx, node, 'macro', 'Function-like macros are not expanded');
      return false;
    case 'function_definition': {
      const fullName = cFunctionName(field(node, 'declarator'));
      if (!fullName) return false;
      const parts = fullName.split('::');
      const name = parts[parts.length - 1] ?? fullName;
      const inType = ctx.scope.length > 0;
      const qualified = parts.length > 1;
      const isStatic = named(node).some(
        (c) => c.type === 'storage_class_specifier' && c.text === 'static',
      );
      if (name === 'main' && !inType && !qualified)
        ctx.entryPointReasons.push('C/C++ main function');
      const symbolName = fullName.replace(/::/g, '.');
      declare(
        ctx,
        node,
        {
          name: symbolName,
          kind: inType || qualified ? 'method' : 'function',
          exported: !isStatic,
          callable: true,
          container: false,
        },
        () => recurse(node),
      );
      return true;
    }
    case 'struct_specifier':
    case 'class_specifier':
    case 'union_specifier':
    case 'enum_specifier': {
      const name = field(node, 'name')?.text;
      const body = field(node, 'body');
      if (!name || !body) return false;
      const kind: SymbolKind =
        node.type === 'enum_specifier'
          ? 'enum'
          : node.type === 'class_specifier'
            ? 'class'
            : 'struct';
      declare(ctx, node, { name, kind, exported: true, callable: false, container: true }, () =>
        recurse(node),
      );
      return true;
    }
    case 'namespace_definition': {
      const name = field(node, 'name')?.text;
      if (!name) return false;
      declare(
        ctx,
        node,
        { name, kind: 'namespace', exported: true, callable: false, container: true },
        () => recurse(node),
      );
      return true;
    }
    case 'call_expression': {
      const fn = field(node, 'function');
      if (fn?.type === 'identifier') pushCall(ctx, node, fn.text);
      else if (fn?.type === 'field_expression') {
        const f = field(fn, 'field')?.text;
        const arg = field(fn, 'argument');
        if (f)
          pushCall(
            ctx,
            node,
            f,
            arg?.type === 'identifier' || arg?.type === 'this' ? arg.text : undefined,
          );
      } else if (fn?.type === 'qualified_identifier') {
        const parts = fn.text.split('::');
        const callee = parts[parts.length - 1];
        if (callee)
          pushCall(ctx, node, callee, parts.length > 1 ? parts[parts.length - 2] : undefined);
      }
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------

function visitFor(
  language: Language,
): (node: Node, ctx: Ctx, recurse: (n: Node) => void) => boolean {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return jsVisit;
    case 'python':
      return pyVisit;
    case 'java':
      return javaVisit;
    case 'c':
    case 'cpp':
      return cVisit;
  }
}

function walk(node: Node, ctx: Ctx, visit: ReturnType<typeof visitFor>, depth: number): void {
  if (depth > MAX_DEPTH) {
    if (!ctx.deepReported) {
      ctx.deepReported = true;
      addUnsupported(
        ctx,
        node,
        'deep-nesting',
        `Syntax nested deeper than ${MAX_DEPTH} levels; the rest of this branch was not analysed`,
      );
    }
    return;
  }
  if (node.isError || node.isMissing) {
    ctx.parseErrors += 1;
    addUnsupported(
      ctx,
      node,
      'syntax-error',
      node.isMissing ? 'Missing token (parser recovered)' : 'Syntax the grammar could not parse',
    );
    if (node.isError) {
      // Still look inside: partial results are labelled by parseErrors > 0.
      for (const child of named(node)) walk(child, ctx, visit, depth + 1);
      return;
    }
  }
  const recurse = (n: Node): void => {
    for (const child of named(n)) walk(child, ctx, visit, depth + 1);
  };
  const handled = visit(node, ctx, recurse);
  if (!handled) recurse(node);
}

export interface ExtractOptions {
  skipCalls?: boolean;
}

/**
 * Parse `content` with tree-sitter and extract symbols, imports, calls and complexity.
 * Returns `undefined` only when the parser timed out.
 */
export async function extractFile(
  language: Language,
  path: string,
  content: string,
  options: ExtractOptions = {},
): Promise<FileExtraction | undefined> {
  const parsed = await parseSource(language, path, content);
  if (!parsed) return undefined;
  try {
    const ctx: Ctx = {
      language,
      scope: [],
      scopeExported: [],
      frames: [],
      fileOwn: 0,
      functionComplexities: 0,
      symbols: [],
      imports: [],
      calls: [],
      unsupported: [],
      unsupportedOverflow: 0,
      parseErrors: 0,
      entryPointReasons: [],
      packageName: undefined,
      deepReported: false,
    };
    walk(parsed.tree.rootNode, ctx, visitFor(language), 0);
    if (ctx.unsupportedOverflow > 0) {
      ctx.unsupported.push({
        construct: 'truncated',
        reason: `${ctx.unsupportedOverflow} further unsupported constructs in this file were not listed`,
        location: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 },
      });
    }
    const extraction: FileExtraction = {
      language,
      lines: content === '' ? 0 : content.split('\n').length,
      symbols: ctx.symbols,
      imports: ctx.imports,
      calls: options.skipCalls === true ? [] : ctx.calls,
      unsupported: ctx.unsupported,
      parseErrors: ctx.parseErrors,
      complexity: ctx.fileOwn + ctx.functionComplexities,
      entryPointReasons: [...new Set(ctx.entryPointReasons)],
    };
    if (ctx.packageName !== undefined) extraction.packageName = ctx.packageName;
    return extraction;
  } finally {
    parsed.tree.delete();
  }
}
