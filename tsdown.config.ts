/**
 * tsdown build for dsh-visualizer: the host-half lib (lib/index.js, ESM node)
 * plus the two browser client bundles (lib/client.js and
 * lib/client-registry.js, CJS closure factory) — one per install channel,
 * mirroring dsh-better-sidebar:
 *
 * - `lib/client.js` serves the official profile channel, registering with
 *   the package-name id `dsh-visualizer` (client-modules compose keys on the
 *   package name),
 * - `lib/client-registry.js` serves the plugin-registry channel
 *   (dsh.plugin.json), registering with the manifest id
 *   `dsh-external/dsh-visualizer` (the registry browser-side `arrive()`
 *   check requires bundle id === plugin id).
 *
 * Both bundles replicate the official DSH client-bundle preset:
 * - externals resolve through the loader module table at runtime
 *   (react/cordis/runtime — see CLIENT_EXTERNALS),
 * - everything else is inlined (echarts is imported tree-shakable from
 *   echarts/core + the chart/component/renderer modules, so the inlined
 *   payload is a few hundred KB, not the full library),
 * - the purity gate rejects any other @deepseek-ai value import:
 *   cross-package collaboration goes through slots/services, never imports,
 * - each artifact registers itself via window.__ModuleLoader__.load({id,
 *   factory}) with the (require) => exports CJS closure shape.
 *
 * Type-check/build/lint gates need the DSH peer packages installed
 * (devDependencies pin them); `pnpm test` covers the pure modules
 * standalone.
 */
import type { UserConfig } from 'tsdown'

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Reject Node builtins and cross-plugin @deepseek-ai value imports. */
function purityGate(): NonNullable<UserConfig['plugins']> {
  const NODE_BUILTINS = new Set([
    'node:fs', 'fs', 'node:path', 'path', 'node:crypto', 'crypto',
    'node:os', 'os', 'node:util', 'util', 'node:stream', 'stream',
  ])
  return {
    name: 'dsh-visualizer-client-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(`client bundle purity: Node builtin "${source}" cannot run in the browser`)
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — `
        + 'cross-plugin value imports are forbidden; collaborate through slots/services',
      )
    },
  }
}

/** One client bundle build for a plugin id (the same source, two channels). */
function clientBundle(pluginId: string, entryFile: string): UserConfig {
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      'import.meta.resolve': 'undefined',
    },
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    plugins: [purityGate()],
    outputOptions: {
      entryFileNames: entryFile,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      // v0.1: echarts is inlined (tree-shakable imports) because the official
      // /plugins/<id>/client.js route serves exactly one file — a code-split
      // chunk would 404. A custom host bundle route (better-sidebar's
      // /sidebar/bundle pattern) is the later lazy-loading path.
      codeSplitting: false,
    },
  }
}

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // Node-facing diagnostics entry for scripts/replay-*.mjs (not shipped).
  {
    entry: { replay: 'src/replay.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // Official profile channel: bundle id = package name.
  clientBundle('dsh-visualizer', 'client.js'),
  // Plugin-registry channel: bundle id = manifest id (dsh.plugin.json).
  clientBundle('dsh-external/dsh-visualizer', 'client-registry.js'),
] satisfies UserConfig[]
