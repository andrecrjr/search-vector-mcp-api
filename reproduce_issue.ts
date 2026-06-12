import { VectorEngine } from "./src/engine";
import * as fs from "node:fs";
import * as path from "node:path";

async function testUpload() {
    const engine = new VectorEngine("./test_db");
    await engine.initialize();

    const testFile = path.join(process.cwd(), "test_upload.md");
    fs.writeFileSync(testFile, "# Test Heading\nThis is a test content for indexing.");

    console.log("Indexing single file...");
    await engine.indexSingleFile(testFile);

    console.log("Searching for content...");
    const results = await engine.search("test content", 5);

    console.log("Results found:", results.length);
    if (results.length > 0) {
        console.log("First result heading:", results[0].heading);
        console.log("First result content:", results[0].content);
    } else {
        console.log("FAILED: No results found after indexing.");
    }

    await engine.destroy();
    fs.unlinkSync(testFile);
    // fs.rmSync("./test_db", { recursive: true, force: true });
}

testUpload().catch(console.error);
