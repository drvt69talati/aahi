// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Impact Prediction Engine
// Analyzes code changes to predict blast radius, surface missing safeguards,
// and correlate with historical incidents.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type { KnowledgeGraph } from '../teambrain/knowledge-graph.js';
import type { TimelineStore } from '../timeline/timeline-store.js';

// ── Data Interfaces ─────────────────────────────────────────────────────────

export interface ImpactReport {
  id: string;
  timestamp: Date;
  changedFiles: string[];
  affectedServices: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  testCoverage: { covered: number; total: number; percentage: number };
  downstreamDependencies: string[];
  historicalSimilarChanges: HistoricalChange[];
  warnings: ImpactWarning[];
  recommendation: string;
}

export interface HistoricalChange {
  commitSha: string;
  date: Date;
  author: string;
  description: string;
  outcome: 'success' | 'incident' | 'rollback';
  incidentId?: string;
}

export interface ImpactWarning {
  type:
    | 'missing_tests'
    | 'missing_rate_limit'
    | 'missing_auth'
    | 'missing_error_handling'
    | 'breaking_change'
    | 'high_blast_radius';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  file: string;
  line?: number;
}

// ── Impact Engine ───────────────────────────────────────────────────────────

export class ImpactEngine {
  constructor(
    private readonly knowledgeGraph: KnowledgeGraph,
    private readonly timelineStore: TimelineStore,
  ) {}

  /**
   * Analyze a set of changed files and produce an impact report.
   */
  async analyze(changedFiles: string[]): Promise<ImpactReport> {
    const affectedServices = this.findAffectedServices(changedFiles);
    const downstreamDependencies = this.computeDownstream(affectedServices);
    const testCoverage = this.checkTestCoverage(changedFiles);
    const historicalSimilarChanges = this.findHistoricalSimilarChanges(changedFiles);
    const warnings = this.generateWarnings(changedFiles);
    const riskLevel = this.computeRiskLevel(
      affectedServices,
      downstreamDependencies,
      testCoverage,
      historicalSimilarChanges,
      warnings,
    );
    const recommendation = this.generateRecommendation(riskLevel, warnings, testCoverage);

    return {
      id: uuid(),
      timestamp: new Date(),
      changedFiles,
      affectedServices,
      riskLevel,
      testCoverage,
      downstreamDependencies,
      historicalSimilarChanges,
      warnings,
      recommendation,
    };
  }

  /**
   * Estimate the blast radius of a service change — returns downstream
   * services that could be affected.
   */
  estimateBlastRadius(service: string): string[] {
    return this.computeDownstream([service]);
  }

  /**
   * Check how many of the changed files have corresponding test files.
   */
  checkTestCoverage(files: string[]): { covered: number; total: number; percentage: number } {
    const total = files.length;
    let covered = 0;

    for (const file of files) {
      if (this.hasTestFile(file)) {
        covered++;
      }
    }

    const percentage = total > 0 ? Math.round((covered / total) * 100) : 100;
    return { covered, total, percentage };
  }

  /**
   * Find historical changes that touched similar files.
   */
  findHistoricalSimilarChanges(files: string[]): HistoricalChange[] {
    const changes: HistoricalChange[] = [];

    // Query timeline for code events that might overlap with the changed files
    const codeEvents = this.timelineStore.query({
      categories: ['code'],
      limit: 200,
    });

    for (const event of codeEvents) {
      const eventFiles = (event.data?.files as string[]) ?? [];
      const overlapping = eventFiles.some(ef => files.some(f => this.filesOverlap(f, ef)));

      if (overlapping) {
        // Check if this commit led to an incident
        const incidentEvents = this.timelineStore.findNearest(event.timestamp, 86_400_000, {
          categories: ['incident'],
          services: event.service ? [event.service] : undefined,
        });

        const hadIncident = incidentEvents.length > 0;

        changes.push({
          commitSha: (event.data?.sha as string) ?? event.id,
          date: event.timestamp,
          author: event.actor ?? 'unknown',
          description: event.title,
          outcome: hadIncident ? 'incident' : 'success',
          incidentId: hadIncident ? incidentEvents[0].id : undefined,
        });
      }
    }

    return changes;
  }

  /**
   * Generate warnings for a set of changed files by checking for common
   * patterns that indicate missing safeguards.
   */
  generateWarnings(files: string[], diff?: string): ImpactWarning[] {
    const warnings: ImpactWarning[] = [];

    for (const file of files) {
      // Missing tests
      if (this.isSourceFile(file) && !this.hasTestFile(file)) {
        warnings.push({
          type: 'missing_tests',
          severity: 'warning',
          description: `No test file found for ${file}`,
          file,
        });
      }

      // Auth-related files without auth checks (heuristic based on path)
      if (this.isApiFile(file)) {
        warnings.push({
          type: 'missing_auth',
          severity: 'warning',
          description: `API file changed — verify authentication is enforced: ${file}`,
          file,
        });
      }

      // Rate limiting for API endpoints
      if (this.isApiFile(file)) {
        warnings.push({
          type: 'missing_rate_limit',
          severity: 'info',
          description: `API file changed — verify rate limiting is configured: ${file}`,
          file,
        });
      }
    }

    // Check for high blast radius
    const affectedServices = this.findAffectedServices(files);
    const downstream = this.computeDownstream(affectedServices);
    if (downstream.length >= 3) {
      warnings.push({
        type: 'high_blast_radius',
        severity: 'critical',
        description: `Change affects ${affectedServices.length} services with ${downstream.length} downstream dependencies`,
        file: files[0],
      });
    }

    // Check diff for patterns if provided
    if (diff) {
      this.analyzeForDiffWarnings(diff, files, warnings);
    }

    return warnings;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private findAffectedServices(files: string[]): string[] {
    const serviceSet = new Set<string>();

    for (const file of files) {
      const services = this.knowledgeGraph.listServices();
      for (const svc of services) {
        // Match if file path contains the service name
        if (file.toLowerCase().includes(svc.service.toLowerCase())) {
          serviceSet.add(svc.service);
        }
      }
    }

    return [...serviceSet];
  }

  private computeDownstream(services: string[]): string[] {
    const downstream = new Set<string>();

    // Use incident learnings to find service dependencies:
    // if an incident affected multiple services, they are likely connected
    for (const service of services) {
      const context = this.knowledgeGraph.getServiceContext(service);
      for (const incident of context.recentIncidents) {
        for (const affectedService of incident.affectedServices) {
          if (!services.includes(affectedService)) {
            downstream.add(affectedService);
          }
        }
      }
    }

    return [...downstream];
  }

  private computeRiskLevel(
    affectedServices: string[],
    downstream: string[],
    testCoverage: { percentage: number },
    historicalChanges: HistoricalChange[],
    warnings: ImpactWarning[],
  ): 'low' | 'medium' | 'high' | 'critical' {
    let riskScore = 0;

    // Services affected
    riskScore += affectedServices.length * 10;
    riskScore += downstream.length * 5;

    // Test coverage
    if (testCoverage.percentage < 50) riskScore += 20;
    else if (testCoverage.percentage < 80) riskScore += 10;

    // Historical incidents
    const incidentCount = historicalChanges.filter(c => c.outcome === 'incident').length;
    riskScore += incidentCount * 15;

    // Warnings
    const criticalWarnings = warnings.filter(w => w.severity === 'critical').length;
    riskScore += criticalWarnings * 20;

    if (riskScore >= 60) return 'critical';
    if (riskScore >= 40) return 'high';
    if (riskScore >= 20) return 'medium';
    return 'low';
  }

  private generateRecommendation(
    riskLevel: string,
    warnings: ImpactWarning[],
    testCoverage: { percentage: number },
  ): string {
    const parts: string[] = [];

    if (riskLevel === 'critical') {
      parts.push('High-risk change — consider staging deployment with canary rollout.');
    } else if (riskLevel === 'high') {
      parts.push('Elevated risk — request additional code review before merging.');
    }

    if (testCoverage.percentage < 50) {
      parts.push('Test coverage is below 50% — add tests before deploying.');
    } else if (testCoverage.percentage < 80) {
      parts.push('Consider adding more tests to improve coverage.');
    }

    const missingAuth = warnings.filter(w => w.type === 'missing_auth');
    if (missingAuth.length > 0) {
      parts.push('Verify authentication is enforced on changed API endpoints.');
    }

    if (parts.length === 0) {
      parts.push('Change looks safe to proceed. Standard review process applies.');
    }

    return parts.join(' ');
  }

  private hasTestFile(file: string): boolean {
    // Heuristic: check if the file itself is a test or if a test variant exists
    if (this.isTestFile(file)) return true;

    // Check the timeline for test events associated with this file
    // (In a real implementation, this would check the filesystem)
    const testVariants = [
      file.replace(/\.ts$/, '.test.ts'),
      file.replace(/\.ts$/, '.spec.ts'),
      file.replace(/\.js$/, '.test.js'),
      file.replace(/\.js$/, '.spec.js'),
      file.replace(/\/src\//, '/tests/'),
    ];

    // For now, consider it covered if the file is a test file itself
    return false;
  }

  private isSourceFile(file: string): boolean {
    return /\.(ts|js|tsx|jsx)$/.test(file) && !this.isTestFile(file);
  }

  private isTestFile(file: string): boolean {
    return /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file) || file.includes('/tests/');
  }

  private isApiFile(file: string): boolean {
    return (
      file.includes('/api/') ||
      file.includes('/routes/') ||
      file.includes('/controllers/') ||
      file.includes('/endpoints/')
    );
  }

  private filesOverlap(a: string, b: string): boolean {
    // Simple overlap: same file, or same directory
    if (a === b) return true;
    const dirA = a.substring(0, a.lastIndexOf('/'));
    const dirB = b.substring(0, b.lastIndexOf('/'));
    return dirA === dirB && dirA.length > 0;
  }

  private analyzeForDiffWarnings(
    diff: string,
    files: string[],
    warnings: ImpactWarning[],
  ): void {
    const diffLower = diff.toLowerCase();
    const primaryFile = files[0] ?? 'unknown';

    // Check for removed error handling
    if (
      diffLower.includes('-  try') ||
      diffLower.includes('-  catch') ||
      diffLower.includes('- catch')
    ) {
      warnings.push({
        type: 'missing_error_handling',
        severity: 'warning',
        description: 'Error handling code appears to have been removed',
        file: primaryFile,
      });
    }

    // Check for breaking changes (interface changes, removed exports)
    if (
      diffLower.includes('-export ') ||
      diffLower.includes('-  export ') ||
      diffLower.includes('breaking')
    ) {
      warnings.push({
        type: 'breaking_change',
        severity: 'critical',
        description: 'Potential breaking change detected — verify downstream consumers',
        file: primaryFile,
      });
    }
  }
}
