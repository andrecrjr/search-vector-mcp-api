# Project Roadmap & Improvements

This document tracks planned features and enhancements for the `raglike-md` project, prioritized by implementation complexity.

## 🟢 Phase 1: High Impact / Low Complexity (Easiest)

- [ ] **Hierarchical Context Enrichment**
    - [ ] Implement recursive breadcrumb headers (e.g., `H1 > H2 > H3`) for all chunks to improve semantic signal.
    - [ ] Add "Context Slop": Include the last sentence of the previous section and the first sentence of the next section in each chunk to prevent context loss at boundaries.
- [ ] **Neighbor Retrieval Tool**
    - [ ] Implement a `read_chunk_neighbors` MCP tool to allow the AI to fetch context immediately preceding or following a search result.
- [ ] **Security & Path Enforcement**
    - [ ] Implement a strict `BASE_DIR` check to ensure the engine only indexes and serves files from authorized directories.
- [ ] **Enhanced Document Metadata**
    - [ ] Store file modification times in the database to allow "sort by recent" queries.
    - [ ] Add a `word_count` property to chunks to help the search engine prioritize more substantial content.

## 🟡 Phase 2: Medium Complexity

- [ ] **Persistent Vector Store**
    - [ ] Configure PGlite to store the database on disk instead of in-memory.
    - [ ] Implement a startup check to skip indexing if the documentation hasn't changed.
- [ ] **Hybrid Search (Vector + Keyword)**
    - [ ] Add a `tsvector` column to the `markdown_chunks` table.
    - [ ] Implement a weighted search that combines `pgvector` distance with Postgres Full-Text Search scores (Keyword Boosting).
- [ ] **HTML to Markdown Ingestion**
    - [ ] Create a bridge to ingest raw HTML documentation and convert it to clean Markdown for indexing.
- [ ] **Incremental Indexing (File Watching)**
    - [ ] Use `chokidar` to monitor the `docs/` folder.
    - [ ] Automatically update/delete specific chunks in the database when a markdown file is changed or removed.

## 🔴 Phase 3: High Complexity / Long-Term

- [ ] **Semantic Chunking**
    - [ ] Replace header-based splitting with a semantic chunker that groups text by meaning and coherence.
- [ ] **Visual Documentation Support**
    - [ ] Implement "Visual Mode" for PDFs using local VLMs (Vision Language Models) to caption charts, diagrams, and tables.
- [ ] **Contextual Reranking**
    - [ ] Integrate a Cross-Encoder model (e.g., `BGE-Reranker`) to re-score top search results for better precision.
    - [ ] Implement "Query Expansion" where an LLM rephrases the user query into multiple variations before searching.
- [ ] **Agent Skills Bundle**
    - [ ] Package "Agent Skills" (optimized system prompts) that teach LLMs how to formulate queries and interpret results for this specific engine.
- [ ] **Remote Source Syncing**
