const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  external: ['vscode'],
  sourcemap: true,
}).catch(() => process.exit(1));
