import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { VectorEngine } from "./engine";
import * as fs from "fs";
import * as path from "path";

describe("PGlite Vector Search Engine Core", () => {
  let engine: VectorEngine;
  const mockDocsDir = path.join(process.cwd(), "test-docs-sandbox");

  beforeEach(async () => {
    // In-memory persistent testing instance
    engine = new VectorEngine();
    await engine.initialize();

    // Generate nested directories
    fs.mkdirSync(path.join(mockDocsDir, "nested/layer"), { recursive: true });
    fs.writeFileSync(
      path.join(mockDocsDir, "nested/layer/doc.md"),
      "## Deep Module\nThis is highly isolated custom metadata documentation details."
    );
  });

  afterEach(async () => {
    await engine.destroy();
    if (fs.existsSync(mockDocsDir)) {
      fs.rmSync(mockDocsDir, { recursive: true, force: true });
    }
  });

  test("Should recursively ingest nested folder layers and retrieve items semantically", async () => {
    await engine.indexDirectory(mockDocsDir);

    // Validate structural storage execution matching semantic vectors
    const query = "isolated custom metadata";
    const matches = await engine.search(query, 1);

    expect(matches.length).toBe(1);
    expect(matches[0].heading).toBe("## Deep Module");
    expect(matches[0].content).toContain("highly isolated");
  });
});
