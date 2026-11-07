export function encryptBuffer(plain: Buffer, password: string): Buffer;
export function decryptBuffer(data: Buffer, password: string): Buffer;
export function createEncryptedBackup(options: {
  dataDir: string;
  backupDir: string;
  password: string;
  now?: Date;
}): Promise<{ file: string; sizeBytes: number; sha256: string }>;
export function pruneBackups(backupDir: string, keepRecent?: number): string[];
export function restoreEncryptedBackup(options: { file: string; password: string; targetDir: string }): Promise<void>;
