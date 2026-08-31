import { describe, expect, test } from "bun:test";

import { AdminProviderDiagnosticError } from "../src/lib/admin.server";
import { handleProviderTaskDiagnosticRequest } from "../src/routes/api/admin/provider-task-diagnostic";
import type { ProviderTaskDiagnostic } from "../src/lib/providers/vibelearning-image.server";

const TASK_ID = "5c67c57e-098f-49a0-9a5f-c7f82677ecc5";
const diagnostic: ProviderTaskDiagnostic = {
  generationTaskId: TASK_ID,
  provider: "vibelearning",
  providerTaskIdPresent: true,
  generationMode: "text-to-image",
  httpStatus: 200,
  responseIsJson: true,
  topLevelKeys: ["data", "status"],
  topStatus: "completed",
  topState: null,
  topCode: null,
  dataType: "array",
  dataKeys: [],
  dataCount: 1,
  dataStatus: null,
  dataState: null,
  nestedDataType: "null",
  nestedDataKeys: [],
  nestedDataCount: null,
  resultType: "null",
  resultKeys: [],
  resultStatus: null,
  resultState: null,
  resultDataType: "null",
  resultDataKeys: [],
  resultDataCount: null,
  responseType: "null",
  responseKeys: [],
  responseCount: null,
  responseStatus: null,
  responseState: null,
  responseItemType: "null",
  responseItemKeys: [],
  responseDataType: "null",
  responseDataKeys: [],
  responseDataCount: null,
  responseDataItemType: "null",
  responseDataItemKeys: [],
  responseDataItemUrlType: "null",
  responseDataItemUrlIsHttps: false,
  responseDataItemB64Type: "null",
  responseDataItemB64Length: null,
  responseDataItemB64HasDataUrlPrefix: false,
  responseDataItemB64HasWhitespace: false,
  responseDataItemB64LengthMod4: null,
  responseDataItemB64AlphabetValid: false,
  responseDataItemB64PaddingValid: false,
  responseDataItemB64DecodedPrefixValid: false,
  responseDataItemDetectedImageType: null,
  responseDataItemMagicValid: false,
  responseDataItemLikelyTruncated: false,
  responseOutputType: "null",
  responseOutputKeys: [],
  responseOutputCount: null,
  knownResultFlags: {
    topUrl: false, topB64Json: false, dataUrl: true, dataB64Json: false,
    dataDataUrl: false, dataDataB64Json: false, resultUrl: false, resultB64Json: false,
    resultDataUrl: false, resultDataB64Json: false,
    responseUrl: false, responseB64Json: false, responseImageUrl: false, responseOutputUrl: false,
    responseItemUrl: false, responseItemB64Json: false, responseItemImageUrl: false, responseItemOutputUrl: false,
    responseDataUrl: false, responseDataB64Json: false, responseDataImageUrl: false, responseDataOutputUrl: false,
    responseOutputB64Json: false, responseOutputImageUrl: false,
  },
  normalizedStatus: "completed",
  normalizationErrorCode: null,
};

function request(query = `generationTaskId=${TASK_ID}`) {
  return new Request(`https://mumo.test/api/admin/provider-task-diagnostic?${query}`);
}

describe("provider task diagnostic route", () => {
  test("denies unauthenticated and ordinary users before querying a provider", async () => {
    let calls = 0;
    const forbidden = async () => {
      calls += 1;
      throw new Error("not admin");
    };
    const unauthenticated = await handleProviderTaskDiagnosticRequest(request(), {
      getSession: async () => null,
      diagnose: forbidden,
    });
    const ordinaryUser = await handleProviderTaskDiagnosticRequest(request(), {
      getSession: async () => ({ user: { id: "user-1" } } as never),
      diagnose: forbidden,
    });

    expect(unauthenticated.status).toBe(401);
    expect(ordinaryUser.status).toBe(403);
    expect(calls).toBe(1);
  });

  test("validates the internal task ID and rejects provider or credential query parameters", async () => {
    const dependencies = {
      getSession: async () => ({ user: { id: "admin-1" } } as never),
      diagnose: async () => diagnostic,
    };
    for (const query of ["", "generationTaskId=bad", `generationTaskId=${TASK_ID}&providerTaskId=task`, `generationTaskId=${TASK_ID}&apiKey=x`, `generationTaskId=${TASK_ID}&baseUrl=https://x`]) {
      const response = await handleProviderTaskDiagnosticRequest(request(query), dependencies);
      expect(response.status).toBe(400);
    }
  });

  test("returns only the diagnostic summary with no-store and safe errors", async () => {
    const response = await handleProviderTaskDiagnosticRequest(request(), {
      getSession: async () => ({ user: { id: "admin-1" } } as never),
      diagnose: async () => diagnostic,
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain('"topLevelKeys"');
    expect(body).not.toContain("https://");
    expect(body).not.toContain("Authorization");
    expect(body).not.toContain("api_key_ciphertext");
    expect(body).not.toContain("api_key_iv");
    expect(body).not.toContain("MUMO_PROVIDER_CREDENTIALS_MASTER_KEY");

    const missing = await handleProviderTaskDiagnosticRequest(request(), {
      getSession: async () => ({ user: { id: "admin-1" } } as never),
      diagnose: async () => { throw new AdminProviderDiagnosticError("GENERATION_TASK_NOT_FOUND"); },
    });
    expect(missing.status).toBe(404);
  });
});
