#!/usr/bin/env node
/* Build a Koinos contract: precompile (index.ts + ABI) then compile to WASM.
   Usage: node build.js <market> */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!['market', 'collection'].includes(name)) {
  console.error('usage: node build.js <market|collection>');
  process.exit(1);
}
const dir = path.join(__dirname, name);
const bin = (b) => path.join(__dirname, 'node_modules', '.bin', b);

execFileSync(bin('koinos-precompiler-as'), [name], { cwd: __dirname, stdio: 'inherit' });

const asconfig = {
  targets: {
    testnet: { outFile: './build/testnet/contract.wasm', optimizeLevel: 3, shrinkLevel: 0, use: ['BUILD_FOR_TESTING=1'] },
    release: { outFile: './build/release/contract.wasm', optimizeLevel: 3, shrinkLevel: 0, use: ['BUILD_FOR_TESTING=0'] },
  },
  options: { exportStart: '_start', disable: ['sign-extension', 'bulk-memory'] },
};
fs.writeFileSync(path.join(dir, 'asconfig.json'), JSON.stringify(asconfig, null, 2));

for (const target of ['testnet', 'release']) {
  execFileSync(bin('asc'), [
    'build/index.ts', '--config', 'asconfig.json', '--use', 'abort=', '--target', target,
  ], { cwd: dir, stdio: 'inherit' });
  const out = path.join(dir, 'build', target, 'contract.wasm');
  console.log(`${name} ${target}: ${fs.statSync(out).size} bytes -> ${out}`);
}
