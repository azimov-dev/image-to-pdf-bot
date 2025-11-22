// src/index.js
require("dotenv").config();
const fs = require("fs");
const { Telegraf, Markup } = require("telegraf");
const { recordMessage, getStats, statsPath } = require("./stats");
const { imagesToPdf } = require("./converter");
const { buildFileUrl, downloadTelegramFileToBuffer } = require("./telegram");
const { resolveLang, getText, format, DEFAULT_LANG } = require("./i18n");
const { mergePdfs } = require("./pdfTools");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = 756814955; // your Telegram ID

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is not set in .env");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ------- GLOBAL STATS MIDDLEWARE (counts all usage) -------
bot.use(async (ctx, next) => {
  try {
    if (ctx.from) {
      recordMessage(ctx.from);
    }
  } catch (e) {
    console.error("Failed to record stats:", e);
  }
  return next();
});

// in-memory sessions: chatId -> session
const sessions = new Map();

// session TTL and rate limit
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // operations per chat per window

function now() {
  return Date.now();
}

function initSession(chatId, languageCodeFromUser) {
  const resolvedLang = resolveLang(languageCodeFromUser);
  const session = {
    images: [], // { id, buffer, rotationDeg }
    pdfFiles: [], // { id, buffer }
    nextId: 1,
    nextPdfId: 1,
    lang: resolvedLang,
    pdfName: "converted.pdf",
    quality: "high", // high|standard|light
    pageSize: "auto", // auto|a4p|a4l|square
    background: "white", // white|black|transparent
    lastActivity: now(),
    rate: { windowStart: now(), count: 0 },
  };
  sessions.set(chatId, session);
  return session;
}

function getSession(chatId, languageCodeFromUser) {
  let session = sessions.get(chatId);
  const t = now();

  // TTL
  if (session && t - session.lastActivity > SESSION_TTL) {
    sessions.delete(chatId);
    session = null;
  }

  if (!session) {
    session = initSession(chatId, languageCodeFromUser);
  }

  session.lastActivity = t;

  // simple rate limiting
  const rate = session.rate;
  if (t - rate.windowStart > RATE_LIMIT_WINDOW) {
    rate.windowStart = t;
    rate.count = 0;
  }
  rate.count++;
  if (rate.count > RATE_LIMIT_MAX) {
    throw new Error("RATE_LIMIT");
  }

  return session;
}

function getLangForChat(chatId) {
  const session = sessions.get(chatId);
  return session?.lang || DEFAULT_LANG;
}

function setLangForChat(chatId, lang) {
  let session = sessions.get(chatId);
  if (!session) {
    session = initSession(chatId, null);
  }
  session.lang = lang;
}

/**
 * /start – show language selection buttons
 */
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  const userLangCode = ctx.from?.language_code;

  let session = sessions.get(chatId);

  // first time: create session and show language buttons
  if (!session) {
    session = initSession(chatId, userLangCode);

    return ctx.reply(
      "Choose your language / Tilni tanlang / Выбери язык:",
      Markup.inlineKeyboard([
        [Markup.button.callback("English 🇺🇸", "lang_en")],
        [Markup.button.callback("O'zbek 🇺🇿", "lang_uz")],
        [Markup.button.callback("Русский 🇷🇺", "lang_ru")],
      ]),
    );
  }

  // not first time: just show start text in already chosen language
  const lang = session.lang || DEFAULT_LANG;
  return ctx.reply(getText(lang, "start"));
});

/**
 * Language buttons
 */
bot.action("lang_en", async (ctx) => {
  const chatId = ctx.chat.id;
  setLangForChat(chatId, "en");
  await ctx.answerCbQuery();
  await ctx.editMessageText(getText("en", "start"));
});

bot.action("lang_uz", async (ctx) => {
  const chatId = ctx.chat.id;
  setLangForChat(chatId, "uz");
  await ctx.answerCbQuery();
  await ctx.editMessageText(getText("uz", "start"));
});

bot.action("lang_ru", async (ctx) => {
  const chatId = ctx.chat.id;
  setLangForChat(chatId, "ru");
  await ctx.answerCbQuery();
  await ctx.editMessageText(getText("ru", "start"));
});

/**
 * /cancel – clear everything
 */
bot.command("cancel", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  sessions.delete(chatId);
  ctx.reply(
    getText(lang, "cleared") || "Session cleared. You can start again.",
  );
});

/**
 * /list – list images with order + rotation
 */
bot.command("list", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const lines = session.images.map((img, index) => {
    const position = index + 1;
    const rot = img.rotationDeg || 0;
    return `${position}. image #${img.id} (rotate: ${rot}°)`;
  });

  ctx.reply(
    [
      getText(lang, "listHeader") || "Current image order:",
      ...lines,
      "",
      getText(lang, "listFooter") || "Use /swap a b to change positions.",
    ].join("\n"),
  );
});

/**
 * /swap a b – swap two positions
 */
bot.command("swap", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const text = ctx.message.text || "";
  const parts = text.trim().split(/\s+/);

  if (parts.length < 3) {
    return ctx.reply(getText(lang, "usageSwap") || "Usage: /swap a b");
  }

  const a = parseInt(parts[1], 10);
  const b = parseInt(parts[2], 10);

  if (
    Number.isNaN(a) ||
    Number.isNaN(b) ||
    a < 1 ||
    b < 1 ||
    a > session.images.length ||
    b > session.images.length
  ) {
    const msg =
      getText(lang, "invalidPositions") ||
      `Invalid positions. You currently have ${session.images.length} image(s).`;
    return ctx.reply(
      format(msg, { count: session.images.length }) ||
        `Invalid positions. You have ${session.images.length} images.`,
    );
  }

  if (a === b) {
    return ctx.reply(
      getText(lang, "samePositions") ||
        "Positions are the same, nothing to swap.",
    );
  }

  const i = a - 1;
  const j = b - 1;

  const images = session.images;
  const temp = images[i];
  images[i] = images[j];
  images[j] = temp;

  const msg =
    getText(lang, "swapSuccess") ||
    `Swapped positions ${a} and ${b}. Use /list to check the new order.`;
  ctx.reply(format(msg, { a, b }) || msg);
});

/**
 * /remove n – delete image at position n
 */
bot.command("remove", (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply("No images to remove.");
  }

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /remove n  (example: /remove 2)");
  }

  const n = parseInt(parts[1], 10);
  if (Number.isNaN(n) || n < 1 || n > session.images.length) {
    return ctx.reply(
      `Invalid index. You have ${session.images.length} images.`,
    );
  }

  const removed = session.images.splice(n - 1, 1)[0];
  ctx.reply(`Removed image #${removed.id} at position ${n}.`);
});

/**
 * /move from to – move image within list
 */
bot.command("move", (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply("No images to move.");
  }

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply("Usage: /move from to  (example: /move 5 1)");
  }

  const from = parseInt(parts[1], 10);
  const to = parseInt(parts[2], 10);

  if (
    Number.isNaN(from) ||
    Number.isNaN(to) ||
    from < 1 ||
    to < 1 ||
    from > session.images.length ||
    to > session.images.length
  ) {
    return ctx.reply(
      `Invalid positions. You have ${session.images.length} images.`,
    );
  }

  if (from === to) {
    return ctx.reply("Positions are the same, nothing to move.");
  }

  const img = session.images.splice(from - 1, 1)[0];
  session.images.splice(to - 1, 0, img);

  ctx.reply(`Moved image #${img.id} from ${from} to ${to}.`);
});

/**
 * /name <filename> – set output PDF name
 */
bot.command("name", (ctx) => {
  const chatId = ctx.chat.id;
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const text = ctx.message.text || "";
  const name = text.replace(/^\/name\s+/, "").trim();

  if (!name) {
    return ctx.reply("Usage: /name My_File_Name");
  }

  let fileName = name;
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    fileName += ".pdf";
  }

  session.pdfName = fileName;
  ctx.reply(`OK, I will name your file: ${fileName}`);
});

/**
 * /quality high|standard|light
 */
bot.command("quality", (ctx) => {
  const chatId = ctx.chat.id;
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /quality high|standard|light");
  }

  const q = parts[1].toLowerCase();
  if (!["high", "standard", "light"].includes(q)) {
    return ctx.reply("Invalid quality. Use: high, standard, or light.");
  }

  session.quality = q;
  ctx.reply(`Quality set to: ${q}`);
});

/**
 * /pagesize auto|a4p|a4l|square
 */
bot.command("pagesize", (ctx) => {
  const chatId = ctx.chat.id;
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /pagesize auto|a4p|a4l|square");
  }

  const p = parts[1].toLowerCase();
  if (!["auto", "a4p", "a4l", "square"].includes(p)) {
    return ctx.reply("Invalid page size. Use: auto, a4p, a4l, or square.");
  }

  session.pageSize = p;
  ctx.reply(`Page size set to: ${p}`);
});

/**
 * /rotate n [deg] – rotate one image
 */
bot.command("rotate", (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply("No images to rotate.");
  }

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /rotate n [deg]. Example: /rotate 2 90");
  }

  const index = parseInt(parts[1], 10);
  if (Number.isNaN(index) || index < 1 || index > session.images.length) {
    return ctx.reply(
      `Invalid index. You have ${session.images.length} images.`,
    );
  }

  const deg = parts[2] ? parseInt(parts[2], 10) : 90;
  if (Number.isNaN(deg)) {
    return ctx.reply("Invalid degrees. Use an integer like 90, 180, 270.");
  }

  const img = session.images[index - 1];
  img.rotationDeg = ((img.rotationDeg || 0) + deg) % 360;

  ctx.reply(
    `Rotated image #${img.id} at position ${index}. Now rotation = ${img.rotationDeg}°`,
  );
});

/**
 * /bg white|black|transparent – background color
 */
bot.command("bg", (ctx) => {
  const chatId = ctx.chat.id;
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply("Usage: /bg white|black|transparent");
  }

  const bg = parts[1].toLowerCase();
  if (!["white", "black", "transparent"].includes(bg)) {
    return ctx.reply("Invalid background. Use: white, black, or transparent.");
  }

  session.background = bg;
  ctx.reply(`Background set to: ${bg}`);
});

/**
 * /done – convert images to PDF
 */
bot.command("done", async (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const images = session.images.map((img) => ({
    buffer: img.buffer,
    rotationDeg: img.rotationDeg || 0,
  }));

  // clear image list for next run
  session.images = [];
  session.nextId = 1;

  try {
    await ctx.reply(
      getText(lang, "converting") || "Converting images to PDF...",
    );

    const pdfBuffer = await imagesToPdf(images, {
      quality: session.quality,
      pageSize: session.pageSize,
      background: session.background,
    });

    await ctx.replyWithDocument(
      {
        source: pdfBuffer,
        filename: session.pdfName || "converted.pdf",
      },
      {
        caption:
          format(getText(lang, "convertedCaption"), {
            pages: images.length,
          }) || `Your PDF with ${images.length} page(s).`,
      },
    );
  } catch (err) {
    console.error(err);
    ctx.reply(
      getText(lang, "convertError") ||
        "Error while converting images to PDF. Try again.",
    );
  }
});

/**
 * /lang en|uz|ru – change language by command
 */
bot.command("lang", (ctx) => {
  const chatId = ctx.chat.id;
  const currentLang = getLangForChat(chatId);

  const text = ctx.message.text || "";
  const parts = text.trim().split(/\s+/);

  // Case 1: user just types `/lang` → show buttons
  if (parts.length < 2) {
    return ctx.reply(
      getText(currentLang, "langUsageButtons") ||
        "Choose language / Tilni tanlang / Выберите язык:",
      Markup.inlineKeyboard([
        [Markup.button.callback("English 🇺🇸", "lang_en")],
        [Markup.button.callback("O'zbek 🇺🇿", "lang_uz")],
        [Markup.button.callback("Русский 🇷🇺", "lang_ru")],
      ]),
    );
  }

  // Case 2: user types `/lang en` style
  const requested = parts[1].toLowerCase();
  const resolved = resolveLang(requested);

  if (!["en", "uz", "ru"].includes(resolved)) {
    return ctx.reply(
      getText(currentLang, "langInvalid") ||
        "Unsupported language code. Use: en, uz, ru.",
    );
  }

  setLangForChat(chatId, resolved);
  return ctx.reply(
    getText(resolved, "langSet") || "Language successfully changed.",
  );
});

/**
 * /listpdf – list stored PDFs for merge
 */
bot.command("listpdf", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.pdfFiles.length === 0) {
    return ctx.reply(
      getText(lang, "noPdfs") ||
        "You have no PDFs stored. Send PDF files as documents.",
    );
  }

  const lines = session.pdfFiles.map((pdf, index) => {
    const pos = index + 1;
    return `${pos}. PDF #${pdf.id}`;
  });

  const header = getText(lang, "listPdfHeader") || "Current PDFs:";
  ctx.reply([header, ...lines].join("\n"));
});

/**
 * /mergepdf – merge all stored PDFs into one
 */
bot.command("mergepdf", async (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.pdfFiles.length === 0) {
    return ctx.reply(
      getText(lang, "mergeNoPdfs") || "No PDFs to merge. Send PDFs first.",
    );
  }

  try {
    await ctx.reply(
      getText(lang, "mergingPdfs") || "Merging PDFs, please wait...",
    );

    const pdfBuffers = session.pdfFiles.map((p) => p.buffer);
    const merged = await mergePdfs(pdfBuffers);

    session.pdfFiles = [];
    session.nextPdfId = 1;

    await ctx.replyWithDocument(
      {
        source: merged,
        filename: "merged.pdf",
      },
      {
        caption:
          getText(lang, "mergedResultCaption") ||
          `Merged ${pdfBuffers.length} PDF file(s).`,
      },
    );
  } catch (err) {
    console.error(err);
    ctx.reply(
      getText(lang, "mergeError") || "Error while merging PDFs. Try again.",
    );
  }
});

/**
 * /stats – short stats (admin only)
 */
bot.command("stats", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply("⛔ You are not allowed to view stats.");
  }

  const stats = getStats();

  const message =
    "📊 Bot Stats\n\n" +
    `👤 Unique Users: ${stats.uniqueUsers}\n` +
    `💬 Total Messages: ${stats.totalMessages}`;

  return ctx.reply(message);
});

/** /fullstats – full stats (admin only)
 */
bot.command("fullstats", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply("⛔ You cannot access this.");
  }

  const stats = getStats();

  let text =
    "📊 Full Stats\n\n" +
    `Users: ${stats.uniqueUsers}\n` +
    `Messages: ${stats.totalMessages}\n\n`;

  for (const [id, data] of Object.entries(stats.users)) {
    text += `• ${id}`;
    if (data.username) text += ` (@${data.username})`;
    text += `: ${data.messageCount || 0} messages\n`;
  }

  return ctx.reply(text || "No stats yet.");
});

// send raw stats.json as a file
bot.command("statsfile", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply("⛔ You cannot access this.");
  }

  try {
    if (!fs.existsSync(statsPath)) {
      return ctx.reply("No stats.json file yet (no activity recorded).");
    }

    return ctx.replyWithDocument({
      source: fs.createReadStream(statsPath),
      filename: "stats.json",
    });
  } catch (err) {
    console.error("Failed to send stats.json:", err);
    return ctx.reply("Error while sending stats file.");
  }
});

/**
 * Handle photos and documents (images + PDFs)
 */
bot.on(["photo", "document"], async (ctx) => {
  const chatId = ctx.chat.id;
  let session;

  try {
    session = getSession(chatId, ctx.from?.language_code);
  } catch (e) {
    if (e.message === "RATE_LIMIT") {
      return ctx.reply("Too many requests. Please wait a bit.");
    }
    console.error(e);
    return ctx.reply("Internal error. Try again later.");
  }

  const lang = session.lang;

  try {
    let fileId;
    let mimeType = null;

    if (ctx.message.photo) {
      const photoArray = ctx.message.photo;
      fileId = photoArray[photoArray.length - 1].file_id;
    } else if (ctx.message.document) {
      const doc = ctx.message.document;
      mimeType = doc.mime_type || "";
      fileId = doc.file_id;

      if (
        !mimeType.startsWith("image/") &&
        !mimeType.startsWith("application/pdf")
      ) {
        return ctx.reply(
          getText(lang, "onlyImages") || "Send only image files or PDFs.",
        );
      }
    }

    if (!fileId) {
      return ctx.reply(getText(lang, "readError") || "Could not read file.");
    }

    const fileInfo = await ctx.telegram.getFile(fileId);
    const filePath = fileInfo.file_path;
    const fileUrl = buildFileUrl(BOT_TOKEN, filePath);

    const buffer = await downloadTelegramFileToBuffer(fileUrl);

    if (mimeType && mimeType.startsWith("application/pdf")) {
      // store as PDF
      const pdfId = session.nextPdfId++;
      session.pdfFiles.push({ id: pdfId, buffer });

      await ctx.reply(
        format(getText(lang, "gotPdf"), { id: pdfId }) ||
          `Got PDF #${pdfId}. Use /listpdf to see all PDFs or /mergepdf to merge them.`,
      );
    } else {
      // store as image
      const imgId = session.nextId++;
      session.images.push({ id: imgId, buffer, rotationDeg: 0 });

      await ctx.reply(
        format(getText(lang, "gotImage"), {
          id: imgId,
          pos: session.images.length,
        }) ||
          `Got image #${imgId} at position ${session.images.length}.\n` +
            "Send more images, use /list, /swap, /move, /remove, /rotate or /done.",
      );
    }
  } catch (err) {
    console.error(err);
    ctx.reply(
      getText(lang, "receiveError") ||
        "Error while receiving the file. Try again.",
    );
  }
});

/**
 * When user sends just "/" – show commands
 */
bot.hears("/", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);

  const commandsList = [
    "/start - choose language",
    "/list - show image order",
    "/swap a b - swap images",
    "/move from to - move image",
    "/remove n - delete image",
    "/rotate n [deg] - rotate image",
    "/name <file> - set PDF name",
    "/quality <q> - high|standard|light",
    "/pagesize <p> - auto|a4p|a4l|square",
    "/bg <b> - white|black|transparent",
    "/done - generate PDF from images",
    "/listpdf - list stored PDFs",
    "/mergepdf - merge all stored PDFs",
    "/cancel - clear images and PDFs",
    "/lang <code> - change language",
    "/stats - view stats (admin)",
    "/fullstats - full stats (admin)",
    "/statsfile - get stats.json (admin)",
  ].join("\n");

  ctx.reply(
    (getText(lang, "fallback") ||
      "Send me images or PDFs. Then use commands to arrange and export.") +
      "\n\nCommands:\n" +
      commandsList,
  );
});

/**
 * Fallback for plain text messages (non-commands)
 * - no double replies for /start, /stats, etc.
 */
bot.on("message", (ctx) => {
  // ignore if it's photo or document – that is handled above
  if (ctx.message.photo || ctx.message.document) return;

  // ignore commands (text starting with "/") so we don't duplicate replies
  if (ctx.message.text && ctx.message.text.startsWith("/")) return;

  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);

  ctx.reply(
    getText(lang, "fallback") ||
      "Send me images (photos or files). When you’re ready, use /done to get a PDF.",
  );
});

bot
  .launch({
    dropPendingUpdates: true,
  })
  .then(() => {
    console.log("Bot started");
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
