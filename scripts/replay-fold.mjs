/**
 * Replay the REAL session log through the plugin's fold logic in Node,
 * simulating the engine's match/start/update/buildViewNode semantics for the
 * `visualizer-chart` context. If this produces a node here, the client fold
 * is correct and the issue is elsewhere; if not, the fold logic is the bug.
 */
import { zstdDecompress } from 'node:zlib' // may not exist on all node
