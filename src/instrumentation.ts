export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Chybějící tajemství má shodit start serveru hned, ne až první požadavek.
  const { assertRuntimeEnv } = await import("./env");
  assertRuntimeEnv();
}
