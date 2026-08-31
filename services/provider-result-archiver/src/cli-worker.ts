import { processOne, startLoop } from "./archiver.js";

const baseUrl = process.env.MUMO_BASE_URL;
const serviceToken = process.env.MUMO_ARCHIVER_SERVICE_TOKEN_V1;
if (!baseUrl || !serviceToken) throw new Error("MUMO_BASE_URL and MUMO_ARCHIVER_SERVICE_TOKEN_V1 are required");
let stopping = false;
const stop = startLoop(async () => stopping ? false : processOne(baseUrl, serviceToken), 30_000);
let resolveShutdown: (() => void) | undefined;
const shutdown = () => { stopping = true; stop(); resolveShutdown?.(); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
await processOne(baseUrl, serviceToken);
await new Promise<void>((resolve) => { resolveShutdown = resolve; });
