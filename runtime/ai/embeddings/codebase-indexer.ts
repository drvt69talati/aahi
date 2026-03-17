// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Codebase Indexer
// Generates embeddings for codebase files, stores in memory, and enables
// semantic search via cosine similarity. Supports incremental indexing.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import type { EmbeddingAdapter } from './embedding-adapter.js';

export interface IndexedDocument {
  uri: string;
  content: string;
  embedding: number[];
  language: string;
  symbols: string[];
  lastModified: Date;
}

export interface SearchResult {
  uri: string;
  score: number;
  snippet: string;
  language: string;
}

export interface IndexStats {
  totalDocuments: number;
  totalSymbols: number;
  languages: Record<string, number>;
  lastIndexed: Date | null;
}

// ─── Language Detection ─────────────────────────────────────────────────────

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.php': 'php',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.toml': 'toml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.tf': 'terraform',
  '.dockerfile': 'dockerfile',
};

function detectLanguage(uri: string): string {
  const ext = path.extname(uri).toLowerCase();
  const basename = path.basename(uri).toLowerCase();
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
}

// ─── Symbol Extraction ──────────────────────────────────────────────────────

const SYMBOL_PATTERNS: RegExp[] = [
  // TypeScript / JavaScript — declarations
  /(?:export\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g,
  // TypeScript / JavaScript — method declarations (async methodName(), methodName())
  /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g,
  // Python
  /(?:def|class)\s+(\w+)/g,
  // Go
  /(?:func|type|var|const)\s+(\w+)/g,
  // Rust
  /(?:fn|struct|enum|trait|type|const|static)\s+(\w+)/g,
  // Java / C# / Kotlin
  /(?:class|interface|enum|record)\s+(\w+)/g,
];

function extractSymbols(content: string): string[] {
  const symbols = new Set<string>();
  for (const pattern of SYMBOL_PATTERNS) {
    // Reset lastIndex for each use
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && match[1].length >= 1) {
        symbols.add(match[1]);
      }
    }
  }
  return [...symbols];
}

// ─── Cosine Similarity ─────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

// ─── Ignored Paths ──────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode',
  'coverage', '.cache', '.turbo',
]);

const IGNORED_EXTENSIONS = new Set([
  '.lock', '.map', '.min.js', '.min.css', '.wasm',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.bz2',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx',
]);

function shouldIndex(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (IGNORED_EXTENSIONS.has(ext)) return false;
  return true;
}

// ─── Snippet Extraction ────────────────────────────────────────────────────

function extractSnippet(content: string, maxLength: number = 300): string {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  let snippet = '';
  for (const line of lines) {
    if (snippet.length + line.length > maxLength) break;
    snippet += (snippet ? '\n' : '') + line;
  }
  return snippet || content.slice(0, maxLength);
}

// ─── Codebase Indexer ───────────────────────────────────────────────────────

export class CodebaseIndexer {
  private documents = new Map<string, IndexedDocument>();
  private embeddingAdapter: EmbeddingAdapter;

  constructor(embeddingAdapter: EmbeddingAdapter) {
    this.embeddingAdapter = embeddingAdapter;
  }

  /**
   * Index a single file by generating its embedding.
   */
  async indexFile(uri: string, content: string, language?: string): Promise<IndexedDocument> {
    const lang = language ?? detectLanguage(uri);
    const symbols = extractSymbols(content);
    const embedding = await this.embeddingAdapter.embedSingle(content);

    const doc: IndexedDocument = {
      uri,
      content,
      embedding,
      language: lang,
      symbols,
      lastModified: new Date(),
    };

    this.documents.set(uri, doc);
    return doc;
  }

  /**
   * Index all files in a directory recursively.
   * Only re-indexes files that have changed since last indexing.
   */
  async indexDirectory(dirPath: string): Promise<number> {
    const files = this.walkDirectory(dirPath);
    let indexed = 0;

    for (const filePath of files) {
      if (!shouldIndex(filePath)) continue;

      try {
        const stat = fs.statSync(filePath);
        const existing = this.documents.get(filePath);

        // Skip if already indexed and not modified
        if (existing && existing.lastModified >= stat.mtime) {
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        // Skip binary-looking or very large files
        if (content.includes('\0') || content.length > 500_000) continue;

        await this.indexFile(filePath, content);
        indexed++;
      } catch {
        // Skip files that can't be read
      }
    }

    return indexed;
  }

  /**
   * Semantic search: find the most relevant documents for a query.
   */
  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (this.documents.size === 0) return [];

    const queryEmbedding = await this.embeddingAdapter.embedSingle(query);

    const scored: SearchResult[] = [];
    for (const doc of this.documents.values()) {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      scored.push({
        uri: doc.uri,
        score,
        snippet: extractSnippet(doc.content),
        language: doc.language,
      });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Remove a file from the index.
   */
  removeFile(uri: string): boolean {
    return this.documents.delete(uri);
  }

  /**
   * Check if a file is already indexed.
   */
  isIndexed(uri: string): boolean {
    return this.documents.has(uri);
  }

  /**
   * Get index statistics.
   */
  getStats(): IndexStats {
    const languages: Record<string, number> = {};
    let totalSymbols = 0;
    let lastIndexed: Date | null = null;

    for (const doc of this.documents.values()) {
      languages[doc.language] = (languages[doc.language] ?? 0) + 1;
      totalSymbols += doc.symbols.length;
      if (!lastIndexed || doc.lastModified > lastIndexed) {
        lastIndexed = doc.lastModified;
      }
    }

    return {
      totalDocuments: this.documents.size,
      totalSymbols,
      languages,
      lastIndexed,
    };
  }

  /**
   * Get an indexed document by URI.
   */
  getDocument(uri: string): IndexedDocument | undefined {
    return this.documents.get(uri);
  }

  private walkDirectory(dirPath: string): string[] {
    const results: string[] = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            results.push(...this.walkDirectory(fullPath));
          }
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip directories that can't be read
    }

    return results;
  }
}
