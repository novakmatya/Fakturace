export type MockEmailMessage = {
  channel: "resend" | "gmail";
  id: string;
  idempotencyKey: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  receivedAt: string;
};

export function startMockEmail(options?: {
  port?: number;
  host?: string;
  apiKey?: string;
  gmailSecret?: string;
}): Promise<{
  url: string;
  gmailUrl: string;
  gmailSecret: string;
  messages: MockEmailMessage[];
  readonly requestCount: number;
  failNext(...items: (number | string)[]): void;
  reset(): void;
  close(): Promise<void>;
}>;
