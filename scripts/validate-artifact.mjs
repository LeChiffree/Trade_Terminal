import { access, readFile } from "node:fs/promises";

const workerPath = new URL("../dist/server/index.js", import.meta.url);
const hostingPath = new URL("../dist/.openai/hosting.json", import.meta.url);

await Promise.all([access(workerPath), access(hostingPath)]);
JSON.parse(await readFile(hostingPath, "utf8"));

workerPath.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerPath.href);

if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error(
    "dist/server/index.js must have an ESM default export with fetch(request, env, ctx)",
  );
}

console.log("Validated deployable Worker artifact.");
