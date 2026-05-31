import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pipeline } from "@xenova/transformers";
import postgres from "postgres";
import { logger } from "./logger";
import * as fs from "fs";
import * as path from "path";

export class VectorEngine {
  private pglite?: PGlite;
  private sql?: postgres.Sql<{}>;
  private extractor: any;

  async initialize() {
    this.extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    
    let dbUrl = process.env.POSTGRES_URL;
    const isDocker = fs.existsSync("/.dockerenv");

    if (!dbUrl && isDocker) {
      // Default connection string for our Docker Compose stack
      dbUrl = "postgres://user:pass@db:5432/raglike";
      logger.info("Docker environment detected. Defaulting to containerized Postgres service.");
    }

    if (dbUrl) {
      this.sql = postgres(dbUrl);
      logger.info("External Postgres connection initialized.");
    } else {
      const dbPath = path.join(process.cwd(), ".db");
      this.pglite = await PGlite.create(dbPath, { extensions: { vector } });
      logger.info({ path: dbPath }, "Local PGlite Vector Engine persistent storage initialized.");
    }
    
    await this.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    await this.exec(`
      CREATE TABLE IF NOT EXISTS markdown_chunks (
        id BIGSERIAL PRIMARY KEY,
        file_path TEXT,
        heading TEXT,
        content TEXT,
        embedding vector(384),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || content)) STORED
      );
    `);
    
    // Step 4: Add HNSW index for high-performance vector search with tuned parameters
    // We drop and recreate to ensure parameters like m and ef_construction are applied
    await this.exec("DROP INDEX IF EXISTS idx_markdown_chunks_embedding;");
    await this.exec("CREATE INDEX idx_markdown_chunks_embedding ON markdown_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);");
    
    // Ensure search_vector column exists for hybrid search
    try {
      await this.exec("ALTER TABLE markdown_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || content)) STORED;");
    } catch (e) {
      // In some older postgres versions ADD COLUMN IF NOT EXISTS with GENERATED might be finicky
      logger.warn("Could not add search_vector column via ALTER TABLE, it might already exist or the syntax is unsupported by this version.");
    }

    // Add GIN index for full-text search (replacing GIST if it existed for better performance)
    await this.exec("DROP INDEX IF EXISTS idx_markdown_chunks_search_vector;");
    await this.exec("CREATE INDEX idx_markdown_chunks_search_vector ON markdown_chunks USING GIN (search_vector);");
    
    logger.info("Database subsystem fully ready and schema verified.");
  }

  private async exec(query: string) {
    if (this.sql) {
      await this.sql.unsafe(query);
    } else {
      await this.pglite!.exec(query);
    }
  }

  private async query<T>(query: string, params: any[]): Promise<{ rows: T[] }> {
    if (this.sql) {
      const results = await this.sql.unsafe(query, params);
      return { rows: results as unknown as T[] };
    } else {
      return await this.pglite!.query<T>(query, params);
    }
  }

  async hasData(): Promise<boolean> {
    const res = await this.query<{ count: string }>("SELECT count(*) as count FROM markdown_chunks", []);
    return parseInt(res.rows[0].count) > 0;
  }

  private async generateEmbeddingString(text: string): Promise<string> {
    const output = await this.extractor(text, { pooling: "mean", normalize: true });
    const array = Array.from(output.data as Float32Array);
    return `[${array.join(",")}]`; // Native Postgres representation
  }

  private getFilesRecursively(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.map(entry => {
      const res = path.resolve(dir, entry.name);
      return entry.isDirectory() ? this.getFilesRecursively(res) : res;
    });
    return files.flat().filter(f => f.endsWith(".md"));
  }

  async indexDirectory(rootDocsDir: string) {
    if (!fs.existsSync(rootDocsDir)) return;
    const targetFiles = this.getFilesRecursively(rootDocsDir);
    
    const CONCURRENCY_LIMIT = 5; // Process 5 files at a time to manage CPU/Memory
    for (let i = 0; i < targetFiles.length; i += CONCURRENCY_LIMIT) {
      const batch = targetFiles.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(batch.map(file => this.indexSingleFile(file)));
    }
    
    logger.info({ totalFiles: targetFiles.length }, "Recursive workspace folder ingestion complete.");
  }

  private async indexSingleFile(filePath: string) {
    const relativePath = path.relative(process.cwd(), filePath);
    const rawContent = fs.readFileSync(filePath, "utf-8");
    
    // Extract H1 title if present
    const h1Match = rawContent.match(/^# (.*)$/m);
    const h1Title = h1Match ? h1Match[1].trim() : "";

    const sections = rawContent.split(/(?=^##+ )/m);
    const chunksToInsert: [string, string, string, string][] = [];

    for (const section of sections) {
      const lines = section.split("\n");
      const heading = lines[0].startsWith("#") ? lines[0].trim() : "General";
      const sectionContent = lines.slice(1).join("\n").trim();

      // Step 3: Smart Chunking with Overlap
      // Instead of just paragraph splitting, we ensure chunks are of a reasonable size
      // and overlap to maintain context.
      const CHUNK_SIZE = 600;
      const CHUNK_OVERLAP = 100;
      
      let startIndex = 0;
      while (startIndex < sectionContent.length) {
        let endIndex = startIndex + CHUNK_SIZE;
        let chunk = sectionContent.substring(startIndex, endIndex);
        
        // If we're not at the end, try to find a natural break (period or newline)
        if (endIndex < sectionContent.length) {
          const lastBreak = Math.max(chunk.lastIndexOf("\n"), chunk.lastIndexOf(". "));
          if (lastBreak > CHUNK_SIZE * 0.7) {
            endIndex = startIndex + lastBreak + 1;
            chunk = sectionContent.substring(startIndex, endIndex);
          }
        }

        const trimmedChunk = chunk.trim();
        if (trimmedChunk.length > 50) {
          const contextPrefix = h1Title && !heading.includes(h1Title) ? `${h1Title} > ` : "";
          const vectorString = await this.generateEmbeddingString(`${contextPrefix}${heading}\n${trimmedChunk}`);
          chunksToInsert.push([relativePath, heading, trimmedChunk, vectorString]);
        }
        
        startIndex = endIndex - CHUNK_OVERLAP;
        // Safety check to avoid infinite loop
        if (startIndex >= sectionContent.length || chunk.length < CHUNK_OVERLAP) break;
      }
    }

    // Batch insert for this file
    if (chunksToInsert.length > 0) {
      if (this.sql) {
        // Postgres.js batch insert
        await this.sql`
          INSERT INTO markdown_chunks (file_path, heading, content, embedding)
          VALUES ${this.sql(chunksToInsert)}
        `;
      } else {
        // PGlite doesn't have a built-in batch helper as clean as postgres.js, so we iterate
        // but it's still better than doing it paragraph-by-paragraph in the main loop
        for (const [path, head, cont, emb] of chunksToInsert) {
          await this.query(
            "INSERT INTO markdown_chunks (file_path, heading, content, embedding) VALUES ($1, $2, $3, $4)",
            [path, head, cont, emb]
          );
        }
      }
    }
  }

  async search(queryText: string, limit: number) {
    const queryVectorStr = await this.generateEmbeddingString(queryText);
    
    // Hybrid Search: Reciprocal Rank Fusion (RRF)
    // RRF combines the rankings from different search methods to provide a more robust result set.
    // The formula is: score = sum(1 / (k + rank)) where k is a constant (usually 60).
    const res = await this.query<{ file_path: string; heading: string; content: string; distance: number; rrf_score: number }>(`
      WITH vector_search AS (
        SELECT id, row_number() OVER (ORDER BY embedding <=> $1 ASC) as rank
        FROM markdown_chunks
        LIMIT $2 * 2
      ),
      text_search AS (
        SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search_vector, websearch_to_tsquery('english', $3)) DESC) as rank
        FROM markdown_chunks
        WHERE search_vector @@ websearch_to_tsquery('english', $3)
        LIMIT $2 * 2
      )
      SELECT 
        m.file_path, 
        m.heading, 
        m.content, 
        COALESCE((m.embedding <=> $1), 1.0) as distance,
        (COALESCE(1.0 / (60 + v.rank), 0.0) + COALESCE(1.0 / (60 + t.rank), 0.0))::float as rrf_score
      FROM markdown_chunks m
      LEFT JOIN vector_search v ON m.id = v.id
      LEFT JOIN text_search t ON m.id = t.id
      WHERE v.id IS NOT NULL OR t.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $2;
    `, [queryVectorStr, limit, queryText]);

    return res.rows;
  }

  async readDocument(relativePath: string): Promise<string | null> {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (!fullPath.startsWith(process.cwd())) {
      throw new Error("Security violation: Attempted path traversal outside workspace.");
    }
    
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fs.readFileSync(fullPath, "utf-8");
    }
    return null;
  }

  async destroy() {
    if (this.pglite) await this.pglite.close();
    if (this.sql) await this.sql.end();
  }
}
