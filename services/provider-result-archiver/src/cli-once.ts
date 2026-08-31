import { processOne } from "./archiver.js";

const baseUrl = process.env.MUMO_BASE_URL;
const serviceToken = process.env.MUMO_ARCHIVER_SERVICE_TOKEN_V1;
if (!baseUrl || !serviceToken) throw new Error("MUMO_BASE_URL and MUMO_ARCHIVER_SERVICE_TOKEN_V1 are required");
await processOne(baseUrl, serviceToken);
