// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Embeddings Layer Exports
// ─────────────────────────────────────────────────────────────────────────────

export type { EmbeddingAdapter } from './embedding-adapter.js';
export {
  OpenAIEmbeddingAdapter,
  OllamaEmbeddingAdapter,
  MockEmbeddingAdapter,
} from './embedding-adapter.js';
export type { OpenAIEmbeddingConfig, OllamaEmbeddingConfig } from './embedding-adapter.js';

export { CodebaseIndexer } from './codebase-indexer.js';
export type { IndexedDocument, SearchResult, IndexStats } from './codebase-indexer.js';
