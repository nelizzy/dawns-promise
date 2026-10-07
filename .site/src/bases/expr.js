// Tokenizer + parser for Bases expressions (JavaScript-like). Produces a small AST.
import { BaseError } from './values.js';

const PUNCT = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '?.', '+', '-', '*', '/', '%', '>', '<', '!', '(', ')', '[', ']', '{', '}', ',', '.', ':', '?'];

function tokenize(src) {
  const toks = [];
  let i = 0;
  const prevAllowsRegex = () => {
    const p = toks[toks.length - 1];
    return !p || (p.t === 'p' && ![')', ']', '}'].includes(p.v));
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
      toks.push({ t: 'n', v: Number(m[0]), pos: i }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, out = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          const n = src[j + 1];
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
          j += 2;
        } else out += src[j++];
      }
      if (j >= src.length) throw new BaseError(`Unterminated string starting at position ${i}`);
      toks.push({ t: 's', v: out, pos: i }); i = j + 1; continue;
    }
    if (c === '/' && prevAllowsRegex()) {
      let j = i + 1, inClass = false;
      while (j < src.length && (src[j] !== '/' || inClass)) { if (src[j] === '\\') j++; else if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; j++; }
      if (j >= src.length) throw new BaseError(`Unterminated regular expression at position ${i}`);
      const body = src.slice(i + 1, j); j++;
      const fm = /^[a-z]*/.exec(src.slice(j))[0]; j += fm.length;
      toks.push({ t: 're', v: body, flags: fm, pos: i }); i = j; continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      const m = /^[\p{L}\p{N}_$]+/u.exec(src.slice(i));
      toks.push({ t: 'id', v: m[0], pos: i }); i += m[0].length; continue;
    }
    const p = PUNCT.find(x => src.startsWith(x, i));
    if (!p) throw new BaseError(`Unexpected character "${c}" at position ${i}`);
    toks.push({ t: 'p', v: p, pos: i }); i += p.length;
  }
  return toks;
}

// precedence (higher binds tighter)
const BIN = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export function parseExpression(src) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const isP = v => toks[i] && toks[i].t === 'p' && toks[i].v === v;
  const expectP = v => { if (!isP(v)) throw new BaseError(`Expected "${v}" ${toks[i] ? `but found "${toks[i].v}"` : 'but the expression ended'}`); i++; };

  function expr(minPrec = 0) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'p') break;
      if (t.v === '?' && minPrec === 0) {
        i++; const a = expr(0); expectP(':'); const b = expr(0);
        left = { t: 'cond', c: left, a, b }; continue;
      }
      const prec = BIN[t.v];
      if (!prec || prec < minPrec) break;
      i++;
      const right = expr(prec + 1);
      left = { t: 'bin', op: t.v === '===' ? '==' : t.v === '!==' ? '!=' : t.v, l: left, r: right };
    }
    return left;
  }
  function unary() {
    if (isP('!')) { i++; return { t: 'un', op: '!', e: unary() }; }
    if (isP('-')) { i++; return { t: 'un', op: '-', e: unary() }; }
    if (isP('+')) { i++; return { t: 'un', op: '+', e: unary() }; }
    return postfix(primary());
  }
  function postfix(e) {
    for (;;) {
      if (isP('.') || isP('?.')) {
        i++;
        const t = toks[i++];
        if (!t || (t.t !== 'id' && t.t !== 's')) throw new BaseError('Expected a property name after "."');
        e = { t: 'mem', o: e, k: t.v };
      } else if (isP('[')) {
        i++; const k = expr(0); expectP(']'); e = { t: 'idx', o: e, k };
      } else if (isP('(')) {
        i++; const args = [];
        while (!isP(')')) { args.push(expr(0)); if (isP(',')) i++; else break; }
        expectP(')'); e = { t: 'call', f: e, args };
      } else return e;
    }
  }
  function primary() {
    const t = toks[i++];
    if (!t) throw new BaseError('The expression ended unexpectedly');
    switch (t.t) {
      case 'n': return { t: 'lit', v: t.v };
      case 's': return { t: 'lit', v: t.v };
      case 're': try { new RegExp(t.v, t.flags); } catch (e) { throw new BaseError(`Invalid regular expression /${t.v}/: ${e.message}`); } return { t: 're', src: t.v, flags: t.flags };
      case 'id':
        if (t.v === 'true') return { t: 'lit', v: true };
        if (t.v === 'false') return { t: 'lit', v: false };
        if (t.v === 'null') return { t: 'lit', v: null };
        return { t: 'id', n: t.v };
      case 'p':
        if (t.v === '(') { const e = expr(0); expectP(')'); return e; }
        if (t.v === '[') {
          const items = [];
          while (!isP(']')) { items.push(expr(0)); if (isP(',')) i++; else break; }
          expectP(']'); return { t: 'arr', items };
        }
        if (t.v === '{') {
          const props = [];
          while (!isP('}')) {
            const k = toks[i++];
            if (!k || (k.t !== 'id' && k.t !== 's')) throw new BaseError('Expected an object key');
            expectP(':'); props.push([k.v, expr(0)]);
            if (isP(',')) i++; else break;
          }
          expectP('}'); return { t: 'obj', props };
        }
    }
    throw new BaseError(`Unexpected "${t.v}" at position ${t.pos}`);
  }
  const ast = expr(0);
  if (i < toks.length) throw new BaseError(`Unexpected "${toks[i].v}" at position ${toks[i].pos}`);
  return ast;
}
