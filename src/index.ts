import { VectorEngine } from "./engine";
import { startMcpServer } from "./mcp";
import { startHttpServer } from "./api";
import { logger } from "./logger";
import * as path from "path";

const engine = new VectorEngine();
await engine.initialize();

// Recursively process files inside the local docs folder
const docsDirectoryPath = path.join(process.cwd(), "docs");
await engine.indexDirectory(docsDirectoryPath);

const runAsApi = Bun.argv.includes("--api");

if (runAsApi) {
  startHttpServer(engine);
} else {
  // Fall back to standard input/output streams required by MCP hosts
  await startMcpServer(engine);
}

logger.info("Application context fully stabilized and active.");
