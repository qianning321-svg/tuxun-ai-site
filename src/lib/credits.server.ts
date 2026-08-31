import "@tanstack/react-start/server-only";

import type { D1Database, D1Result } from "./d1";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("创作点不足，请充值后再试。");
    this.name = "InsufficientCreditsError";
  }
}

export class GenerationCreditRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationCreditRecoveryError";
  }
}

type GenerationCreditInput = {
  userId: string;
  taskId: string;
  amount: number;
};

function changedExactlyOne(result: D1Result): boolean {
  const changes = result.meta?.changes;
  return result.success === true && changes === 1;
}

function ledgerId(kind: "deduction" | "refund", taskId: string): string {
  return `${kind}:generation-task:${taskId}`;
}

async function getTaskLedgerState(db: D1Database, taskId: string, userId: string) {
  return db
    .prepare(
      "SELECT status, deduction_ledger_id, refund_ledger_id FROM generation_tasks WHERE id = ? AND user_id = ? LIMIT 1",
    )
    .bind(taskId, userId)
    .first<{ status: string; deduction_ledger_id: string | null; refund_ledger_id: string | null }>();
}

export async function chargeGenerationTask(
  db: D1Database,
  input: GenerationCreditInput,
): Promise<{ ledgerId: string; charged: boolean }> {
  const id = ledgerId("deduction", input.taskId);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE user_credits
         SET balance = balance - ?, total_used = total_used + ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND balance >= ?
           AND EXISTS (
             SELECT 1 FROM generation_tasks
             WHERE id = ? AND user_id = ? AND status = 'queued' AND deduction_ledger_id IS NULL
           )`,
      )
      .bind(input.amount, input.amount, input.userId, input.amount, input.taskId, input.userId),
    db
      .prepare(
        `INSERT INTO credit_ledger (
           id, user_id, amount, balance_after, reason, ref_type, ref_id, note
         )
         SELECT ?, ?, ?, balance, 'generation_deduction', 'generation_task', ?, ?
         FROM user_credits
         WHERE user_id = ? AND changes() = 1`,
      )
      .bind(id, input.userId, -input.amount, input.taskId, "image generation deduction", input.userId),
    db
      .prepare(
        `UPDATE generation_tasks
         SET deduction_ledger_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status = 'queued' AND deduction_ledger_id IS NULL
           AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
      )
      .bind(id, input.taskId, input.userId, id),
  ]);

  if (
    changedExactlyOne(results[0]) &&
    changedExactlyOne(results[1]) &&
    changedExactlyOne(results[2])
  ) {
    return { ledgerId: id, charged: true };
  }

  const task = await getTaskLedgerState(db, input.taskId, input.userId);
  if (task?.deduction_ledger_id === id) return { ledgerId: id, charged: false };
  if (!task || task.status !== "queued" || task.deduction_ledger_id) {
    throw new GenerationCreditRecoveryError("生成任务扣费状态异常，请稍后重试。");
  }
  throw new InsufficientCreditsError();
}

export async function refundGenerationTask(
  db: D1Database,
  input: GenerationCreditInput,
): Promise<{ ledgerId: string; refunded: boolean }> {
  const id = ledgerId("refund", input.taskId);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE user_credits
         SET balance = balance + ?, total_used = MAX(0, total_used - ?), updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?
           AND EXISTS (
             SELECT 1 FROM generation_tasks
             WHERE id = ? AND user_id = ? AND status = 'failed'
               AND deduction_ledger_id IS NOT NULL AND refund_ledger_id IS NULL
           )`,
      )
      .bind(input.amount, input.amount, input.userId, input.taskId, input.userId),
    db
      .prepare(
        `INSERT INTO credit_ledger (
           id, user_id, amount, balance_after, reason, ref_type, ref_id, note
         )
         SELECT ?, ?, ?, balance, 'generation_refund', 'generation_task', ?, ?
         FROM user_credits
         WHERE user_id = ? AND changes() = 1`,
      )
      .bind(id, input.userId, input.amount, input.taskId, "image generation refund", input.userId),
    db
      .prepare(
        `UPDATE generation_tasks
         SET refund_ledger_id = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status = 'failed' AND refund_ledger_id IS NULL
           AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
      )
      .bind(id, input.taskId, input.userId, id),
  ]);

  if (
    changedExactlyOne(results[0]) &&
    changedExactlyOne(results[1]) &&
    changedExactlyOne(results[2])
  ) {
    return { ledgerId: id, refunded: true };
  }

  const task = await getTaskLedgerState(db, input.taskId, input.userId);
  if (task?.refund_ledger_id === id) return { ledgerId: id, refunded: false };
  throw new GenerationCreditRecoveryError("生成任务退款尚未完成，请稍后重试。");
}
