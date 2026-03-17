// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Slash Command Router
// Routes /commands from chat to the appropriate agent.
// ─────────────────────────────────────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  description: string;
  agentId: string;
  usage: string;
}

export interface ParsedSlashCommand {
  command: SlashCommand;
  args: string;
  raw: string;
}

// ─── Built-in Commands ──────────────────────────────────────────────────────

const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'debug',
    description: 'Root-cause analysis with logs, traces, and code context',
    agentId: 'agent-debug',
    usage: '/debug <error description or log snippet>',
  },
  {
    name: 'deploy',
    description: 'Trigger or inspect deployments',
    agentId: 'agent-deploy',
    usage: '/deploy <service> [environment]',
  },
  {
    name: 'review',
    description: 'AI code review with production context',
    agentId: 'agent-review',
    usage: '/review [file or PR reference]',
  },
  {
    name: 'security',
    description: 'Security analysis and vulnerability scanning',
    agentId: 'agent-security',
    usage: '/security <target or description>',
  },
  {
    name: 'incident',
    description: 'Incident management and timeline reconstruction',
    agentId: 'agent-incident',
    usage: '/incident <incident ID or description>',
  },
  {
    name: 'cost',
    description: 'Cloud cost analysis and optimization suggestions',
    agentId: 'agent-cost',
    usage: '/cost <service or resource>',
  },
  {
    name: 'query',
    description: 'Natural language queries against infrastructure data',
    agentId: 'agent-query',
    usage: '/query <natural language question>',
  },
  {
    name: 'impact',
    description: 'Blast radius and impact analysis for changes',
    agentId: 'agent-impact',
    usage: '/impact <change description or file>',
  },
  {
    name: 'timeline',
    description: 'Reconstruct event timelines across services',
    agentId: 'agent-timeline',
    usage: '/timeline <event or time range>',
  },
  {
    name: 'who-owns',
    description: 'Find ownership of services, endpoints, or code paths',
    agentId: 'agent-who-owns',
    usage: '/who-owns <service, endpoint, or file>',
  },
  {
    name: 'onboard',
    description: 'Generate onboarding context for a service or area',
    agentId: 'agent-onboard',
    usage: '/onboard <service or codebase area>',
  },
  {
    name: 'flag',
    description: 'Feature flag management and analysis',
    agentId: 'agent-flag',
    usage: '/flag <flag name or action>',
  },
  {
    name: 'release',
    description: 'Release management and changelog generation',
    agentId: 'agent-release',
    usage: '/release <version or action>',
  },
  {
    name: 'oncall',
    description: 'On-call information and escalation',
    agentId: 'agent-oncall',
    usage: '/oncall <service or team>',
  },
  {
    name: 'scaffold',
    description: 'Scaffold new services, endpoints, or components',
    agentId: 'agent-scaffold',
    usage: '/scaffold <type> <name>',
  },
];

// ─── Router ─────────────────────────────────────────────────────────────────

export class SlashCommandRouter {
  private commands = new Map<string, SlashCommand>();

  constructor() {
    for (const cmd of BUILTIN_COMMANDS) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /**
   * Register a custom slash command.
   */
  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
  }

  /**
   * Unregister a slash command.
   */
  unregister(name: string): void {
    this.commands.delete(name);
  }

  /**
   * Check if a message starts with a slash command.
   */
  isSlashCommand(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return false;
    const name = trimmed.slice(1).split(/\s+/)[0];
    return this.commands.has(name);
  }

  /**
   * Parse a slash command from a message.
   * Returns undefined if the message is not a recognized command.
   */
  parse(message: string): ParsedSlashCommand | undefined {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return undefined;

    const spaceIndex = trimmed.indexOf(' ');
    const name = spaceIndex === -1
      ? trimmed.slice(1)
      : trimmed.slice(1, spaceIndex);

    const command = this.commands.get(name);
    if (!command) return undefined;

    const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

    return { command, args, raw: trimmed };
  }

  /**
   * Get all registered commands (for autocomplete / help).
   */
  listCommands(): SlashCommand[] {
    return [...this.commands.values()];
  }

  /**
   * Get a specific command by name.
   */
  getCommand(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }
}
