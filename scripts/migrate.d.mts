export function runMigrations(options: {
  dbPath: string;
  migrationsDir: string;
  log?: (message: string) => void;
}): { applied: string[] };
