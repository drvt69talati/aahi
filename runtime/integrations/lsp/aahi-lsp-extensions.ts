// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Custom LSP Extensions
// Custom protocol extensions that Aahi adds on top of standard LSP.
// These methods provide AI-powered code intelligence features.
// ─────────────────────────────────────────────────────────────────────────────

import type { Range, Position, TextEdit } from './lsp-client.js';

// ─── Custom Method Definitions ──────────────────────────────────────────────

export const AAHI_LSP_METHODS = {
  'aahi/explainSymbol': 'Explain the selected symbol using AI',
  'aahi/impactAnalysis': 'Predict impact of current change',
  'aahi/generateTests': 'Generate tests for current function',
  'aahi/inlineRefactor': 'AI-guided refactor with diff preview',
  'aahi/contextAttach': 'Attach symbol to AI chat context',
} as const;

export type AahiLSPMethodName = keyof typeof AAHI_LSP_METHODS;

// ─── Request / Result Types ─────────────────────────────────────────────────

export interface AahiLSPRequest {
  'aahi/explainSymbol': {
    uri: string;
    position: Position;
    symbolName?: string;
  };
  'aahi/impactAnalysis': {
    uri: string;
    range: Range;
    diff?: string;
  };
  'aahi/generateTests': {
    uri: string;
    range: Range;
    functionName?: string;
    testFramework?: string;
  };
  'aahi/inlineRefactor': {
    uri: string;
    range: Range;
    instruction: string;
  };
  'aahi/contextAttach': {
    uri: string;
    position: Position;
    symbolName?: string;
    includeReferences?: boolean;
  };
}

export interface AahiLSPResult {
  'aahi/explainSymbol': {
    explanation: string;
    relatedSymbols?: Array<{ name: string; uri: string; range: Range }>;
  };
  'aahi/impactAnalysis': {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    affectedFiles: string[];
    warnings: Array<{ message: string; severity: 'info' | 'warning' | 'error' }>;
    suggestedTests: string[];
  };
  'aahi/generateTests': {
    testCode: string;
    testFile: string;
    framework: string;
  };
  'aahi/inlineRefactor': {
    edits: TextEdit[];
    explanation: string;
    preview: string;
  };
  'aahi/contextAttach': {
    attached: boolean;
    symbolInfo: {
      name: string;
      kind: string;
      uri: string;
      range: Range;
      definition?: string;
      references?: Array<{ uri: string; range: Range }>;
    };
  };
}

// ─── Handler Dependencies ───────────────────────────────────────────────────

/**
 * Minimal interface for the Aahi runtime components the LSP extensions need.
 * Avoids a circular import on the full Aahi class.
 */
export interface AahiLSPDeps {
  /** Run a model request and get a text response. */
  askModel(prompt: string): Promise<string>;

  /** ImpactEngine.analyzeChange */
  analyzeImpact(filePath: string, diff: string): Promise<{
    riskLevel: string;
    affectedFiles: string[];
    warnings: Array<{ message: string; severity: string }>;
    suggestedTests: string[];
  }>;

  /** ContextEngine.attachSymbol — put a symbol into the active chat context. */
  attachToContext(symbol: {
    name: string;
    kind: string;
    uri: string;
    range: Range;
    definition?: string;
    references?: Array<{ uri: string; range: Range }>;
  }): void;

  /** Read file contents by URI. */
  readFile(uri: string): Promise<string>;
}

// ─── Extension Handler Implementation ───────────────────────────────────────

export class AahiLSPExtensions {
  private deps: AahiLSPDeps;

  constructor(deps: AahiLSPDeps) {
    this.deps = deps;
  }

  /**
   * Dispatch a custom Aahi LSP method to the appropriate handler.
   */
  async handle<M extends AahiLSPMethodName>(
    method: M,
    params: AahiLSPRequest[M],
  ): Promise<AahiLSPResult[M]> {
    switch (method) {
      case 'aahi/explainSymbol':
        return this.explainSymbol(params as AahiLSPRequest['aahi/explainSymbol']) as Promise<AahiLSPResult[M]>;
      case 'aahi/impactAnalysis':
        return this.impactAnalysis(params as AahiLSPRequest['aahi/impactAnalysis']) as Promise<AahiLSPResult[M]>;
      case 'aahi/generateTests':
        return this.generateTests(params as AahiLSPRequest['aahi/generateTests']) as Promise<AahiLSPResult[M]>;
      case 'aahi/inlineRefactor':
        return this.inlineRefactor(params as AahiLSPRequest['aahi/inlineRefactor']) as Promise<AahiLSPResult[M]>;
      case 'aahi/contextAttach':
        return this.contextAttach(params as AahiLSPRequest['aahi/contextAttach']) as Promise<AahiLSPResult[M]>;
      default:
        throw new Error(`Unknown Aahi LSP method: ${method}`);
    }
  }

  // ── aahi/explainSymbol ──────────────────────────────────────────────────

  private async explainSymbol(
    params: AahiLSPRequest['aahi/explainSymbol'],
  ): Promise<AahiLSPResult['aahi/explainSymbol']> {
    const fileContent = await this.deps.readFile(params.uri);
    const lines = fileContent.split('\n');

    // Extract a context window around the target position
    const startLine = Math.max(0, params.position.line - 10);
    const endLine = Math.min(lines.length, params.position.line + 10);
    const snippet = lines.slice(startLine, endLine).join('\n');

    const symbolDesc = params.symbolName
      ? `the symbol "${params.symbolName}"`
      : `the symbol at line ${params.position.line + 1}, column ${params.position.character + 1}`;

    const prompt = [
      `Explain ${symbolDesc} in the following code.`,
      `File: ${params.uri}`,
      '',
      '```',
      snippet,
      '```',
      '',
      'Provide a concise, developer-friendly explanation of what this symbol is,',
      'what it does, and how it is used. Include its type if apparent.',
    ].join('\n');

    const explanation = await this.deps.askModel(prompt);

    return { explanation };
  }

  // ── aahi/impactAnalysis ─────────────────────────────────────────────────

  private async impactAnalysis(
    params: AahiLSPRequest['aahi/impactAnalysis'],
  ): Promise<AahiLSPResult['aahi/impactAnalysis']> {
    // Extract the changed region as a pseudo-diff if not provided
    let diff = params.diff;
    if (!diff) {
      const fileContent = await this.deps.readFile(params.uri);
      const lines = fileContent.split('\n');
      const changedLines = lines.slice(params.range.start.line, params.range.end.line + 1);
      diff = changedLines.map((l) => `+ ${l}`).join('\n');
    }

    // Strip file:// prefix for the impact engine
    const filePath = params.uri.replace(/^file:\/\//, '');

    const result = await this.deps.analyzeImpact(filePath, diff);

    return {
      riskLevel: result.riskLevel as 'low' | 'medium' | 'high' | 'critical',
      affectedFiles: result.affectedFiles,
      warnings: result.warnings.map((w) => ({
        message: w.message,
        severity: w.severity as 'info' | 'warning' | 'error',
      })),
      suggestedTests: result.suggestedTests,
    };
  }

  // ── aahi/generateTests ──────────────────────────────────────────────────

  private async generateTests(
    params: AahiLSPRequest['aahi/generateTests'],
  ): Promise<AahiLSPResult['aahi/generateTests']> {
    const fileContent = await this.deps.readFile(params.uri);
    const lines = fileContent.split('\n');
    const functionCode = lines.slice(params.range.start.line, params.range.end.line + 1).join('\n');

    const framework = params.testFramework ?? 'vitest';
    const functionName = params.functionName ?? 'the selected function';

    const prompt = [
      `Generate comprehensive unit tests for ${functionName} using ${framework}.`,
      `File: ${params.uri}`,
      '',
      '```',
      functionCode,
      '```',
      '',
      'Requirements:',
      '- Cover happy path, edge cases, and error cases',
      '- Use descriptive test names',
      '- Include setup/teardown if needed',
      `- Use ${framework} syntax`,
      '- Output ONLY the test code, no explanation',
    ].join('\n');

    const testCode = await this.deps.askModel(prompt);

    // Derive test file path
    const filePath = params.uri.replace(/^file:\/\//, '');
    const testFile = filePath.replace(/(\.\w+)$/, `.test$1`);

    return {
      testCode,
      testFile,
      framework,
    };
  }

  // ── aahi/inlineRefactor ─────────────────────────────────────────────────

  private async inlineRefactor(
    params: AahiLSPRequest['aahi/inlineRefactor'],
  ): Promise<AahiLSPResult['aahi/inlineRefactor']> {
    const fileContent = await this.deps.readFile(params.uri);
    const lines = fileContent.split('\n');
    const selectedCode = lines.slice(params.range.start.line, params.range.end.line + 1).join('\n');

    const prompt = [
      `Refactor the following code according to this instruction: "${params.instruction}"`,
      `File: ${params.uri}`,
      '',
      'Original code:',
      '```',
      selectedCode,
      '```',
      '',
      'Respond with ONLY the refactored code, no explanation or markdown fences.',
    ].join('\n');

    const refactored = await this.deps.askModel(prompt);

    const edit: TextEdit = {
      range: params.range,
      newText: refactored,
    };

    return {
      edits: [edit],
      explanation: `Refactored: ${params.instruction}`,
      preview: refactored,
    };
  }

  // ── aahi/contextAttach ──────────────────────────────────────────────────

  private async contextAttach(
    params: AahiLSPRequest['aahi/contextAttach'],
  ): Promise<AahiLSPResult['aahi/contextAttach']> {
    const fileContent = await this.deps.readFile(params.uri);
    const lines = fileContent.split('\n');

    // Extract the symbol name from the position if not provided
    const line = lines[params.position.line] ?? '';
    const symbolName = params.symbolName ?? extractWordAtPosition(line, params.position.character);

    const symbolInfo: AahiLSPResult['aahi/contextAttach']['symbolInfo'] = {
      name: symbolName,
      kind: 'unknown',
      uri: params.uri,
      range: {
        start: params.position,
        end: { line: params.position.line, character: params.position.character + symbolName.length },
      },
      definition: line.trim(),
    };

    this.deps.attachToContext(symbolInfo);

    return {
      attached: true,
      symbolInfo,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractWordAtPosition(line: string, character: number): string {
  const wordChars = /[\w$]/;
  let start = character;
  let end = character;

  while (start > 0 && wordChars.test(line[start - 1])) start--;
  while (end < line.length && wordChars.test(line[end])) end++;

  return line.slice(start, end) || 'symbol';
}
