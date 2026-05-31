# Search Protocol

`raglike-md` provides two primary interfaces for semantic search and document retrieval.

## 1. Model Context Protocol (MCP)
The preferred interface for AI agents.

### Tools
- **`semantic_markdown_search`**:
    - **Description**: Conceptual search across the workspace.
    - **Input**: `{ "query": string, "limit": number }`
    - **Output**: Returns a formatted list of granular paragraph chunks, including the file path and heading.
- **`get_full_document`**:
    - **Description**: Retrieves the raw markdown content of a file. Use this after finding a relevant file via search.
    - **Input**: `{ "file_path": string }`
    - **Output**: The complete raw content of the Markdown file.

---

## 2. HTTP REST API
A standard interface for web clients and external tools.

### Endpoints

#### `POST /search`
Conceptual search returning granular results.
- **Payload**:
  ```json
  { "query": "database persistence", "limit": 3 }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "results": [
      {
        "file_path": "docs/architecture/vector-engine.md",
        "heading": "## Persistence",
        "content": "Local PGlite data is saved in the .db directory...",
        "distance": 0.4215
      }
    ]
  }
  ```

#### `GET /read`
Full document retrieval.
- **Query Parameters**: `path` (relative path to the markdown file).
- **Example**: `/read?path=docs/setup.md`
- **Response**:
  ```json
  {
    "success": true,
    "content": "# Full Markdown Content..."
  }
  ```
