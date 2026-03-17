// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Embedding Adapters
// Unified interface for generating embeddings via OpenAI, Ollama, or mock.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingAdapter {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  embedSingle(text: string): Promise<number[]>;
}

// ─── OpenAI Embedding Adapter ───────────────────────────────────────────────

export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
  orgId?: string;
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'openai';
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly orgId?: string;

  constructor(config: OpenAIEmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-large';
    this.dimensions = config.dimensions ?? 3072;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.orgId = config.orgId;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.orgId) {
      headers['OpenAI-Organization'] = this.orgId;
    }

    const body = {
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    };

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embedding error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    // Sort by index to maintain input order
    return result.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }
}

// ─── Ollama Embedding Adapter ───────────────────────────────────────────────

export interface OllamaEmbeddingConfig {
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

export class OllamaEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'ollama';
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;

  constructor(config?: OllamaEmbeddingConfig) {
    this.model = config?.model ?? 'nomic-embed-text';
    this.dimensions = config?.dimensions ?? 768;
    this.baseUrl = config?.baseUrl ?? 'http://localhost:11434';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // Ollama processes embeddings one at a time
    for (const text of texts) {
      results.push(await this.embedSingle(text));
    }
    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as { embedding: number[] };
    return result.embedding;
  }
}

// ─── Mock Embedding Adapter (Testing) ───────────────────────────────────────

export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'mock';
  readonly model = 'mock-embed';
  readonly dimensions: number;
  private callCount = 0;

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.generateVector(text));
  }

  async embedSingle(text: string): Promise<number[]> {
    return this.generateVector(text);
  }

  /**
   * Generate a deterministic pseudo-random vector based on text content.
   * Same text always produces the same vector, enabling consistent tests.
   */
  private generateVector(text: string): number[] {
    this.callCount++;
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
    }

    const vector: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      // Simple LCG pseudo-random
      seed = (seed * 1664525 + 1013904223) | 0;
      vector.push((seed >>> 0) / 4294967296);
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / magnitude);
  }

  getCallCount(): number {
    return this.callCount;
  }
}
