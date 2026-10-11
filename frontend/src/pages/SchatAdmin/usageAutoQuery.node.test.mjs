import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as filters from './usageSelection.js';
const require = createRequire(import.meta.url);
const React = require('react');

test('changing period/departments queries automatically and ignores older replies', async () => {
  const values = []; let index = 0, effect, cleanup;
  const pending = [], calls = [];
  const hooks = {
    useState(initial) {
      const slot = index++;
      if (!(slot in values)) values[slot] = initial;
      return [values[slot], value => { values[slot] = typeof value === 'function' ? value(values[slot]) : value; }];
    },
    useEffect(callback) { effect = callback; },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('./sections/UsageStats.jsx', import.meta.url),'utf8'),
    { format:'cjs', loader:'jsx', jsx:'automatic' }).code, {
    module, exports: module.exports,
    require: name => name === 'react' ? hooks : name === 'recharts' ? {} : name === '../ui' ? {Card:'section',Help:'span',InfoRow:'div',Loading:'p',Notice:'p'} :
      name === '../DepartmentPicker' ? { __esModule:true, default: 'picker' } : name === '../usageSelection' ? filters :
      name === '@/models/schatAdmin' ? { __esModule:true, default: { usageStats: (period, selection) => {
        calls.push({period, departments:[...selection.departmentIds]});
        return new Promise(resolve => pending.push(resolve));
      } } } : require(name),
  });
  const draw = () => { index = 0; return module.exports.default(); };
  const runEffect = () => { cleanup?.(); cleanup = effect(); };
  function nodes(element) {
    return !React.isValidElement(element) ? [] : [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
  }
  let tree = draw(); runEffect();
  nodes(tree).find(node => node.props.children === '최근 30일').props.onClick();
  tree = draw(); runEffect();
  nodes(tree).find(node => node.props.selected).props.onChange([7,9]);
  draw(); runEffect();
  assert.deepEqual(calls,[{period:'7d',departments:[]},{period:'30d',departments:[]},{period:'30d',departments:[7,9]}]);
  pending[2]({error:true, marker:'latest'}); await Promise.resolve();
  pending[0]({error:true, marker:'old'}); pending[1]({error:true, marker:'older'}); await Promise.resolve();
  assert.equal(values[1].marker,'latest');
  cleanup();
});
