import { parseThumbnailBackfillArgs, runThumbnailBackfill } from "./thumbnail-backfill.js";

const baseUrl = process.env.MUMO_BASE_URL;
const serviceToken = process.env.MUMO_ARCHIVER_SERVICE_TOKEN_V1;
if (!baseUrl || !serviceToken) throw new Error("MUMO_BASE_URL and MUMO_ARCHIVER_SERVICE_TOKEN_V1 are required");

const options = parseThumbnailBackfillArgs(process.argv.slice(2));
const summary = await runThumbnailBackfill(baseUrl, serviceToken, options);
console.log(JSON.stringify(summary));
