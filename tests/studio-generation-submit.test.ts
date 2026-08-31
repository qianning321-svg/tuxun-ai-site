import { describe, expect, test } from "bun:test";

import {
  createGenerationSubmissionFingerprint,
  GenerationSubmitGuard,
  submitStudioGeneration,
} from "../src/components/studio/generation-submit-guard";

const fingerprint = (prompt = "first prompt", referenceImageIds: string[] = []) =>
  createGenerationSubmissionFingerprint({
    modelKey: "model-a",
    prompt,
    aspectRatio: "1:1",
    quality: "1K",
    referenceImageIds,
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Studio generation submission guard", () => {
  test("the Studio submission helper suppresses synchronous double and triple submits", async () => {
    const guard = new GenerationSubmitGuard();
    const pending = deferred<{ taskId: string; status: string }>();
    let createCalls = 0;
    let uuidCalls = 0;
    const submit = () => submitStudioGeneration({
      guard,
      fingerprint: fingerprint(),
      createKey: () => {
        uuidCalls += 1;
        return `key-${uuidCalls}`;
      },
      createTask: async () => {
        createCalls += 1;
        return pending.promise;
      },
    });

    const first = submit();
    const second = submit();
    const third = submit();
    expect(createCalls).toBe(1);
    expect(uuidCalls).toBe(1);
    await expect(second).resolves.toBeNull();
    await expect(third).resolves.toBeNull();

    pending.resolve({ taskId: "internal-task", status: "running" });
    await expect(first).resolves.toMatchObject({ status: "running" });
    await expect(submit()).resolves.toBeNull();
  });

  test("retains an uncertain network failure key for the same submission retry", async () => {
    const guard = new GenerationSubmitGuard();
    const keys: string[] = [];
    let uuidCalls = 0;
    const submit = () => submitStudioGeneration({
      guard,
      fingerprint: fingerprint(),
      createKey: () => `key-${++uuidCalls}`,
      createTask: async (key) => {
        keys.push(key);
        if (keys.length === 1) throw new Error("network unavailable");
        return { taskId: "internal-task", status: "failed" };
      },
    });

    await expect(submit()).rejects.toThrow("network unavailable");
    await expect(submit()).resolves.toMatchObject({ status: "failed" });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(uuidCalls).toBe(1);
  });

  test("rotates the pending key when the request fingerprint changes", async () => {
    const guard = new GenerationSubmitGuard();
    const keys: string[] = [];
    let uuidCalls = 0;
    const submit = (value: string) => submitStudioGeneration({
      guard,
      fingerprint: fingerprint(value, ["asset-a"]),
      createKey: () => `key-${++uuidCalls}`,
      createTask: async (key) => {
        keys.push(key);
        if (keys.length === 1) throw new Error("network unavailable");
        return { taskId: "internal-task", status: "failed" };
      },
    });

    await expect(submit("first prompt")).rejects.toThrow("network unavailable");
    await expect(submit("changed prompt")).resolves.toMatchObject({ status: "failed" });
    expect(keys[1]).not.toBe(keys[0]);
    expect(uuidCalls).toBe(2);
  });

  test("releases after a definitive business failure and validation abort", async () => {
    const guard = new GenerationSubmitGuard();
    let createCalls = 0;
    const submit = () => submitStudioGeneration({
      guard,
      fingerprint: fingerprint(),
      createKey: () => "key",
      createTask: async () => {
        createCalls += 1;
        const error = Object.assign(new Error("invalid request"), { code: "INVALID_REQUEST" });
        throw error;
      },
    });

    await expect(submit()).rejects.toThrow("invalid request");
    await expect(submit()).rejects.toThrow("invalid request");
    expect(createCalls).toBe(2);

    guard.releaseForValidationFailure();
    await expect(submit()).rejects.toThrow("invalid request");
    expect(createCalls).toBe(3);
  });

  test("releases the active lock only when the tracked task reaches a terminal poll result", async () => {
    const guard = new GenerationSubmitGuard();
    let createCalls = 0;
    const submit = () => submitStudioGeneration({
      guard,
      fingerprint: fingerprint(),
      createKey: () => "key",
      createTask: async () => {
        createCalls += 1;
        return { taskId: "internal-task", status: "running" };
      },
    });

    await submit();
    await expect(submit()).resolves.toBeNull();
    guard.completeTask("different-task");
    await expect(submit()).resolves.toBeNull();
    guard.completeTask("internal-task");
    await expect(submit()).resolves.toMatchObject({ status: "running" });
    expect(createCalls).toBe(2);
  });
});
