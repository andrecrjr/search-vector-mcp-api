# Server Modes

The application supports two distinct operational modes.

## 1. MCP Mode (Default)
This is the default mode, optimized for integration with AI hosts like Claude Desktop or other MCP-compatible clients.

- **Transport**: Standard IO (stdin/stdout).
- **Communication Protocol**: JSON-RPC based Model Context Protocol.
- **Capabilities**: Exposes tools for semantic search (`semantic_markdown_search`) and full document retrieval (`get_full_document`).

### Usage
```bash
bun start
```

## 2. HTTP API Mode
This mode is useful for standalone use or integration with traditional web applications.

- **Transport**: HTTP/TCP.
- **Port**: 4321 (default).
- **Endpoints**: 
    - `POST /search`: Granular conceptual search.
    - `GET /read`: Full raw document retrieval.

### Usage
```bash
bun start --api
```

## Persistence across Modes
Both modes utilize the unified `VectorEngine` database layer. Whether running as an MCP server or an HTTP API, the system will:
1. Detect and connect to the persistent database (Local PGlite or External Postgres).
2. Skip auto-ingestion if data is already present.
3. Provide consistent, granular search results across all interfaces.
