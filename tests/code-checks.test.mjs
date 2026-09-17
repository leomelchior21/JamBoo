import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPythonOutput } from '../api/_code-checks.mjs';

test('computes simple print outputs from inline assignments', () => {
  assert.deepEqual(
    verifyPythonOutput('What does print(x) output after x = 7?', '7'),
    { checked: true, valid: true, output: '7' }
  );
  assert.deepEqual(
    verifyPythonOutput('What does print(x) output after x = 7?', '9'),
    { checked: true, valid: false, output: '7' }
  );
  assert.deepEqual(
    verifyPythonOutput('x = 3\nx = 5\nprint(x)', '5'),
    { checked: true, valid: true, output: '5' }
  );
  assert.deepEqual(
    verifyPythonOutput('x = 3\nx = 5\nprint(x)', '3'),
    { checked: true, valid: false, output: '5' }
  );
  assert.deepEqual(
    verifyPythonOutput('name = "Ada"; print(name)', 'Ada'),
    { checked: true, valid: true, output: 'Ada' }
  );
});

test('does not check questions it cannot decide safely', () => {
  assert.equal(verifyPythonOutput('How many variables are declared with a = 1 and b = 2?', '2').checked, false);
  assert.equal(verifyPythonOutput('What does print(x + 1) output after x = 5?', '6').checked, false);
  assert.equal(verifyPythonOutput('x = 2; print(x) + 3', '5').checked, false);
  assert.equal(verifyPythonOutput('What does print(x) output after x = 7?', 'seven').checked, false);
  assert.equal(verifyPythonOutput('Which keyword defines a function?', 'def').checked, false);
  assert.equal(verifyPythonOutput('', '7').checked, false);
});
