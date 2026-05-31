# Vector Engine Details

The `VectorEngine` class manages the lifecycle of document indexing and retrieval, supporting both local and distributed database backends.

## Dual Database Architecture
The engine dynamically selects its storage backend based on the environment:
1. **External Postgres**: If `POSTGRES_URL` is set, the engine uses the `postgres.js` client to connect to an external database.
2. **Local PGlite**: If running locally without a URL, it uses an embedded PGlite instance.
3. **Docker Auto-Discovery**: When running in Docker, it defaults to the `db:5432` service if no `POSTGRES_URL` is provided.

## Smart Chunking Strategy
To provide precise context to AI models while maintaining continuity, the engine uses a **Sliding Window with Overlap** strategy:
1. **Section Splitting**: The document is first split by headers (`##+`).
2. **Context Persistence**: Each chunk is prepended with its structural context (e.g., `H1 Title > Section Heading`) before being embedded.
3. **Sliding Window**: Each section is divided into chunks of ~600 characters with a 100-character overlap. This overlap ensures that semantic meaning is not lost at the boundaries of chunks.
4. **Natural Breaks**: The engine attempts to find natural breaks (periods or newlines) at the end of each window to keep chunks readable.
5. **Filtering**: Chunks shorter than 50 characters are ignored to reduce noise.

## Embedding Model
We use the **Xenova/all-MiniLM-L6-v2** model.
- **Dimensions**: 384
- **Runtime**: Local execution via `@xenova/transformers`.
- **Normalization**: Vectors are normalized to ensure accurate cosine similarity measurements.

## Performance: Parallelism & Indexing
- **Parallel Processing**: Ingestion uses a concurrency-limited parallel strategy to embed and index multiple files/chunks simultaneously, maximizing CPU utilization.
- **Batch Inserts**: Chunks are collected and inserted into the database in bulk, minimizing transaction overhead.
- **HNSW Acceleration**: A Hierarchical Navigable Small World (HNSW) index is automatically applied to the `embedding` column, enabling sub-second search performance even as the document count grows into the tens of thousands.
- **Fast Restart**: On initialization, the engine checks for existing data. If found, auto-indexing is skipped.

## Hybrid Search Mechanism
Search is performed using a multi-signal ranking system:
1. **Semantic Search**: Uses the cosine distance operator `<=>` (provided by `pgvector`) to find conceptual matches.
2. **Full-Text Search**: Uses Postgres `tsvector` and `ts_rank_cd` with a GIN index to find exact keyword matches (e.g., function names, error codes).
3. **Reciprocal Rank Fusion (RRF)**: Results from both vector and keyword searches are combined using the RRF algorithm. This provides a more robust and precise ranking by rewarding documents that appear in both result sets, ensuring that technical specificity and semantic meaning are perfectly balanced.


