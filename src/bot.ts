import { Bot, Context, InputFile } from "grammy";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  TELEGRAM_BOT_TOKEN,
  ALLOWED_CHAT_IDS,
  MAX_MESSAGE_LENGTH,
  TYPING_REFRESH_MS,
  GROQ_API_KEY,
  ELEVENLABS_API_KEY,
  MULTIUSER,
} from "./config.js";
import {
  getSession,
  setSession,
  clearSession,
  getMemoriesForChat,
  getAllTasks,
  createTask,
  deleteTask,
  setTaskStatus,
} from "./db.js";
import { runAgent } from "./agent.js";
import { buildMemoryContext, saveConversationTurn } from "./memory.js";
import {
  transcribeAudio,
  synthesizeSpeech,
  voiceCapabilities,
} from "./voice.js";
import {
  downloadMedia,
  buildPhotoMessage,
  buildDocumentMessage,
  buildVideoMessage,
  UPLOADS_DIR,
} from "./media.js";
import { computeNextRun } from "./scheduler.js";
import { logger } from "./logger.js";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const voiceModeChats = new Set<string>();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function isAuthorised(chatId: number | string): boolean {
  if (ALLOWED_CHAT_IDS.length === 0) return true;
  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatForTelegram(text: string): string {
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Extract fenced code blocks
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.length;
    const lang = match.match(/^```(\w+)?/)?.[1] ?? "";
    const content = match.replace(/^```\w*\n?/, "").replace(/```$/, "");
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    codeBlocks.push(
      `<pre${lang ? ` language="${lang}"` : ""}><code>${escaped}</code></pre>`,
    );
    return `\x00CODE${idx}\x00`;
  });

  // Extract inline code
  result = result.replace(/`[^`]+`/g, (match) => {
    const idx = inlineCodes.length;
    const content = match.slice(1, -1);
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    inlineCodes.push(`<code>${escaped}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // Escape HTML entities in remaining text
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headings: # Heading or ## Heading etc.
  result = result.replace(
    /^#{1,6}\s+(.+)$/gm,
    (_, heading) => `<b>${heading}</b>`,
  );

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* (not preceded/followed by *)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Checkboxes
  result = result.replace(/^- \[ \]/gm, "☐");
  result = result.replace(/^- \[x\]/gim, "☑");

  // Strip horizontal rules
  result = result.replace(/^---+$/gm, "");
  result = result.replace(/^\*\*\*+$/gm, "");

  // Restore inline codes
  result = result.replace(
    /\x00INLINE(\d+)\x00/g,
    (_, i) => inlineCodes[Number(i)],
  );

  // Restore code blocks
  result = result.replace(
    /\x00CODE(\d+)\x00/g,
    (_, i) => codeBlocks[Number(i)],
  );

  return result.trim();
}

// ---------------------------------------------------------------------------
// Message splitting
// ---------------------------------------------------------------------------

export function splitMessage(
  text: string,
  limit = MAX_MESSAGE_LENGTH,
): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    // Line itself exceeds limit -- hard split
    if (line.length > limit) {
      if (current.length > 0) {
        chunks.push(current);
        current = "";
      }
      let remaining = line;
      while (remaining.length > limit) {
        chunks.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit);
      }
      current = remaining;
      continue;
    }

    const candidate = current.length === 0 ? line : current + "\n" + line;

    if (candidate.length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) chunks.push(current);

  return chunks;
}

// ---------------------------------------------------------------------------
// Commands helpers
// ---------------------------------------------------------------------------

const COMMANDS_LIST = `Commands:
/start -- greeting
/help -- show this list
/chatid -- show your chat ID
/newchat or /forget -- clear session
/memory -- show saved memories
/voice -- toggle voice replies
/schedule list -- list scheduled tasks
/schedule create <cron> <prompt...> -- schedule a task
/schedule delete <id> -- delete a task
/schedule pause <id> -- pause a task
/schedule resume <id> -- resume a task`;

// ---------------------------------------------------------------------------
// handleMessage
// ---------------------------------------------------------------------------

export async function handleMessage(
  ctx: Context,
  rawText: string,
  forceVoiceReply = false,
): Promise<void> {
  const chatId = String(ctx.chat?.id ?? "");

  if (!isAuthorised(chatId)) {
    await ctx.reply("Not authorised.");
    return;
  }

  const memoryContext = await buildMemoryContext(chatId, rawText);
  const fullMessage = memoryContext
    ? `${memoryContext}\n\n${rawText}`
    : rawText;

  const existingSessionId = getSession(chatId);

  let typingInterval: ReturnType<typeof setInterval> | null = null;

  const sendTyping = async () => {
    try {
      await ctx.api.sendChatAction(Number(chatId), "typing");
    } catch {
      // ignore
    }
  };

  await sendTyping();
  typingInterval = setInterval(() => {
    sendTyping().catch(() => {});
  }, TYPING_REFRESH_MS);

  let resultText: string;
  let newSessionId: string | undefined;

  try {
    const agentResult = await runAgent(
      fullMessage,
      existingSessionId ?? undefined,
      sendTyping,
    );
    resultText = agentResult.text ?? "";
    newSessionId = agentResult.newSessionId;
  } finally {
    if (typingInterval !== null) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  }

  if (newSessionId && newSessionId !== existingSessionId) {
    setSession(chatId, newSessionId);
  }

  await saveConversationTurn(chatId, rawText, resultText);

  const ttsAvailable = voiceCapabilities().tts;
  const useVoice =
    ttsAvailable && (forceVoiceReply || voiceModeChats.has(chatId));

  if (useVoice) {
    try {
      const audioBuffer = await synthesizeSpeech(resultText);
      const tmpPath = path.join(UPLOADS_DIR, `voice_${Date.now()}.ogg`);
      writeFileSync(tmpPath, audioBuffer);
      await ctx.replyWithAudio(new InputFile(tmpPath));
      return;
    } catch (err) {
      logger.warn({ err }, "TTS failed, falling back to text");
    }
  }

  const formatted = formatForTelegram(resultText);
  const chunks = splitMessage(formatted);

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    } catch {
      await ctx.reply(chunk);
    }
  }
}

// ---------------------------------------------------------------------------
// sendMessage (used by scheduler)
// ---------------------------------------------------------------------------

export async function sendMessage(
  bot: Bot,
  chatId: string,
  text: string,
): Promise<void> {
  const formatted = formatForTelegram(text);
  const chunks = splitMessage(formatted);

  for (const chunk of chunks) {
    try {
      await bot.api.sendMessage(Number(chatId), chunk, { parse_mode: "HTML" });
    } catch {
      try {
        await bot.api.sendMessage(Number(chatId), chunk);
      } catch (err) {
        logger.error({ err, chatId }, "Failed to send message");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// createBot
// ---------------------------------------------------------------------------

export function createBot(): Bot {
  const bot = new Bot(TELEGRAM_BOT_TOKEN);

  // /start
  bot.command("start", async (ctx) => {
    await ctx.reply(`Hey. I'm your personal AI assistant.\n\n${COMMANDS_LIST}`);
  });

  // /help
  bot.command("help", async (ctx) => {
    await ctx.reply(COMMANDS_LIST);
  });

  // /chatid
  bot.command("chatid", async (ctx) => {
    await ctx.reply(`Your chat ID: ${ctx.chat?.id}`);
  });

  // /newchat, /forget
  bot.command(["newchat", "forget"], async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    clearSession(chatId);
    await ctx.reply("Session cleared.");
  });

  // /memory
  bot.command("memory", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    const memories = getMemoriesForChat(chatId, 10);

    if (memories.length === 0) {
      await ctx.reply("No memories saved yet.");
      return;
    }

    const lines = memories.map((m, i) => {
      const date = new Date(m.accessed_at).toLocaleDateString();
      return `${i + 1}. [${m.sector}] ${m.content.slice(0, 120)} (${date})`;
    });

    await ctx.reply(lines.join("\n\n"));
  });

  // /voice
  bot.command("voice", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    if (!voiceCapabilities().tts) {
      await ctx.reply(
        "Voice not available (no ElevenLabs API key configured).",
      );
      return;
    }

    if (voiceModeChats.has(chatId)) {
      voiceModeChats.delete(chatId);
      await ctx.reply("Voice mode off.");
    } else {
      voiceModeChats.add(chatId);
      await ctx.reply("Voice mode on.");
    }
  });

  // /schedule
  bot.command("schedule", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/).slice(1); // drop /schedule
    const sub = parts[0];

    if (!sub || sub === "list") {
      const tasks = getAllTasks(chatId);

      if (tasks.length === 0) {
        await ctx.reply("No scheduled tasks.");
        return;
      }

      const lines = tasks.map((t) => {
        const next = t.next_run
          ? new Date(t.next_run * 1000).toLocaleString()
          : "n/a";
        return `ID: ${t.id.slice(0, 8)}\nPrompt: ${t.prompt.slice(0, 60)}\nCron: ${t.schedule}\nStatus: ${t.status}\nNext: ${next}`;
      });

      await ctx.reply(lines.join("\n\n---\n\n"));
      return;
    }

    if (sub === "create") {
      // /schedule create <cron_field1> <cron_field2> <cron_field3> <cron_field4> <cron_field5> <prompt...>
      // We expect: cron is 5 space-separated fields, then rest is prompt
      // parts[1..5] = cron fields, parts[6..] = prompt
      if (parts.length < 7) {
        await ctx.reply(
          "Usage: /schedule create <cron 5-fields> <prompt...>\nExample: /schedule create 0 9 * * * Good morning briefing",
        );
        return;
      }

      const cronFields = parts.slice(1, 6).join(" ");
      const prompt = parts.slice(6).join(" ");

      try {
        const { parseExpression } = await import("cron-parser");
        parseExpression(cronFields);
      } catch {
        await ctx.reply(`Invalid cron expression: "${cronFields}"`);
        return;
      }

      const id = randomUUID();
      const nextRun = computeNextRun(cronFields);
      const now = Math.floor(Date.now() / 1000);

      createTask({
        id,
        chat_id: chatId,
        prompt,
        schedule: cronFields,
        next_run: nextRun,
        status: "active",
        created_at: now,
      });

      const next = new Date(nextRun * 1000).toLocaleString();
      await ctx.reply(`Task created: ${id.slice(0, 8)}\nNext run: ${next}`);
      return;
    }

    if (sub === "delete") {
      const id = parts[1];
      if (!id) {
        await ctx.reply("Usage: /schedule delete <id>");
        return;
      }
      deleteTask(id);
      await ctx.reply(`Deleted: ${id}`);
      return;
    }

    if (sub === "pause") {
      const id = parts[1];
      if (!id) {
        await ctx.reply("Usage: /schedule pause <id>");
        return;
      }
      setTaskStatus(id, "paused");
      await ctx.reply(`Paused: ${id}`);
      return;
    }

    if (sub === "resume") {
      const id = parts[1];
      if (!id) {
        await ctx.reply("Usage: /schedule resume <id>");
        return;
      }
      setTaskStatus(id, "active");
      await ctx.reply(`Resumed: ${id}`);
      return;
    }

    await ctx.reply("Unknown schedule command. Try /schedule list.");
  });

  // Text messages
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // already handled by command handlers
    await handleMessage(ctx, text);
  });

  // Voice messages
  bot.on("message:voice", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    if (!voiceCapabilities().stt) {
      await ctx.reply("Voice transcription not available.");
      return;
    }

    try {
      const fileId = ctx.message.voice.file_id;
      const ogaPath = await downloadMedia(fileId, "voice.oga");
      const oggPath = ogaPath.replace(/\.oga$/, ".ogg");

      const { renameSync } = await import("fs");
      renameSync(ogaPath, oggPath);

      const transcription = await transcribeAudio(oggPath);
      const prefixed = `[Voice transcribed]: ${transcription}`;

      await handleMessage(ctx, prefixed, true);
    } catch (err) {
      logger.error({ err }, "Voice message handling failed");
      await ctx.reply("Failed to process voice message.");
    }
  });

  // Photo messages
  bot.on("message:photo", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      const localPath = await downloadMedia(largest.file_id, "photo.jpg");
      const caption = ctx.message.caption ?? "";
      const messageText = buildPhotoMessage(localPath, caption);
      await handleMessage(ctx, messageText);
    } catch (err) {
      logger.error({ err }, "Photo handling failed");
      await ctx.reply("Failed to process photo.");
    }
  });

  // Document messages
  bot.on("message:document", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    try {
      const doc = ctx.message.document;
      const localPath = await downloadMedia(
        doc.file_id,
        doc.file_name ?? "document",
      );
      const caption = ctx.message.caption ?? "";
      const messageText = buildDocumentMessage(
        localPath,
        doc.file_name ?? "document",
        caption,
      );
      await handleMessage(ctx, messageText);
    } catch (err) {
      logger.error({ err }, "Document handling failed");
      await ctx.reply("Failed to process document.");
    }
  });

  // Video messages
  bot.on("message:video", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");

    if (!isAuthorised(chatId)) {
      await ctx.reply("Not authorised.");
      return;
    }

    try {
      const video = ctx.message.video;
      const localPath = await downloadMedia(video.file_id, "video.mp4");
      const caption = ctx.message.caption ?? "";
      const messageText = buildVideoMessage(localPath, caption);
      await handleMessage(ctx, messageText);
    } catch (err) {
      logger.error({ err }, "Video handling failed");
      await ctx.reply("Failed to process video.");
    }
  });

  return bot;
}
