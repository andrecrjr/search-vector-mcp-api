import pino from "pino";
import * as fs from "fs";
import * as path from "path";

const logDir = path.join(process.cwd(), ".logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = pino({
  level: "info", // Prevents verbose debug/trace processing overhead
  base: undefined, // Strips standard pid/hostname attributes to save disk space & IO time
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.destination(path.join(logDir, "app.log")));
