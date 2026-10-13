export interface ConfigIssue {
  key: string;
  message: string;
}

export const formatIssues = (issues: readonly ConfigIssue[]): string => {
  const width = Math.max(...issues.map((issue) => issue.key.length));
  const count = `${issues.length} problem${issues.length === 1 ? '' : 's'}`;
  return [`Invalid configuration (${count}):`, ...issues.map((issue) => `  ${issue.key.padEnd(width)}  ${issue.message}`)].join('\n');
};

export class ConfigError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    super(formatIssues(issues));
    this.name = 'ConfigError';
  }
}
