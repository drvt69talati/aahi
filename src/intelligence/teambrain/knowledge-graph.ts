// ─────────────────────────────────────────────────────────────────────────────
// Aahi — TeamBrain Knowledge Graph
// Organizational knowledge that persists across sessions: service ownership,
// expertise mapping, architectural decisions, and incident learnings.
// ─────────────────────────────────────────────────────────────────────────────

// ── Data Interfaces ─────────────────────────────────────────────────────────

export interface ServiceOwnership {
  service: string;
  team: string;
  owners: string[]; // GitHub usernames
  oncallSchedule?: string; // PagerDuty schedule ID
  slackChannel?: string;
  repoUrl?: string;
  description?: string;
  updatedAt: Date;
}

export interface ExpertiseEntry {
  person: string; // GitHub username
  areas: ExpertiseArea[];
  lastActive: Date;
}

export interface ExpertiseArea {
  path: string; // file path pattern (e.g., "src/auth/**")
  commitCount: number;
  lastCommit: Date;
  confidence: number; // 0-1
}

export interface ArchitecturalDecision {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  context: string;
  decision: string;
  consequences: string;
  date: Date;
  authors: string[];
  tags: string[];
}

export interface IncidentLearning {
  id: string;
  incidentId: string;
  title: string;
  rootCause: string;
  impact: string;
  resolution: string;
  lessons: string[];
  preventionMeasures: string[];
  affectedServices: string[];
  date: Date;
  postmortemUrl?: string;
}

// ── Composite query results ─────────────────────────────────────────────────

export interface OwnershipInfo {
  service: string;
  team: string;
  owners: string[];
  slackChannel?: string;
}

export interface ExpertRanking {
  person: string;
  commitCount: number;
  confidence: number;
  lastCommit: Date;
}

export interface ServiceContext {
  ownership: ServiceOwnership | undefined;
  recentIncidents: IncidentLearning[];
  relevantADRs: ArchitecturalDecision[];
}

export interface OnboardingContext {
  ownership: ServiceOwnership | undefined;
  experts: ExpertRanking[];
  architecturalDecisions: ArchitecturalDecision[];
  incidentHistory: IncidentLearning[];
  preventionMeasures: string[];
}

// ── Knowledge Graph ─────────────────────────────────────────────────────────

export class KnowledgeGraph {
  private services = new Map<string, ServiceOwnership>();
  private expertise = new Map<string, ExpertiseEntry>();
  private adrs = new Map<string, ArchitecturalDecision>();
  private incidents = new Map<string, IncidentLearning>();

  // ── Service Ownership ───────────────────────────────────────────────────

  addServiceOwnership(ownership: ServiceOwnership): void {
    this.services.set(ownership.service, ownership);
  }

  getServiceOwner(service: string): ServiceOwnership | undefined {
    return this.services.get(service);
  }

  listServices(): ServiceOwnership[] {
    return [...this.services.values()];
  }

  // ── Expertise ───────────────────────────────────────────────────────────

  addExpertise(entry: ExpertiseEntry): void {
    this.expertise.set(entry.person, entry);
  }

  /**
   * Find the best expert for a given file path.
   * Matches path patterns against expertise areas and returns the top match.
   */
  findExpert(path: string): ExpertRanking | undefined {
    const ranked = this.whoKnows(path);
    return ranked.length > 0 ? ranked[0] : undefined;
  }

  getExpertise(person: string): ExpertiseEntry | undefined {
    return this.expertise.get(person);
  }

  // ── Architectural Decision Records ──────────────────────────────────────

  addADR(decision: ArchitecturalDecision): void {
    this.adrs.set(decision.id, decision);
  }

  getADR(id: string): ArchitecturalDecision | undefined {
    return this.adrs.get(id);
  }

  /**
   * Search ADRs by keyword matching on title, context, and decision fields.
   */
  searchADRs(query: string): ArchitecturalDecision[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return [];

    return [...this.adrs.values()].filter(adr => {
      const searchable = [
        adr.title,
        adr.context,
        adr.decision,
        adr.consequences,
        ...adr.tags,
      ]
        .join(' ')
        .toLowerCase();

      return keywords.some(keyword => searchable.includes(keyword));
    });
  }

  // ── Incident Learnings ──────────────────────────────────────────────────

  addIncidentLearning(learning: IncidentLearning): void {
    this.incidents.set(learning.id, learning);
  }

  /**
   * Search incidents by keyword matching on title, rootCause, and impact.
   */
  searchIncidents(query: string): IncidentLearning[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return [];

    return [...this.incidents.values()].filter(incident => {
      const searchable = [
        incident.title,
        incident.rootCause,
        incident.impact,
        incident.resolution,
        ...incident.lessons,
        ...incident.affectedServices,
      ]
        .join(' ')
        .toLowerCase();

      return keywords.some(keyword => searchable.includes(keyword));
    });
  }

  /**
   * Find incidents similar to a given description using keyword overlap.
   */
  findSimilarIncidents(description: string): IncidentLearning[] {
    const keywords = description.toLowerCase().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return [];

    const scored: Array<{ incident: IncidentLearning; score: number }> = [];

    for (const incident of this.incidents.values()) {
      const searchable = [
        incident.title,
        incident.rootCause,
        incident.impact,
        incident.resolution,
        ...incident.lessons,
      ]
        .join(' ')
        .toLowerCase();

      const score = keywords.reduce((acc, keyword) => {
        return acc + (searchable.includes(keyword) ? 1 : 0);
      }, 0);

      if (score > 0) {
        scored.push({ incident, score });
      }
    }

    // Sort by match score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.incident);
  }

  // ── Composite Queries ─────────────────────────────────────────────────

  /**
   * Who owns a service? Returns owners, team, and slack channel.
   */
  whoOwns(service: string): OwnershipInfo | undefined {
    const ownership = this.services.get(service);
    if (!ownership) return undefined;

    return {
      service: ownership.service,
      team: ownership.team,
      owners: ownership.owners,
      slackChannel: ownership.slackChannel,
    };
  }

  /**
   * Who knows about a file path? Returns a ranked list of experts
   * based on commit count and confidence for matching path patterns.
   */
  whoKnows(filePath: string): ExpertRanking[] {
    const rankings: ExpertRanking[] = [];

    for (const entry of this.expertise.values()) {
      for (const area of entry.areas) {
        if (this.pathMatches(filePath, area.path)) {
          rankings.push({
            person: entry.person,
            commitCount: area.commitCount,
            confidence: area.confidence,
            lastCommit: area.lastCommit,
          });
        }
      }
    }

    // Sort by confidence descending, then by commit count
    rankings.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.commitCount - a.commitCount;
    });

    return rankings;
  }

  /**
   * Get comprehensive context for a service: ownership, recent incidents,
   * and relevant architectural decisions.
   */
  getServiceContext(service: string): ServiceContext {
    const ownership = this.services.get(service);

    const recentIncidents = [...this.incidents.values()]
      .filter(i => i.affectedServices.includes(service))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const relevantADRs = [...this.adrs.values()].filter(
      adr =>
        adr.tags.includes(service) ||
        adr.context.toLowerCase().includes(service.toLowerCase()) ||
        adr.decision.toLowerCase().includes(service.toLowerCase()),
    );

    return { ownership, recentIncidents, relevantADRs };
  }

  /**
   * Get comprehensive onboarding context for a service — everything a
   * new team member needs to understand the service.
   */
  getOnboardingContext(service: string): OnboardingContext {
    const ownership = this.services.get(service);

    // Find experts who work on paths related to the service
    let experts = this.whoKnows(`${service}/index.ts`);
    if (experts.length === 0) {
      // Fallback: search all expertise entries for path patterns containing service name
      for (const entry of this.expertise.values()) {
        for (const area of entry.areas) {
          if (area.path.startsWith(service) || area.path.includes(`/${service}`)) {
            experts.push({
              person: entry.person,
              commitCount: area.commitCount,
              confidence: area.confidence,
              lastCommit: area.lastCommit,
            });
          }
        }
      }
    }

    const architecturalDecisions = [...this.adrs.values()]
      .filter(
        adr =>
          adr.status === 'accepted' &&
          (adr.tags.includes(service) ||
            adr.context.toLowerCase().includes(service.toLowerCase())),
      )
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const incidentHistory = [...this.incidents.values()]
      .filter(i => i.affectedServices.includes(service))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const preventionMeasures = incidentHistory.flatMap(
      i => i.preventionMeasures,
    );

    return {
      ownership,
      experts,
      architecturalDecisions,
      incidentHistory,
      preventionMeasures,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Simple glob-like path matching.
   * Supports ** (any path segment) and * (single segment).
   */
  private pathMatches(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars
      .replace(/\*\*/g, '{{GLOBSTAR}}')       // placeholder for **
      .replace(/\*/g, '[^/]*')                // * matches within a segment
      .replace(/\{\{GLOBSTAR\}\}/g, '.*');    // ** matches across segments

    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
  }
}
