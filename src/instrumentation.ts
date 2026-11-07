export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Chybějící tajemství má shodit start serveru hned, ne až první požadavek.
  const { assertRuntimeEnv } = await import("./env");
  assertRuntimeEnv();
  // Fronta e-mailů: opakované pokusy a zprávy, které nestihly odejít hned.
  const { startEmailWorker } = await import("./lib/email/worker");
  startEmailWorker();
}
