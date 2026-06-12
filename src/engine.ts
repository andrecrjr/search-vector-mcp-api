import * as fs from "node:fs";
import * as path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import {
	AutoModelForSequenceClassification,
	AutoTokenizer,
	pipeline,
} from "@huggingface/transformers";
import type { Content, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString as mdastToString } from "mdast-util-to-string";
import pdf2md from "pdf2md-ts";
import postgres from "postgres";
import { logger } from "./logger";

interface TransformerOutput {
	data: Float32Array | number[];
}

type RerankerModel = (
	inputs: unknown,
) => Promise<{ logits: { data: Float32Array | number[] } }>;

type RerankerTokenizer = (
	queries: string[],
	options: { text_pair: string[]; padding: boolean; truncation: boolean },
) => Promise<unknown>;

type Extractor = (
	text: string,
	options: { pooling: string; normalize: boolean },
) => Promise<TransformerOutput>;

export interface MarkdownChunk {
	id: string;
	file_path: string;
	heading: string;
	content: string;
	distance: number;
	rrf_score: number;
	rerank_score?: number;
	last_modified?: Date;
	word_count?: number;
	repository_id?: string;
}

export class VectorEngine {
	private pglite?: PGlite;
	private sql?: postgres.Sql<Record<string, never>>;
	private extractor?: Extractor;
	private rerankerModel?: RerankerModel;
	private rerankerTokenizer?: RerankerTokenizer;
	private dbPathOverride?: string;

	constructor(dbPath?: string) {
		this.dbPathOverride = dbPath;
	}

	async initialize() {
		this.extractor = (await pipeline(
			"feature-extraction",
			"Xenova/all-mpnet-base-v2",
		)) as Extractor;
		this.rerankerModel =
			(await AutoModelForSequenceClassification.from_pretrained(
				"Xenova/bge-reranker-base",
			)) as RerankerModel;
		this.rerankerTokenizer = (await AutoTokenizer.from_pretrained(
			"Xenova/bge-reranker-base",
		)) as RerankerTokenizer;
		logger.info(
			"Models loaded: all-mpnet-base-v2 (Embedding) & bge-reranker-base (Reranker)",
		);

		let dbUrl = process.env.POSTGRES_URL;
		const isDocker = fs.existsSync("/.dockerenv");

		if (!dbUrl && isDocker) {
			// Default connection string for our Docker Compose stack
			dbUrl = "postgres://user:pass@db:5432/raglike";
			logger.info(
				"Docker environment detected. Defaulting to containerized Postgres service.",
			);
		}

		if (dbUrl) {
			this.sql = postgres(dbUrl);
			logger.info("External Postgres connection initialized.");
		} else {
			const dbPath =
				this.dbPathOverride || path.join(process.cwd(), "raglike_db");
			this.pglite = await PGlite.create(dbPath, { extensions: { vector } });
			logger.info(
				{ path: dbPath },
				"Local PGlite Vector Engine persistent storage initialized.",
			);
		}

		await this.exec("CREATE EXTENSION IF NOT EXISTS vector;");

		// Check if the table exists and if the embedding dimension matches
		const tableExists = await this.query<{ exists: boolean }>(
			"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'markdown_chunks')",
			[],
		);

		if (tableExists.rows[0].exists) {
			const dimRes = await this.query<{ atttypmod: number }>(
				"SELECT atttypmod FROM pg_attribute WHERE attrelid = 'markdown_chunks'::regclass AND attname = 'embedding'",
				[],
			);
			if (dimRes.rows.length > 0 && dimRes.rows[0].atttypmod !== 768) {
				logger.warn(
					{ oldDim: dimRes.rows[0].atttypmod, newDim: 768 },
					"Vector dimension mismatch detected. Dropping table for re-ingestion.",
				);
				await this.exec("DROP TABLE markdown_chunks;");
			}
		}

		await this.exec(`
      CREATE TABLE IF NOT EXISTS markdown_chunks (
        id BIGSERIAL PRIMARY KEY,
        file_path TEXT,
        heading TEXT,
        content TEXT,
        embedding vector(768),
        last_modified TIMESTAMP,
        word_count INTEGER,
        repository_id TEXT,
        search_vector tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(heading, '')), 'A') || 
          setweight(to_tsvector('english', coalesce(content, '')), 'B')
        ) STORED
      );
    `);

		// Step 4: Add HNSW index for high-performance vector search with tuned parameters
		// We drop and recreate to ensure parameters like m and ef_construction are applied
		await this.exec("DROP INDEX IF EXISTS idx_markdown_chunks_embedding;");
		await this.exec(
			"CREATE INDEX idx_markdown_chunks_embedding ON markdown_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 24, ef_construction = 100);",
		);

		// Ensure new columns exist for existing databases and update search_vector if needed
		try {
			await this.exec(
				"ALTER TABLE markdown_chunks ADD COLUMN IF NOT EXISTS last_modified TIMESTAMP;",
			);
			await this.exec(
				"ALTER TABLE markdown_chunks ADD COLUMN IF NOT EXISTS word_count INTEGER;",
			);
			await this.exec(
				"ALTER TABLE markdown_chunks ADD COLUMN IF NOT EXISTS repository_id TEXT;",
			);

			// Check if we need to upgrade search_vector to weighted version
			// In PostgreSQL we can't easily ALTER a GENERATED column's expression,
			// so we drop and recreate if it's already there to ensure the new weights apply.
			try {
				await this.exec(
					"ALTER TABLE markdown_chunks DROP COLUMN IF EXISTS search_vector;",
				);
			} catch (_e) {
				logger.debug(
					"search_vector column did not exist or could not be dropped.",
				);
			}

			await this.exec(`
        ALTER TABLE markdown_chunks ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(heading, '')), 'A') || 
          setweight(to_tsvector('english', coalesce(content, '')), 'B')
        ) STORED;
      `);
		} catch (_e) {
			logger.warn(
				"Could not update schema columns, they might already exist or the syntax is unsupported by this version.",
			);
		}

		// Add GIN index for full-text search (replacing GIST if it existed for better performance)
		await this.exec("DROP INDEX IF EXISTS idx_markdown_chunks_search_vector;");
		await this.exec(
			"CREATE INDEX idx_markdown_chunks_search_vector ON markdown_chunks USING GIN (search_vector);",
		);

		logger.info("Database subsystem fully ready and schema verified.");
	}

	private async exec(query: string) {
		if (this.sql) {
			await this.sql.unsafe(query);
		} else {
			await this.pglite?.exec(query);
		}
	}

	private async query<T>(
		query: string,
		params: unknown[],
	): Promise<{ rows: T[] }> {
		if (this.sql) {
			const results = await this.sql.unsafe(
				query,
				params as postgres.Parameter[],
			);
			return { rows: results as unknown as T[] };
		}
		const result = await this.pglite?.query<T>(query, params);
		return { rows: result?.rows || [] };
	}

	async removeDocument(relativePath: string) {
		await this.query("DELETE FROM markdown_chunks WHERE file_path = $1", [
			relativePath,
		]);
		logger.info(
			{ file: relativePath },
			"Document chunks removed from database.",
		);
	}

	async hasData(): Promise<boolean> {
		const res = await this.query<{ count: string }>(
			"SELECT count(*) as count FROM markdown_chunks",
			[],
		);
		return res.rows[0] ? parseInt(res.rows[0].count, 10) > 0 : false;
	}

	private async generateEmbeddingString(text: string): Promise<string> {
		if (!this.extractor) throw new Error("Extractor not initialized");
		const output = await this.extractor(text, {
			pooling: "mean",
			normalize: true,
		});
		const array = Array.from(output.data as Float32Array);
		if (array.length !== 768) {
			throw new Error(
				`Unexpected embedding dimension: expected 768, got ${array.length}`,
			);
		}
		return `[${array.join(",")}]`; // Native Postgres representation
	}

	private getFilesRecursively(dir: string): string[] {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		const files = entries.map((entry) => {
			const res = path.resolve(dir, entry.name);
			return entry.isDirectory() ? this.getFilesRecursively(res) : res;
		});
		return files.flat().filter((f) => f.endsWith(".md") || f.endsWith(".pdf"));
	}

	async indexDirectory(rootDocsDir: string) {
		if (!fs.existsSync(rootDocsDir)) return;
		const targetFiles = this.getFilesRecursively(rootDocsDir);

		const CONCURRENCY_LIMIT = 5; // Process 5 files at a time to manage CPU/Memory
		for (let i = 0; i < targetFiles.length; i += CONCURRENCY_LIMIT) {
			const batch = targetFiles.slice(i, i + CONCURRENCY_LIMIT);
			await Promise.all(batch.map((file) => this.indexSingleFile(file)));
		}

		logger.info(
			{ totalFiles: targetFiles.length },
			"Recursive workspace folder ingestion complete.",
		);
	}

	public async indexSingleFile(filePath: string, repositoryId?: string) {
		const relativePath = path.relative(process.cwd(), filePath);
		const stats = fs.statSync(filePath);
		const lastModified = stats.mtime;
		let rawContent: string;

		if (filePath.endsWith(".pdf")) {
			const buffer = fs.readFileSync(filePath);
			const pages = await pdf2md(new Uint8Array(buffer));
			rawContent = pages.join("\n\n");
		} else {
			rawContent = fs.readFileSync(filePath, "utf-8");
		}

		// Clean base64 image data from markdown to prevent bloating the vector database
		rawContent = rawContent.replace(
			/!\[.*?\]\(data:image\/[^;]+;base64,[^)]*\)/g,
			"",
		);
		rawContent = rawContent.replace(
			/<img\s+[^>]*src="data:image\/[^;]+;base64,[^"]*"[^>]*>/g,
			"",
		);
		rawContent = rawContent.replace(
			/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g,
			"",
		);

		// Clear old chunks first to ensure clean updates
		await this.removeDocument(relativePath);

		const tree = fromMarkdown(rawContent);
		const chunksToInsert: [
			string,
			string,
			string,
			string,
			Date,
			number,
			string | null,
		][] = [];
		const breadcrumbs: string[] = [];
		const chunksRaw: { heading: string; content: string }[] = [];

		let currentChunkNodes: Content[] = [];
		let currentChunkTextLength = 0;
		const CHUNK_SIZE_LIMIT = 1200; // Increased limit for AST-based chunks to keep structural integrity

		const emitChunk = (nodes: Content[], breadcrumbs: string[]) => {
			if (nodes.length === 0) return;

			// Convert nodes back to markdown
			const content = toMarkdown({
				type: "root",
				children: nodes,
			} as Root).trim();
			if (!content) return;

			const heading = breadcrumbs.join(" > ") || "General";
			chunksRaw.push({ heading, content });
		};

		for (let i = 0; i < tree.children.length; i++) {
			const node = tree.children[i];

			if (node.type === "heading") {
				// Header is a natural boundary
				if (currentChunkNodes.length > 0) {
					emitChunk(currentChunkNodes, breadcrumbs);
					currentChunkNodes = [];
					currentChunkTextLength = 0;
				}

				const level = node.depth;
				const title = mdastToString(node).trim();

				// Update breadcrumbs based on level
				while (breadcrumbs.length >= level) {
					breadcrumbs.pop();
				}
				breadcrumbs.push(title);

				// Optional: should the header itself be part of the next chunk?
				// For structural search, yes, it helps context.
				currentChunkNodes.push(node);
				currentChunkTextLength += title.length;
				continue;
			}

			const nodeText = mdastToString(node);

			// Code Block Bundling Logic
			if (node.type === "code") {
				// If adding this code block would make the chunk too large,
				// and we already have a preceding paragraph, we might still want to keep them together
				// unless it's truly massive.
				if (
					currentChunkTextLength > 0 &&
					currentChunkTextLength + nodeText.length > CHUNK_SIZE_LIMIT
				) {
					// Only emit if the current chunk isn't just a short contextual paragraph
					// If the last node was a paragraph and it's short, keep it for context.
					const lastNode = currentChunkNodes[currentChunkNodes.length - 1];
					if (
						lastNode &&
						lastNode.type === "paragraph" &&
						mdastToString(lastNode).length < 200
					) {
						// Keep it together, don't emit yet.
					} else {
						emitChunk(currentChunkNodes, breadcrumbs);
						currentChunkNodes = [];
						currentChunkTextLength = 0;
					}
				}
			}

			currentChunkNodes.push(node);
			currentChunkTextLength += nodeText.length;

			// If we reached the limit, emit and start new
			if (currentChunkTextLength >= CHUNK_SIZE_LIMIT) {
				// Check if the next node is a code block. If so, don't emit yet,
				// so we can bundle them in the next iteration's code logic.
				const nextNode = tree.children[i + 1];
				if (nextNode && nextNode.type === "code") {
					// Delay emission to bundle with code block
				} else {
					emitChunk(currentChunkNodes, breadcrumbs);
					currentChunkNodes = [];
					currentChunkTextLength = 0;
				}
			}
		}

		// Final chunk
		if (currentChunkNodes.length > 0) {
			emitChunk(currentChunkNodes, breadcrumbs);
		}

		const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
		const getSentences = (text: string) => {
			return Array.from(segmenter.segment(text)).map((s) => s.segment);
		};

		// Apply Context Slop and generate embeddings
		for (let i = 0; i < chunksRaw.length; i++) {
			const chunk = chunksRaw[i];
			let finalContent = chunk.content;

			// Prepend slop from previous chunk
			if (i > 0) {
				const prev = chunksRaw[i - 1];
				const prevSents = getSentences(prev.content);
				const lastSent = prevSents[prevSents.length - 1];
				if (lastSent) {
					finalContent = `[Context from ${prev.heading}]: ...${lastSent.trim()}\n\n${finalContent}`;
				}
			}

			// Append slop from next chunk
			if (i < chunksRaw.length - 1) {
				const next = chunksRaw[i + 1];
				const nextSents = getSentences(next.content);
				const firstSent = nextSents[0];
				if (firstSent) {
					finalContent = `${finalContent}\n\n[Context continues in ${next.heading}]: ${firstSent.trim()}...`;
				}
			}

			const wordCount = finalContent.split(/\s+/).length;
			const embeddingContent = `${chunk.heading}\n${finalContent}`;
			const vectorString = await this.generateEmbeddingString(embeddingContent);

			chunksToInsert.push([
				relativePath,
				chunk.heading,
				finalContent,
				vectorString,
				lastModified,
				wordCount,
				repositoryId || null,
			]);
		}

		logger.debug(
			{ file: relativePath, chunkCount: chunksToInsert.length },
			"Attempting to insert chunks into database",
		);

		// Batch insert for this file
		if (chunksToInsert.length > 0) {
			try {
				if (this.sql) {
					await this.sql`
          INSERT INTO markdown_chunks (file_path, heading, content, embedding, last_modified, word_count, repository_id)
          VALUES ${this.sql(chunksToInsert as unknown as postgres.Parameter[][])}
        `;
				} else {
					for (const [
						path,
						head,
						cont,
						emb,
						mod,
						word,
						repo,
					] of chunksToInsert) {
						await this.query(
							"INSERT INTO markdown_chunks (file_path, heading, content, embedding, last_modified, word_count, repository_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
							[path, head, cont, emb, mod, word, repo],
						);
					}
				}
				logger.info(
					{ file: relativePath, chunks: chunksToInsert.length },
					"File indexed successfully.",
				);
			} catch (err) {
				logger.error(
					{ err, file: relativePath },
					"Failed to insert chunks into database",
				);
				throw err;
			}
		} else {
			logger.warn({ file: relativePath }, "No chunks generated for file");
		}
	}

	async search(
		queryText: string,
		limit: number,
		rerank: boolean = false,
		repositoryId?: string,
	) {
		const queryVectorStr = await this.generateEmbeddingString(queryText);

		// Hybrid Search: Reciprocal Rank Fusion (RRF)
		// RRF combines the rankings from different search methods to provide a more robust result set.
		// The formula is: score = sum(weight / (k + rank)) where k is a constant (usually 60).
		// We define weights as variables for easy future tuning (currently 1:1 balance).
		const VECTOR_WEIGHT = 1.0;
		const TEXT_WEIGHT = 1.0;
		const K = 60;

		// If reranking, we fetch more results initially to have a better candidate pool
		const initialLimit = rerank ? Math.max(limit * 5, 50) : limit;

		const repoFilter = repositoryId ? "AND repository_id = $4" : "";

		const res = await this.query<{
			id: string;
			file_path: string;
			heading: string;
			content: string;
			distance: number;
			rrf_score: number;
			repository_id: string;
		}>(
			`
      WITH vector_search AS (
        SELECT id, row_number() OVER (ORDER BY embedding <=> $1 ASC) as rank
        FROM markdown_chunks
        WHERE 1=1 ${repoFilter}
        LIMIT $3 * 2
      ),
      text_search AS (
        SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search_vector, websearch_to_tsquery('english', $2)) DESC) as rank
        FROM markdown_chunks
        WHERE search_vector @@ websearch_to_tsquery('english', $2) ${repoFilter}
        LIMIT $3 * 2
      )
      SELECT 
        m.id,
        m.file_path, 
        m.heading, 
        m.content, 
        m.last_modified,
        m.word_count,
        m.repository_id,
        COALESCE((m.embedding <=> $1), 1.0) as distance,
        (
          COALESCE(${VECTOR_WEIGHT.toFixed(1)} / (${K}.0 + v.rank), 0.0) + 
          COALESCE(${TEXT_WEIGHT.toFixed(1)} / (${K}.0 + t.rank), 0.0)
        )::float as rrf_score
      FROM markdown_chunks m
      LEFT JOIN vector_search v ON m.id = v.id
      LEFT JOIN text_search t ON m.id = t.id
      WHERE v.id IS NOT NULL OR t.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $3;
    `,
			repositoryId
				? [queryVectorStr, queryText, initialLimit, repositoryId]
				: [queryVectorStr, queryText, initialLimit],
		);

		let results: MarkdownChunk[] = res.rows;

		if (rerank && this.rerankerModel && this.rerankerTokenizer) {
			logger.info(
				{ count: results.length },
				"Reranking search results via cross-encoder...",
			);
			const passages = results.map(
				(item) => `${item.heading}\n${item.content}`,
			);
			const queries = new Array(passages.length).fill(queryText);

			const inputs = await this.rerankerTokenizer(queries, {
				text_pair: passages,
				padding: true,
				truncation: true,
			});

			const { logits } = await this.rerankerModel(inputs);

			const reranked = results.map((item, i) => ({
				...item,
				rerank_score: logits.data[i] as number,
			}));

			results = reranked
				.sort((a, b) => (b.rerank_score || 0) - (a.rerank_score || 0))
				.slice(0, limit);
		}

		return results;
	}

	async getChunkNeighbors(id: number) {
		const chunkRes = await this.query<{ file_path: string }>(
			"SELECT file_path FROM markdown_chunks WHERE id = $1",
			[id],
		);
		if (chunkRes.rows.length === 0 || !chunkRes.rows[0]) return null;
		const filePath = chunkRes.rows[0].file_path;

		const prevRes = await this.query<{
			id: string;
			heading: string;
			content: string;
		}>(
			"SELECT id, heading, content FROM markdown_chunks WHERE file_path = $1 AND id < $2 ORDER BY id DESC LIMIT 1",
			[filePath, id],
		);
		const nextRes = await this.query<{
			id: string;
			heading: string;
			content: string;
		}>(
			"SELECT id, heading, content FROM markdown_chunks WHERE file_path = $1 AND id > $2 ORDER BY id ASC LIMIT 1",
			[filePath, id],
		);

		return {
			previous: prevRes.rows[0] || null,
			next: nextRes.rows[0] || null,
		};
	}

	async readDocument(relativePath: string): Promise<string | null> {
		const fullPath = path.resolve(process.cwd(), relativePath);
		if (!fullPath.startsWith(process.cwd())) {
			throw new Error(
				"Security violation: Attempted path traversal outside workspace.",
			);
		}

		if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
			if (fullPath.endsWith(".pdf")) {
				const buffer = fs.readFileSync(fullPath);
				const pages = await pdf2md(new Uint8Array(buffer));
				return pages.join("\n\n");
			}
			return fs.readFileSync(fullPath, "utf-8");
		}
		return null;
	}

	async destroy() {
		if (this.pglite) await this.pglite.close();
		if (this.sql) await this.sql.end();
	}
}
