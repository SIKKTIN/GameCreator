// A bounded numeric language. No JavaScript evaluation or property access.
export type Expression = { kind: 'number'; value: number } | { kind: 'name'; name: string } |
  { kind: 'call'; name: string; args: Expression[] } | { kind: 'unary'; op: string; value: Expression } |
  { kind: 'binary'; op: string; left: Expression; right: Expression };
export function parseExpression(source: string): Expression {
  if (!source.trim() || source.length > 1000) throw new Error('公式不能为空，且最多 1000 个字符');
  const tokens: string[] = []; let at = 0;
  while (at < source.length) {
    const match = /^\s*(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|>=|<=|==|!=|[+\-*/^(),<>])/.exec(source.slice(at));
    if (!match) { if (!source.slice(at).trim()) break; throw new Error('无法识别公式位置 ' + (at + 1)); }
    tokens.push(match[1]); at += match[0].length;
    if (tokens.length > 300) throw new Error('公式过于复杂');
  }
  let i = 0, depth = 0;
  const precedence: Record<string, number> = { '==': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };
  function expr(min = 0): Expression {
    if (++depth > 40) throw new Error('公式嵌套过深');
    const token = tokens[i++]; let left: Expression;
    if (token === '+' || token === '-') left = { kind: 'unary', op: token, value: expr(4) };
    else if (token === '(') { left = expr(); if (tokens[i++] !== ')') throw new Error('缺少右括号'); }
    else if (token && /^[\d.]/.test(token)) left = { kind: 'number', value: Number(token) };
    else if (token && /^[A-Za-z_]/.test(token)) {
      if (tokens[i] === '(') {
        i++; const args: Expression[] = [];
        if (tokens[i] !== ')') { do { args.push(expr()); if (tokens[i] !== ',') break; i++; } while (i < tokens.length); }
        if (tokens[i++] !== ')') throw new Error('函数参数缺少右括号');
        left = { kind: 'call', name: token, args };
      } else left = { kind: 'name', name: token };
    } else throw new Error('缺少数字、参数或表达式');
    while (Object.prototype.hasOwnProperty.call(precedence, tokens[i]) && precedence[tokens[i]] >= min) {
      const op = tokens[i++]; left = { kind: 'binary', op, left, right: expr(precedence[op] + (op === '^' ? 0 : 1)) };
    }
    depth--; return left;
  }
  const result = expr(); if (i !== tokens.length) throw new Error('公式包含多余内容：' + tokens[i]); return result;
}
export const expressionFunctions = ['min', 'max', 'abs', 'floor', 'ceil', 'round', 'sqrt', 'pow', 'clamp', 'if', 'diceChance', 'storyChance'];
export function evaluateExpression(node: Expression, resolve: (name: string) => number, custom: (name: string, args: number[]) => number): number {
  let result: number;
  if (node.kind === 'number') result = node.value;
  else if (node.kind === 'name') result = resolve(node.name);
  else if (node.kind === 'unary') result = (node.op === '-' ? -1 : 1) * evaluateExpression(node.value, resolve, custom);
  else if (node.kind === 'binary') {
    const a = evaluateExpression(node.left, resolve, custom), b = evaluateExpression(node.right, resolve, custom);
    if (node.op === '/' && b === 0) throw new Error('除数不能为 0');
    switch (node.op) {
      case '+': result = a + b; break; case '-': result = a - b; break; case '*': result = a * b; break;
      case '/': result = a / b; break; case '^': result = a ** b; break;
      case '>': result = +(a > b); break; case '<': result = +(a < b); break; case '>=': result = +(a >= b); break;
      case '<=': result = +(a <= b); break; case '==': result = +(a === b); break; default: result = +(a !== b);
    }
  } else if (node.name === 'if') {
    if (node.args.length !== 3) throw new Error('if 需要 3 个参数');
    result = evaluateExpression(node.args[evaluateExpression(node.args[0], resolve, custom) ? 1 : 2], resolve, custom);
  } else {
    const args = node.args.map(arg => evaluateExpression(arg, resolve, custom));
    const arities: Record<string, number> = { abs: 1, floor: 1, ceil: 1, round: 1, sqrt: 1, pow: 2, clamp: 3, diceChance: 5, storyChance: 0 };
    if (!expressionFunctions.includes(node.name)) throw new Error('未知函数：' + node.name);
    if ((Object.prototype.hasOwnProperty.call(arities, node.name) && args.length !== arities[node.name]) || (['min','max'].includes(node.name) && !args.length)) throw new Error(node.name + ' 参数数量不正确');
    const [a, b, c] = args;
    switch (node.name) {
      case 'min': result = Math.min(...args); break; case 'max': result = Math.max(...args); break;
      case 'abs': result = Math.abs(a); break; case 'floor': result = Math.floor(a); break; case 'ceil': result = Math.ceil(a); break;
      case 'round': result = Math.round(a); break; case 'sqrt': result = Math.sqrt(a); break; case 'pow': result = a ** b; break;
      case 'clamp': if (b > c) throw new Error('clamp 最小值大于最大值'); result = Math.max(b, Math.min(c, a)); break;
      default: result = custom(node.name, args);
    }
  }
  if (!Number.isFinite(result)) throw new Error('计算结果不是有限数字'); return result;
}
