import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { initDatabase } from "./db.js";
import { createBot, sendMessage } from "./bot.js";
import { runDecaySweep } from "./memory.js";
import { initScheduler, stopScheduler } from "./scheduler.js";
import { cleanupOldUploads } from "./media.js";
import { logger } from "./logger.js";
import { PROJECT_ROOT, STORE_DIR, TELEGRAM_BOT_TOKEN } from "./config.js";

// ── Banner ────────────────────────────────────────────────────────────────────

function showBanner(): void {
  try {
    const banner = readFileSync(path.join(PROJECT_ROOT, "banner.txt"), "utf-8");
    console.log(banner);
  } catch {
    console.log("ClaudeClaw — Starting up...");
  }
}

// ── PID lock ──────────────────────────────────────────────────────────────────

const PID_FILE = path.join(STORE_DIR, "claudeclaw.pid");

function acquireLock(): void {
  mkdirSync(STORE_DIR, { recursive: true });
  if (existsSync(PID_FILE)) {
    const rawPid = readFileSync(PID_FILE, "utf-8").trim();
    const oldPid = parseInt(rawPid, 10);
    if (!isNaN(oldPid)) {
      try {
        process.kill(oldPid, 0); // Check if process exists
        logger.info({ oldPid }, "Killing existing ClaudeClaw process");
        process.kill(oldPid, "SIGTERM");
      } catch {
        // Process doesn't exist — stale PID file
      }
    }
  }
  writeFileSync(PID_FILE, String(process.pid), "utf-8");
  logger.debug({ pid: process.pid }, "PID lock acquired");
}

function releaseLock(): void {
  try {
    if (existsSync(PID_FILE)) {
      const stored = readFileSync(PID_FILE, "utf-8").trim();
      if (stored === String(process.pid)) {
        unlinkSync(PID_FILE);
      }
    }
  } catch {
    // ignore
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  showBanner();

  if (!TELEGRAM_BOT_TOKEN) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN not set.");
    console.error("Run `npm run setup` to configure, or set it in .env");
    process.exit(1);
  }

  acquireLock();

  // Initialize database
  initDatabase();
  logger.info("Database initialized");

  // Run memory decay sweep (and schedule daily)
  runDecaySweep();
  setInterval(runDecaySweep, 24 * 60 * 60 * 1000);

  // Cleanup old uploads
  cleanupOldUploads();

  // Create bot
  let bot: Awaited<ReturnType<typeof createBot>>;
  try {
    bot = createBot();
  } catch (err) {
    logger.error({ err }, "Failed to create bot");
    process.exit(1);
  }

  // Initialize scheduler
  const sender = (chatId: string, text: string) =>
    sendMessage(bot, chatId, text);
  initScheduler(sender);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    stopScheduler();
    try {
      await bot.stop();
    } catch {
      // ignore
    }
    // releaseLock handled by unlinkSync inline to avoid require() in ESM
    try {
      if (existsSync(PID_FILE)) {
        const { unlinkSync } = await import("fs");
        unlinkSync(PID_FILE);
      }
    } catch {
      // ignore
    }
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Start the bot
  logger.info("ClaudeClaw starting...");
  try {
    await bot.start({
      onStart: (info) => {
        logger.info({ botUsername: info.username }, "ClaudeClaw running");
        console.log(`\nClaudeClaw is running as @${info.username}`);
        console.log("Send a message on Telegram to start.\n");
      },
    });
  } catch (err) {
    logger.error({ err }, "Bot start error");
    if (String(err).includes("401")) {
      console.error("\nInvalid TELEGRAM_BOT_TOKEN. Check your .env file.");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, "Fatal error");
  process.exit(1);
});
