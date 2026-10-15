/** Loads the repo-root .env if it exists. Real environment variables win over the file. */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch {
    // No .env file: rely on the real environment (CI, production).
  }
}
