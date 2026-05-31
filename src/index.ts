import { VectorEngine } from "./engine";
import { startMcpServer } from "./mcp";
import { startHttpServer } from "./api";
import { logger } from "./logger";
import * as path from "path";

const engine = new VectorEngine();
await engine.initialize();

// Only ingest if the database is currently empty
if (!(await engine.hasData())) {
  logger.info("Database is empty. Starting initial ingestion of 'docs' directory...");
  const docsDirectoryPath = path.join(process.cwd(), "docs");
  await engine.indexDirectory(docsDirectoryPath);
} else {
  logger.info("Persistent database already contains data. Skipping auto-ingestion.");
}

const includeApi = process.env.ENABLE_API === "true" || Bun.argv.includes("--api");
const includeMcp = process.env.ENABLE_MCP === "true" || Bun.argv.includes("--mcp") || (!includeApi && !process.env.ENABLE_API);

if (includeApi) {
  startHttpServer(engine);
}

if (includeMcp) {
  // Fall back to standard input/output streams required by MCP hosts
  await startMcpServer(engine);
}

logger.info("Application context fully stabilized and active.");
