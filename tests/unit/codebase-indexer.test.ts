import { describe, it, expect, beforeEach } from 'vitest';
import { CodebaseIndexer } from '../../runtime/ai/embeddings/codebase-indexer.js';
import { MockEmbeddingAdapter } from '../../runtime/ai/embeddings/embedding-adapter.js';
import type { SearchResult } from '../../runtime/ai/embeddings/codebase-indexer.js';

describe('CodebaseIndexer', () => {
  let indexer: CodebaseIndexer;
  let adapter: MockEmbeddingAdapter;

  beforeEach(() => {
    adapter = new MockEmbeddingAdapter(128);
    indexer = new CodebaseIndexer(adapter);
  });

  describe('indexFile', () => {
    it('indexes a file and stores it', async () => {
      const doc = await indexer.indexFile(
        '/src/app.ts',
        'export function main() { console.log("hello"); }',
        'typescript',
      );

      expect(doc.uri).toBe('/src/app.ts');
      expect(doc.language).toBe('typescript');
      expect(doc.embedding.length).toBe(128);
      expect(doc.symbols).toContain('main');
      expect(doc.lastModified).toBeInstanceOf(Date);
    });

    it('auto-detects language from extension', async () => {
      const doc = await indexer.indexFile(
        '/lib/utils.py',
        'def helper(): pass',
      );

      expect(doc.language).toBe('python');
    });

    it('extracts symbols from content', async () => {
      const code = `
        export class UserService {
          async getUser() {}
        }
        export interface UserProfile {}
        export type UserId = string;
        const API_URL = 'http://localhost';
      `;
      const doc = await indexer.indexFile('/src/user.ts', code, 'typescript');

      expect(doc.symbols).toContain('UserService');
      expect(doc.symbols).toContain('getUser');
      expect(doc.symbols).toContain('UserProfile');
      expect(doc.symbols).toContain('UserId');
      expect(doc.symbols).toContain('API_URL');
    });
  });

  describe('search', () => {
    it('returns results ranked by similarity', async () => {
      await indexer.indexFile('/src/auth.ts', 'export class AuthService { login() {} logout() {} }');
      await indexer.indexFile('/src/db.ts', 'export class DatabaseConnection { query() {} }');
      await indexer.indexFile('/src/api.ts', 'export class ApiRouter { get() {} post() {} }');

      const results = await indexer.search('authentication login', 3);

      expect(results.length).toBe(3);
      // All results should have a score
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.uri).toBeDefined();
        expect(r.snippet).toBeDefined();
      }
    });

    it('returns empty array when index is empty', async () => {
      const results = await indexer.search('anything');
      expect(results).toEqual([]);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await indexer.indexFile(`/src/file${i}.ts`, `export function func${i}() {}`);
      }

      const results = await indexer.search('function', 3);
      expect(results.length).toBe(3);
    });

    it('includes language and snippet in results', async () => {
      await indexer.indexFile('/src/main.go', 'func main() {\n\tfmt.Println("hello")\n}');

      const results = await indexer.search('main function');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].language).toBe('go');
      expect(results[0].snippet.length).toBeGreaterThan(0);
    });
  });

  describe('incremental indexing', () => {
    it('re-indexes when called with same URI', async () => {
      const doc1 = await indexer.indexFile('/src/app.ts', 'version 1');
      const doc2 = await indexer.indexFile('/src/app.ts', 'version 2 with changes');

      expect(doc2.content).toBe('version 2 with changes');

      const stats = indexer.getStats();
      expect(stats.totalDocuments).toBe(1); // Not duplicated
    });
  });

  describe('removeFile', () => {
    it('removes a file from the index', async () => {
      await indexer.indexFile('/src/temp.ts', 'temporary file');
      expect(indexer.isIndexed('/src/temp.ts')).toBe(true);

      const removed = indexer.removeFile('/src/temp.ts');
      expect(removed).toBe(true);
      expect(indexer.isIndexed('/src/temp.ts')).toBe(false);
    });

    it('returns false for non-existent files', () => {
      expect(indexer.removeFile('/nonexistent.ts')).toBe(false);
    });
  });

  describe('isIndexed', () => {
    it('returns true for indexed files', async () => {
      await indexer.indexFile('/src/app.ts', 'content');
      expect(indexer.isIndexed('/src/app.ts')).toBe(true);
    });

    it('returns false for non-indexed files', () => {
      expect(indexer.isIndexed('/src/missing.ts')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('reports accurate statistics', async () => {
      await indexer.indexFile('/src/a.ts', 'export class A {}', 'typescript');
      await indexer.indexFile('/src/b.py', 'class B: pass', 'python');
      await indexer.indexFile('/src/c.ts', 'export function c() {}', 'typescript');

      const stats = indexer.getStats();
      expect(stats.totalDocuments).toBe(3);
      expect(stats.languages['typescript']).toBe(2);
      expect(stats.languages['python']).toBe(1);
      expect(stats.totalSymbols).toBeGreaterThan(0);
      expect(stats.lastIndexed).toBeInstanceOf(Date);
    });

    it('returns null lastIndexed when empty', () => {
      const stats = indexer.getStats();
      expect(stats.totalDocuments).toBe(0);
      expect(stats.lastIndexed).toBeNull();
    });
  });

  describe('MockEmbeddingAdapter', () => {
    it('produces deterministic vectors for same input', async () => {
      const v1 = await adapter.embedSingle('hello world');
      const v2 = await adapter.embedSingle('hello world');
      expect(v1).toEqual(v2);
    });

    it('produces different vectors for different input', async () => {
      const v1 = await adapter.embedSingle('hello world');
      const v2 = await adapter.embedSingle('goodbye world');
      expect(v1).not.toEqual(v2);
    });

    it('produces unit vectors', async () => {
      const v = await adapter.embedSingle('test input');
      const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('produces vectors of correct dimension', async () => {
      const v = await adapter.embedSingle('test');
      expect(v.length).toBe(128);
    });

    it('batch embeds multiple texts', async () => {
      const results = await adapter.embed(['a', 'b', 'c']);
      expect(results.length).toBe(3);
      expect(results[0].length).toBe(128);
    });
  });
});
