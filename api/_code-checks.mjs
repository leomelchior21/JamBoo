const ASSIGNMENT_PATTERN = /\b([a-zA-Z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")/g;
const PRINT_PATTERN = /\bprint\s*\(\s*([a-zA-Z_]\w*)\s*\)/g;
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;

function unchecked() {
  return { checked: false, valid: true, output: null };
}

function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

export function verifyPythonOutput(prompt, answer) {
  const text = String(prompt ?? '');
  if (!text) return unchecked();

  const prints = [...text.matchAll(PRINT_PATTERN)];
  if (prints.length !== 1) return unchecked();

  const print = prints[0];
  const afterPrint = text.slice(print.index + print[0].length).trim();
  if (/^[+\-*/%^]/.test(afterPrint)) return unchecked();

  const codeLike = /[\n;]/.test(text);
  const assignments = [...text.matchAll(ASSIGNMENT_PATTERN)]
    .filter(match => match[1] === print[1] && (!codeLike || match.index < print.index));
  if (!assignments.length) return unchecked();

  const raw = assignments[assignments.length - 1][2];
  const output = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
  const submitted = stripQuotes(answer);
  if (!submitted) return unchecked();

  if (NUMBER_PATTERN.test(output)) {
    if (!NUMBER_PATTERN.test(submitted)) return unchecked();
    return { checked: true, valid: Number(submitted) === Number(output), output };
  }

  return { checked: true, valid: submitted === output, output };
}
