export function diffMigrationsAgainstSchema(options?: {
  root?: string;
  workDir?: string;
}): Promise<{ changed: boolean; sql: string; shadowDbPath: string }>;

export function expectedTriggers(root?: string): string[];
