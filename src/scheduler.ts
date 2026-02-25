import { parseExpression } from "cron-parser";
import {
  getDueTasks,
  updateTaskAfterRun,
  getAllTasks,
  ScheduledTask,
} from "./db.js";
import { runAgent } from "./agent.js";
import { logger } from "./logger.js";

export type Sender = (chatId: string, text: string) => Promise<void>;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function computeNextRun(cronExpr: string): number {
  return Math.floor(parseExpression(cronExpr).next().getTime() / 1000);
}

export async function runDueTasks(send: Sender): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const tasks = getDueTasks(now);

  for (const task of tasks) {
    logger.info(
      { taskId: task.id, chatId: task.chat_id },
      "Running scheduled task",
    );

    try {
      await send(task.chat_id, `Running: "${task.prompt.slice(0, 80)}..."`);

      const agentResult = await runAgent(task.prompt);
      const resultText = agentResult.text ?? "";

      await send(task.chat_id, resultText);

      const lastRun = Math.floor(Date.now() / 1000);
      const nextRun = computeNextRun(task.schedule);

      updateTaskAfterRun(task.id, lastRun, nextRun, resultText.slice(0, 500));

      logger.info({ taskId: task.id, nextRun }, "Scheduled task completed");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ taskId: task.id, err: errMsg }, "Scheduled task failed");

      try {
        await send(task.chat_id, `Task failed: ${errMsg}`);
      } catch {
        // best effort
      }

      const lastRun = Math.floor(Date.now() / 1000);
      const nextRun = computeNextRun(task.schedule);
      updateTaskAfterRun(task.id, lastRun, nextRun, `ERROR: ${errMsg}`);
    }
  }
}

export function initScheduler(send: Sender): void {
  intervalHandle = setInterval(() => {
    runDueTasks(send).catch((err) => {
      logger.error({ err }, "runDueTasks error");
    });
  }, 60_000);

  logger.info("Scheduler started (60s poll)");
}

export function stopScheduler(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info("Scheduler stopped");
  }
}
