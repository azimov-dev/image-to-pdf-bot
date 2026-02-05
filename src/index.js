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
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

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
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const MEDIA_GROUP_DELAY = 800; // ms
const pendingMediaGroups = new Map();

function now() {
  return Date.now();
}

function sanitizeFileName(input) {
  const raw = (input || "").trim();
  if (!raw) return "converted.pdf";

  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const base = cleaned.replace(/\.pdf$/i, "").trim() || "converted";
  const trimmed = base.length > 60 ? base.slice(0, 60) : base;
  return `${trimmed}.pdf`;
}

function buildImageActionsKeyboard(lang) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        getText(lang, "btnRotateImage") || "Rotate image",
        "img_pick:rotate",
      ),
      Markup.button.callback(
        getText(lang, "btnDeleteImage") || "Delete image",
        "img_pick:delete",
      ),
    ],
    [
      Markup.button.callback(
        getText(lang, "btnList") || "Show list",
        "img_list",
      ),
      Markup.button.callback(getText(lang, "btnDone") || "Done", "img_done"),
    ],
  ]);
}

function buildImagePickKeyboard(lang, count, action) {
  const max = Math.min(count, 30);
  const rows = [];
  let row = [];
  for (let i = 1; i <= max; i += 1) {
    row.push(Markup.button.callback(String(i), `img_pick:${action}:${i}`));
    if (row.length === 5 || i === max) {
      rows.push(row);
      row = [];
    }
  }

  rows.push([
    Markup.button.callback(
      getText(lang, "menuBack") || "⬅️ Back",
      "img_pick_cancel",
    ),
  ]);

  return Markup.inlineKeyboard(rows);
}

function buildRotateDegreeKeyboard(lang, imageId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        getText(lang, "btnRotate90") || "Rotate 90°",
        `img_rotate:${imageId}:90`,
      ),
      Markup.button.callback(
        getText(lang, "btnRotate180") || "Rotate 180°",
        `img_rotate:${imageId}:180`,
      ),
      Markup.button.callback(
        getText(lang, "btnRotate270") || "Rotate 270°",
        `img_rotate:${imageId}:270`,
      ),
    ],
  ]);
}

function buildMainMenuKeyboard(lang) {
  return Markup.keyboard([
    [
      getText(lang, "menuImages") || "🖼️ Images → PDF",
      getText(lang, "menuMerge") || "📚 Merge PDFs",
    ],
    [
      getText(lang, "menuSettings") || "⚙️ Settings",
      getText(lang, "menuLang") || "🌐 Language",
    ],
    [
      getText(lang, "menuHelp") || "❓ Help",
      getText(lang, "menuStatus") || "📊 Status",
    ],
  ]).resize();
}

function buildImagesKeyboard(lang) {
  return Markup.keyboard([
    [getText(lang, "btnDone") || "Done"],
    [
      getText(lang, "btnRotateImage") || "Rotate image",
      getText(lang, "btnDeleteImage") || "Delete image",
    ],
    [getText(lang, "btnList") || "Show list"],
    [getText(lang, "menuBack") || "⬅️ Back"],
  ]).resize();
}

function buildMergeKeyboard(lang) {
  return Markup.keyboard([
    [getText(lang, "mergeNow") || "🧩 Merge now"],
    [
      getText(lang, "mergeList") || "📄 List PDFs",
      getText(lang, "mergeClear") || "🧹 Clear PDFs",
    ],
    [getText(lang, "menuBack") || "⬅️ Back"],
  ]).resize();
}

function buildSettingsKeyboard(lang) {
  return Markup.keyboard([
    [
      getText(lang, "settingsQuality") || "✨ Quality",
      getText(lang, "settingsPageSize") || "📄 Page size",
    ],
    [
      getText(lang, "settingsBackground") || "🎨 Background",
      getText(lang, "settingsName") || "📝 File name",
    ],
    [getText(lang, "menuBack") || "⬅️ Back"],
  ]).resize();
}

function buildQualityKeyboard(lang) {
  return Markup.keyboard([
    [
      getText(lang, "qualityHigh") || "✨ High",
      getText(lang, "qualityStandard") || "⚖️ Standard",
      getText(lang, "qualityLight") || "🪶 Light",
    ],
    [getText(lang, "menuBack") || "⬅️ Back"],
  ]).resize();
}

function buildPageSizeKeyboard(lang) {
  return Markup.keyboard([
    [
      getText(lang, "pageAuto") || "📄 Auto",
      getText(lang, "pageA4P") || "📄 A4 Portrait",
      getText(lang, "pageA4L") || "📄 A4 Landscape",
    ],
    [
      getText(lang, "pageSquare") || "⬜ Square",
      getText(lang, "menuBack") || "⬅️ Back",
    ],
  ]).resize();
}

function buildBackgroundKeyboard(lang) {
  return Markup.keyboard([
    [
      getText(lang, "bgWhite") || "⬜ White",
      getText(lang, "bgBlack") || "⬛ Black",
      getText(lang, "bgTransparent") || "🫥 Transparent",
    ],
    [getText(lang, "menuBack") || "⬅️ Back"],
  ]).resize();
}

function resolveActionFromText(text, lang) {
  const t = (text || "").trim();
  const labels = {
    done: getText(lang, "btnDone") || "Done",
    rotateImage: getText(lang, "btnRotateImage") || "Rotate image",
    deleteImage: getText(lang, "btnDeleteImage") || "Delete image",
    list: getText(lang, "btnList") || "Show list",
    menuImages: getText(lang, "menuImages") || "🖼️ Images → PDF",
    menuMerge: getText(lang, "menuMerge") || "📚 Merge PDFs",
    menuSettings: getText(lang, "menuSettings") || "⚙️ Settings",
    menuLang: getText(lang, "menuLang") || "🌐 Language",
    menuHelp: getText(lang, "menuHelp") || "❓ Help",
    menuStatus: getText(lang, "menuStatus") || "📊 Status",
    menuBack: getText(lang, "menuBack") || "⬅️ Back",
    mergeNow: getText(lang, "mergeNow") || "🧩 Merge now",
    mergeList: getText(lang, "mergeList") || "📄 List PDFs",
    mergeClear: getText(lang, "mergeClear") || "🧹 Clear PDFs",
    settingsQuality: getText(lang, "settingsQuality") || "✨ Quality",
    settingsPageSize: getText(lang, "settingsPageSize") || "📄 Page size",
    settingsBackground: getText(lang, "settingsBackground") || "🎨 Background",
    settingsName: getText(lang, "settingsName") || "📝 File name",
    qualityHigh: getText(lang, "qualityHigh") || "✨ High",
    qualityStandard: getText(lang, "qualityStandard") || "⚖️ Standard",
    qualityLight: getText(lang, "qualityLight") || "🪶 Light",
    pageAuto: getText(lang, "pageAuto") || "📄 Auto",
    pageA4P: getText(lang, "pageA4P") || "📄 A4 Portrait",
    pageA4L: getText(lang, "pageA4L") || "📄 A4 Landscape",
    pageSquare: getText(lang, "pageSquare") || "⬜ Square",
    bgWhite: getText(lang, "bgWhite") || "⬜ White",
    bgBlack: getText(lang, "bgBlack") || "⬛ Black",
    bgTransparent: getText(lang, "bgTransparent") || "🫥 Transparent",
  };

  if (t === labels.done) return "done";
  if (t === labels.rotateImage) return "rotateImage";
  if (t === labels.deleteImage) return "deleteImage";
  if (t === labels.list) return "list";
  if (t === labels.menuImages) return "menuImages";
  if (t === labels.menuMerge) return "menuMerge";
  if (t === labels.menuSettings) return "menuSettings";
  if (t === labels.menuLang) return "menuLang";
  if (t === labels.menuHelp) return "menuHelp";
  if (t === labels.menuStatus) return "menuStatus";
  if (t === labels.menuBack) return "menuBack";
  if (t === labels.mergeNow) return "mergeNow";
  if (t === labels.mergeList) return "mergeList";
  if (t === labels.mergeClear) return "mergeClear";
  if (t === labels.settingsQuality) return "settingsQuality";
  if (t === labels.settingsPageSize) return "settingsPageSize";
  if (t === labels.settingsBackground) return "settingsBackground";
  if (t === labels.settingsName) return "settingsName";
  if (t === labels.qualityHigh) return "qualityHigh";
  if (t === labels.qualityStandard) return "qualityStandard";
  if (t === labels.qualityLight) return "qualityLight";
  if (t === labels.pageAuto) return "pageAuto";
  if (t === labels.pageA4P) return "pageA4P";
  if (t === labels.pageA4L) return "pageA4L";
  if (t === labels.pageSquare) return "pageSquare";
  if (t === labels.bgWhite) return "bgWhite";
  if (t === labels.bgBlack) return "bgBlack";
  if (t === labels.bgTransparent) return "bgTransparent";
  return null;
}

function getMediaGroupKey(chatId, groupId) {
  return `${chatId}:${groupId}`;
}

function finalizeMediaGroup(chatId, groupKey) {
  const group = pendingMediaGroups.get(groupKey);
  if (!group) return;

  pendingMediaGroups.delete(groupKey);

  let session = sessions.get(chatId);
  if (!session) {
    session = initSession(chatId, null);
  }

  const lang = group.lang || session.lang || DEFAULT_LANG;
  const sorted = group.items.sort((a, b) => a.messageId - b.messageId);
  const startPos = session.images.length + 1;
  const added = [];

  for (const item of sorted) {
    const imgId = session.nextId++;
    session.images.push({ id: imgId, buffer: item.buffer, rotationDeg: 0 });
    added.push({ id: imgId, pos: session.images.length });
  }

  const endPos = session.images.length;
  const msg =
    getText(lang, "gotImagesGroup") ||
    "Added {count} images in order. Positions {from}-{to}.";

  return bot.telegram.sendMessage(
    chatId,
    format(msg, {
      count: sorted.length,
      from: startPos,
      to: endPos,
    }) || msg,
    buildImageActionsKeyboard(lang),
  );
}
function getLastImage(session) {
  if (!session || session.images.length === 0) return null;
  return session.images[session.images.length - 1];
}

function findImageIndexById(session, id) {
  if (!session) return -1;
  return session.images.findIndex((img) => img.id === id);
}

async function handleDone(ctx) {
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

  try {
    await ctx.replyWithChatAction("typing");
    await ctx.reply(
      getText(lang, "converting") || "Converting images to PDF...",
    );

    const pdfBuffer = await imagesToPdf(images, {
      quality: session.quality,
      pageSize: session.pageSize,
      background: session.background,
    });

    const outputName = sanitizeFileName(session.pdfName || "converted.pdf");
    await ctx.replyWithChatAction("upload_document");
    await ctx.replyWithDocument(
      {
        source: pdfBuffer,
        filename: outputName,
      },
      {
        caption:
          format(getText(lang, "convertedCaption"), {
            pages: images.length,
          }) || `Your PDF with ${images.length} page(s).`,
      },
    );

    await ctx.reply(
      getText(lang, "doneReady") || "✅ PDF is ready. What next?",
      buildMainMenuKeyboard(lang),
    );

    session.images = [];
    session.nextId = 1;
  } catch (err) {
    console.error(err);
    ctx.reply(
      getText(lang, "convertError") ||
        "Error while converting images to PDF. Try again.",
    );
  }
}

function handleList(ctx, session, lang) {
  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const lines = session.images.map((img, index) => {
    const position = index + 1;
    const rot = img.rotationDeg || 0;
    return `${position}. image #${img.id} (rotate: ${rot}°)`;
  });

  return ctx.reply(
    [
      getText(lang, "listHeader") || "Current image order:",
      ...lines,
      "",
      getText(lang, "listFooter") || "Use /swap a b to change positions.",
    ].join("\n"),
    buildImagesKeyboard(lang),
  );
}

function ensureMode(ctx, session, lang, mode) {
  if (!session || session.mode === mode) return;
  session.mode = mode;
  if (mode === "images") {
    return ctx.reply(
      getText(lang, "autoModeImages") || "🖼️ Switched to Image mode.",
      buildImagesKeyboard(lang),
    );
  }
  if (mode === "merge") {
    return ctx.reply(
      getText(lang, "autoModeMerge") || "📚 Switched to Merge mode.",
      buildMergeKeyboard(lang),
    );
  }
}

function handleStatus(ctx, session, lang) {
  const msg =
    getText(lang, "status") ||
    "Images: {images}\nPDFs: {pdfs}\nName: {name}\nQuality: {quality}\nPage size: {pageSize}\nBackground: {background}";
  return ctx.reply(
    format(msg, {
      images: session.images.length,
      pdfs: session.pdfFiles.length,
      name: sanitizeFileName(session.pdfName || "converted.pdf"),
      quality: session.quality,
      pageSize: session.pageSize,
      background: session.background,
    }) || msg,
    buildMainMenuKeyboard(lang),
  );
}

async function handleMerge(ctx) {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.pdfFiles.length === 0) {
    return ctx.reply(
      getText(lang, "mergeNoPdfs") || "No PDFs to merge. Send PDFs first.",
      buildMergeKeyboard(lang),
    );
  }

  try {
    await ctx.replyWithChatAction("typing");
    await ctx.reply(
      getText(lang, "mergingPdfs") || "Merging PDFs, please wait...",
    );

    const pdfBuffers = session.pdfFiles.map((p) => p.buffer);
    const merged = await mergePdfs(pdfBuffers);

    session.pdfFiles = [];
    session.nextPdfId = 1;

    await ctx.replyWithChatAction("upload_document");
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

    return ctx.reply(
      getText(lang, "menuMain") || "Choose an action:",
      buildMainMenuKeyboard(lang),
    );
  } catch (err) {
    console.error(err);
    return ctx.reply(
      getText(lang, "mergeError") || "Error while merging PDFs. Try again.",
      buildMergeKeyboard(lang),
    );
  }
}

function handleListPdfs(ctx, session, lang) {
  if (!session || session.pdfFiles.length === 0) {
    return ctx.reply(
      getText(lang, "noPdfs") ||
        "You have no PDFs stored. Send PDF files as documents.",
      buildMergeKeyboard(lang),
    );
  }

  const lines = session.pdfFiles.map((pdf, index) => {
    const pos = index + 1;
    return `${pos}. PDF #${pdf.id}`;
  });

  const header = getText(lang, "listPdfHeader") || "Current PDFs:";
  return ctx.reply([header, ...lines].join("\n"), buildMergeKeyboard(lang));
}

function initSession(chatId, languageCodeFromUser) {
  const resolvedLang = resolveLang(languageCodeFromUser);
  const session = {
    images: [], // { id, buffer, rotationDeg }
    pdfFiles: [], // { id, buffer }
    nextId: 1,
    nextPdfId: 1,
    lang: resolvedLang,
    mode: "main", // main|images|merge|settings
    ui: "main",
    awaitingName: false,
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

setInterval(() => {
  const t = now();
  for (const [chatId, session] of sessions.entries()) {
    if (t - session.lastActivity > SESSION_TTL) {
      sessions.delete(chatId);
    }
  }
}, CLEANUP_INTERVAL).unref();

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

  // not first time: show main menu
  const lang = session.lang || DEFAULT_LANG;
  return ctx.reply(
    getText(lang, "menuMain") || "Choose what you want to do:",
    buildMainMenuKeyboard(lang),
  );
});

/**
 * Language buttons
 */
bot.action("lang_en", async (ctx) => {
  const chatId = ctx.chat.id;
  setLangForChat(chatId, "en");
  await ctx.answerCbQuery();
  await ctx.editMessageText(getText("en", "start"));
  await ctx.reply(
    getText("en", "menuMain") || "Choose what you want to do:",
    buildMainMenuKeyboard("en"),
  );
});

bot.action("lang_uz", async (ctx) => {
  const chatId = ctx.chat.id;
  setLangForChat(chatId, "uz");
  await ctx.answerCbQuery();
  await ctx.editMessageText(getText("uz", "start"));
  await ctx.reply(
    getText("uz", "menuMain") || "Choose what you want to do:",
    buildMainMenuKeyboard("uz"),
  );
});

bot.action("lang_ru", async (ctx) => {
  const chatId = ctx.chat.id;
  setLangForChat(chatId, "ru");
  await ctx.answerCbQuery();
  await ctx.editMessageText(getText("ru", "start"));
  await ctx.reply(
    getText("ru", "menuMain") || "Choose what you want to do:",
    buildMainMenuKeyboard("ru"),
  );
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
    buildMainMenuKeyboard(lang),
  );
});

/**
 * /list – list images with order + rotation
 */
bot.command("list", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);
  return handleList(ctx, session, lang);
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
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "removeNoImages") || "No images to remove.");
  }

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      getText(lang, "removeUsage") || "Usage: /remove n  (example: /remove 2)",
    );
  }

  const n = parseInt(parts[1], 10);
  if (Number.isNaN(n) || n < 1 || n > session.images.length) {
    const msg =
      getText(lang, "removeInvalid") ||
      `Invalid index. You have ${session.images.length} images.`;
    return ctx.reply(format(msg, { count: session.images.length }) || msg);
  }

  const removed = session.images.splice(n - 1, 1)[0];
  const msg =
    getText(lang, "removeSuccess") ||
    `Removed image #${removed.id} at position ${n}.`;
  ctx.reply(format(msg, { id: removed.id, pos: n }) || msg);
});

/**
 * /move from to – move image within list
 */
bot.command("move", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "moveNoImages") || "No images to move.");
  }

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      getText(lang, "moveUsage") ||
        "Usage: /move from to  (example: /move 5 1)",
    );
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
    const msg =
      getText(lang, "moveInvalid") ||
      `Invalid positions. You have ${session.images.length} images.`;
    return ctx.reply(format(msg, { count: session.images.length }) || msg);
  }

  if (from === to) {
    return ctx.reply(
      getText(lang, "moveSame") || "Positions are the same, nothing to move.",
    );
  }

  const img = session.images.splice(from - 1, 1)[0];
  session.images.splice(to - 1, 0, img);

  const msg =
    getText(lang, "moveSuccess") ||
    `Moved image #${img.id} from ${from} to ${to}.`;
  ctx.reply(format(msg, { id: img.id, from, to }) || msg);
});

/**
 * /name <filename> – set output PDF name
 */
bot.command("name", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const text = ctx.message.text || "";
  const name = text.replace(/^\/name\s+/, "").trim();

  if (!name) {
    return ctx.reply(getText(lang, "nameUsage") || "Usage: /name My_File_Name");
  }

  const fileName = sanitizeFileName(name);

  session.pdfName = fileName;
  const msg =
    getText(lang, "nameSet") || `OK, I will name your file: ${fileName}`;
  ctx.reply(format(msg, { name: fileName }) || msg);
});

/**
 * /quality high|standard|light
 */
bot.command("quality", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      getText(lang, "qualityUsage") || "Usage: /quality high|standard|light",
    );
  }

  const q = parts[1].toLowerCase();
  if (!["high", "standard", "light"].includes(q)) {
    return ctx.reply(
      getText(lang, "qualityInvalid") ||
        "Invalid quality. Use: high, standard, or light.",
    );
  }

  session.quality = q;
  const msg = getText(lang, "qualitySet") || `Quality set to: ${q}`;
  ctx.reply(format(msg, { quality: q }) || msg);
});

/**
 * /pagesize auto|a4p|a4l|square
 */
bot.command("pagesize", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      getText(lang, "pageSizeUsage") || "Usage: /pagesize auto|a4p|a4l|square",
    );
  }

  const p = parts[1].toLowerCase();
  if (!["auto", "a4p", "a4l", "square"].includes(p)) {
    return ctx.reply(
      getText(lang, "pageSizeInvalid") ||
        "Invalid page size. Use: auto, a4p, a4l, or square.",
    );
  }

  session.pageSize = p;
  const msg = getText(lang, "pageSizeSet") || `Page size set to: ${p}`;
  ctx.reply(format(msg, { pageSize: p }) || msg);
});

/**
 * /rotate n [deg] – rotate one image
 */
bot.command("rotate", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "rotateNoImages") || "No images to rotate.");
  }

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      getText(lang, "rotateUsage") ||
        "Usage: /rotate n [deg]. Example: /rotate 2 90",
    );
  }

  const index = parseInt(parts[1], 10);
  if (Number.isNaN(index) || index < 1 || index > session.images.length) {
    const msg =
      getText(lang, "rotateInvalidIndex") ||
      `Invalid index. You have ${session.images.length} images.`;
    return ctx.reply(format(msg, { count: session.images.length }) || msg);
  }

  const deg = parts[2] ? parseInt(parts[2], 10) : 90;
  if (Number.isNaN(deg)) {
    return ctx.reply(
      getText(lang, "rotateInvalidDeg") ||
        "Invalid degrees. Use an integer like 90, 180, 270.",
    );
  }

  const img = session.images[index - 1];
  img.rotationDeg = ((img.rotationDeg || 0) + deg) % 360;

  const msg =
    getText(lang, "rotateSuccess") ||
    `Rotated image #${img.id} at position ${index}. Now rotation = ${img.rotationDeg}°`;
  ctx.reply(
    format(msg, { id: img.id, pos: index, deg: img.rotationDeg }) || msg,
  );
});

/**
 * /bg white|black|transparent – background color
 */
bot.command("bg", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const parts = (ctx.message.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return ctx.reply(
      getText(lang, "bgUsage") || "Usage: /bg white|black|transparent",
    );
  }

  const bg = parts[1].toLowerCase();
  if (!["white", "black", "transparent"].includes(bg)) {
    return ctx.reply(
      getText(lang, "bgInvalid") ||
        "Invalid background. Use: white, black, or transparent.",
    );
  }

  session.background = bg;
  const msg = getText(lang, "bgSet") || `Background set to: ${bg}`;
  ctx.reply(format(msg, { background: bg }) || msg);
});

/**
 * /done – convert images to PDF
 */
bot.command("done", async (ctx) => {
  return handleDone(ctx);
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
    buildMainMenuKeyboard(resolved),
  );
});

/**
 * /status – show current session settings
 */
bot.command("status", (ctx) => {
  const chatId = ctx.chat.id;
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);
  const lang = session.lang || DEFAULT_LANG;
  return handleStatus(ctx, session, lang);
});

/**
 * /help – show usage instructions
 */
bot.command("help", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  return ctx.reply(getText(lang, "start"), buildMainMenuKeyboard(lang));
});

/**
 * Inline button actions (no commands needed)
 */
bot.action("img_rotate_90", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const prompt =
    getText(lang, "chooseImageRotate") || "Select image to rotate:";
  return ctx.reply(
    prompt,
    buildImagePickKeyboard(lang, session.images.length, "rotate"),
  );
});

bot.action(/^img_rotate:(\d+):(90|180|270)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "rotateNoImages") || "No images to rotate.");
  }

  const imageId = parseInt(ctx.match[1], 10);
  const deg = parseInt(ctx.match[2], 10);
  const index = findImageIndexById(session, imageId);

  if (Number.isNaN(imageId) || index === -1) {
    return ctx.reply(getText(lang, "imageNotFound") || "Image not found.");
  }

  const img = session.images[index];
  img.rotationDeg = ((img.rotationDeg || 0) + deg) % 360;

  const msg =
    getText(lang, "rotateSuccess") ||
    `Rotated image #${img.id} at position ${index + 1}. Now rotation = ${img.rotationDeg}°`;
  return ctx.reply(
    format(msg, { id: img.id, pos: index + 1, deg: img.rotationDeg }) || msg,
    buildImagesKeyboard(lang),
  );
});

bot.action(/^img_remove:(\d+)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "removeNoImages") || "No images to remove.");
  }

  const imageId = parseInt(ctx.match[1], 10);
  const index = findImageIndexById(session, imageId);
  if (Number.isNaN(imageId) || index === -1) {
    return ctx.reply(getText(lang, "imageNotFound") || "Image not found.");
  }

  const removed = session.images.splice(index, 1)[0];
  const msg =
    getText(lang, "removeSuccess") ||
    `Removed image #${removed.id} at position ${index + 1}.`;
  return ctx.reply(
    format(msg, { id: removed.id, pos: index + 1 }) || msg,
    buildImagesKeyboard(lang),
  );
});

bot.action("img_rotate_180", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const prompt =
    getText(lang, "chooseImageRotate") || "Select image to rotate:";
  return ctx.reply(
    prompt,
    buildImagePickKeyboard(lang, session.images.length, "rotate"),
  );
});

bot.action("img_rotate_270", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const prompt =
    getText(lang, "chooseImageRotate") || "Select image to rotate:";
  return ctx.reply(
    prompt,
    buildImagePickKeyboard(lang, session.images.length, "rotate"),
  );
});

bot.action("img_remove_last", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const prompt =
    getText(lang, "chooseImageDelete") || "Select image to delete:";
  return ctx.reply(
    prompt,
    buildImagePickKeyboard(lang, session.images.length, "delete"),
  );
});

bot.action("img_list", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();
  return handleList(ctx, session, lang);
});

bot.action("img_done", async (ctx) => {
  await ctx.answerCbQuery();
  return handleDone(ctx);
});

bot.action(/^img_pick:(rotate|delete)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const action = ctx.match[1];
  const prompt =
    action === "rotate"
      ? getText(lang, "chooseImageRotate") || "Select image to rotate:"
      : getText(lang, "chooseImageDelete") || "Select image to delete:";

  return ctx.reply(
    prompt,
    buildImagePickKeyboard(lang, session.images.length, action),
  );
});

bot.action(/^img_pick:(rotate|delete):(\d+)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = sessions.get(chatId);
  const lang = getLangForChat(chatId);

  await ctx.answerCbQuery();

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "noImages") || "You have no images stored.");
  }

  const action = ctx.match[1];
  const pos = parseInt(ctx.match[2], 10);
  if (Number.isNaN(pos) || pos < 1 || pos > session.images.length) {
    return ctx.reply(getText(lang, "invalidPositions") || "Invalid positions.");
  }

  const index = pos - 1;
  const img = session.images[index];

  if (action === "delete") {
    const removed = session.images.splice(index, 1)[0];
    const msg =
      getText(lang, "removeSuccess") ||
      `Removed image #${removed.id} at position ${pos}.`;
    return ctx.reply(
      format(msg, { id: removed.id, pos }) || msg,
      buildImagesKeyboard(lang),
    );
  }

  const prompt =
    getText(lang, "chooseRotateDegree") || "Choose rotation angle:";
  return ctx.reply(prompt, buildRotateDegreeKeyboard(lang, img.id));
});

bot.action("img_pick_cancel", async (ctx) => {
  const lang = getLangForChat(ctx.chat.id);
  await ctx.answerCbQuery();
  return ctx.reply(
    getText(lang, "modeImages") || "Send images now.",
    buildImagesKeyboard(lang),
  );
});

/**
 * Reply-keyboard actions (no commands needed)
 */
bot.on("text", async (ctx, next) => {
  const text = ctx.message?.text || "";
  if (text.startsWith("/")) return next();

  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session =
    sessions.get(chatId) || initSession(chatId, ctx.from?.language_code);

  const action = resolveActionFromText(text, lang);

  if (session.awaitingName && action) {
    session.awaitingName = false;
  }

  if (session.awaitingName) {
    session.awaitingName = false;
    const fileName = sanitizeFileName(text);
    session.pdfName = fileName;
    const msg =
      getText(lang, "nameSet") || `OK, I will name your file: ${fileName}`;
    return ctx.reply(
      format(msg, { name: fileName }) || msg,
      buildSettingsKeyboard(lang),
    );
  }

  if (!action) return next();

  if (action === "menuImages") {
    session.mode = "images";
    session.ui = "images";
    return ctx.reply(
      getText(lang, "modeImages") || "Send images now.",
      buildImagesKeyboard(lang),
    );
  }

  if (action === "menuMerge") {
    session.mode = "merge";
    session.ui = "merge";
    return ctx.reply(
      getText(lang, "modeMerge") || "Send PDF files now.",
      buildMergeKeyboard(lang),
    );
  }

  if (action === "menuSettings") {
    session.ui = "settings";
    return ctx.reply(
      getText(lang, "settingsTitle") || "Settings:",
      buildSettingsKeyboard(lang),
    );
  }

  if (action === "menuLang") {
    return ctx.reply(
      getText(lang, "langUsageButtons") ||
        "Choose language / Tilni tanlang / Выберите язык:",
      Markup.inlineKeyboard([
        [Markup.button.callback("English 🇺🇸", "lang_en")],
        [Markup.button.callback("O'zbek 🇺🇿", "lang_uz")],
        [Markup.button.callback("Русский 🇷🇺", "lang_ru")],
      ]),
    );
  }

  if (action === "menuHelp") {
    return ctx.reply(getText(lang, "start"), buildMainMenuKeyboard(lang));
  }

  if (action === "menuStatus") {
    return handleStatus(ctx, session, lang);
  }

  if (action === "menuBack") {
    session.ui = "main";
    return ctx.reply(
      getText(lang, "menuMain") || "Choose what you want to do:",
      buildMainMenuKeyboard(lang),
    );
  }

  if (action === "mergeNow") return handleMerge(ctx);
  if (action === "mergeList") return handleListPdfs(ctx, session, lang);
  if (action === "mergeClear") {
    session.pdfFiles = [];
    session.nextPdfId = 1;
    return ctx.reply(
      getText(lang, "mergeCleared") || "PDF list cleared.",
      buildMergeKeyboard(lang),
    );
  }

  if (action === "settingsQuality") {
    session.ui = "quality";
    return ctx.reply(
      getText(lang, "chooseQuality") || "Choose quality:",
      buildQualityKeyboard(lang),
    );
  }

  if (action === "settingsPageSize") {
    session.ui = "pagesize";
    return ctx.reply(
      getText(lang, "choosePageSize") || "Choose page size:",
      buildPageSizeKeyboard(lang),
    );
  }

  if (action === "settingsBackground") {
    session.ui = "background";
    return ctx.reply(
      getText(lang, "chooseBackground") || "Choose background:",
      buildBackgroundKeyboard(lang),
    );
  }

  if (action === "settingsName") {
    session.awaitingName = true;
    return ctx.reply(getText(lang, "askName") || "Send the file name:");
  }

  if (
    action === "qualityHigh" ||
    action === "qualityStandard" ||
    action === "qualityLight"
  ) {
    const q =
      action === "qualityHigh"
        ? "high"
        : action === "qualityStandard"
          ? "standard"
          : "light";
    session.quality = q;
    const msg = getText(lang, "qualitySet") || `Quality set to: ${q}`;
    return ctx.reply(
      format(msg, { quality: q }) || msg,
      buildSettingsKeyboard(lang),
    );
  }

  if (
    action === "pageAuto" ||
    action === "pageA4P" ||
    action === "pageA4L" ||
    action === "pageSquare"
  ) {
    const p =
      action === "pageAuto"
        ? "auto"
        : action === "pageA4P"
          ? "a4p"
          : action === "pageA4L"
            ? "a4l"
            : "square";
    session.pageSize = p;
    const msg = getText(lang, "pageSizeSet") || `Page size set to: ${p}`;
    return ctx.reply(
      format(msg, { pageSize: p }) || msg,
      buildSettingsKeyboard(lang),
    );
  }

  if (
    action === "bgWhite" ||
    action === "bgBlack" ||
    action === "bgTransparent"
  ) {
    const bg =
      action === "bgWhite"
        ? "white"
        : action === "bgBlack"
          ? "black"
          : "transparent";
    session.background = bg;
    const msg = getText(lang, "bgSet") || `Background set to: ${bg}`;
    return ctx.reply(
      format(msg, { background: bg }) || msg,
      buildSettingsKeyboard(lang),
    );
  }

  if (action === "done") return handleDone(ctx);
  if (action === "list") {
    return handleList(ctx, session, lang);
  }

  if (action === "rotateImage" || action === "deleteImage") {
    if (!session || session.images.length === 0) {
      return ctx.reply(
        getText(lang, "noImages") || "You have no images stored.",
      );
    }
    const prompt =
      action === "rotateImage"
        ? getText(lang, "chooseImageRotate") || "Select image to rotate:"
        : getText(lang, "chooseImageDelete") || "Select image to delete:";
    const actionKey = action === "rotateImage" ? "rotate" : "delete";
    return ctx.reply(
      prompt,
      buildImagePickKeyboard(lang, session.images.length, actionKey),
    );
  }

  if (!session || session.images.length === 0) {
    return ctx.reply(getText(lang, "rotateNoImages") || "No images to rotate.");
  }

  return ctx.reply(
    getText(lang, "menuMain") || "Choose what you want to do:",
    buildMainMenuKeyboard(lang),
  );
});

/**
 * /listpdf – list stored PDFs for merge
 */
bot.command("listpdf", (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLangForChat(chatId);
  const session = sessions.get(chatId);
  return handleListPdfs(ctx, session, lang);
});

/**
 * /mergepdf – merge all stored PDFs into one
 */
bot.command("mergepdf", async (ctx) => {
  return handleMerge(ctx);
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
      const lang = getLangForChat(chatId);
      return ctx.reply(
        getText(lang, "rateLimit") || "Too many requests. Please wait a bit.",
      );
    }
    console.error(e);
    return ctx.reply("Internal error. Try again later.");
  }

  const lang = session.lang;

  try {
    let fileId;
    let mimeType = null;
    let inferredMode = null;

    if (ctx.message.photo) {
      const photoArray = ctx.message.photo;
      fileId = photoArray[photoArray.length - 1].file_id;
      inferredMode = "images";
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

      inferredMode = mimeType.startsWith("application/pdf")
        ? "merge"
        : "images";
    }

    if (!fileId) {
      return ctx.reply(getText(lang, "readError") || "Could not read file.");
    }

    const fileInfo = await ctx.telegram.getFile(fileId);
    const filePath = fileInfo.file_path;
    const fileUrl = buildFileUrl(BOT_TOKEN, filePath);

    if (fileInfo.file_size && fileInfo.file_size > MAX_FILE_SIZE_BYTES) {
      const msg =
        getText(lang, "fileTooLarge") ||
        "File is too large. Max size: {max} MB.";
      return ctx.reply(
        format(msg, {
          max: MAX_FILE_SIZE_MB,
          size: Math.ceil(fileInfo.file_size / (1024 * 1024)),
        }) || msg,
      );
    }

    const buffer = await downloadTelegramFileToBuffer(fileUrl);

    if (inferredMode) {
      ensureMode(ctx, session, lang, inferredMode);
    }

    if (mimeType && mimeType.startsWith("application/pdf")) {
      // store as PDF
      const pdfId = session.nextPdfId++;
      session.pdfFiles.push({ id: pdfId, buffer });

      await ctx.reply(
        format(getText(lang, "gotPdf"), { id: pdfId }) ||
          `Got PDF #${pdfId}. Use /listpdf to see all PDFs or /mergepdf to merge them.`,
        buildMergeKeyboard(lang),
      );
    } else {
      // store as image
      const groupId = ctx.message.media_group_id;
      if (groupId) {
        const key = getMediaGroupKey(chatId, groupId);
        const existing = pendingMediaGroups.get(key) || {
          items: [],
          timer: null,
          lang,
        };

        existing.items.push({
          messageId: ctx.message.message_id,
          buffer,
        });

        if (existing.timer) clearTimeout(existing.timer);
        existing.timer = setTimeout(
          () => finalizeMediaGroup(chatId, key),
          MEDIA_GROUP_DELAY,
        );

        pendingMediaGroups.set(key, existing);
        return;
      }

      const imgId = session.nextId++;
      session.images.push({ id: imgId, buffer, rotationDeg: 0 });

      await ctx.reply(
        format(getText(lang, "gotImage"), {
          id: imgId,
          pos: session.images.length,
        }) ||
          `Got image #${imgId} at position ${session.images.length}.\n` +
            "Send more images or use the buttons below.",
        buildImageActionsKeyboard(lang),
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
    "/help - show instructions",
    "/lang - change language",
    "/status - show current settings",
    "/cancel - clear images and PDFs",
    "/listpdf - list stored PDFs",
    "/mergepdf - merge all stored PDFs",
    "/stats - view stats (admin)",
    "/fullstats - full stats (admin)",
    "/statsfile - get stats.json (admin)",
  ].join("\n");

  ctx.reply(
    (getText(lang, "fallback") ||
      "Send me images or PDFs. Use the buttons to finish.") +
      "\n\nCommands:\n" +
      commandsList,
    buildMainMenuKeyboard(lang),
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
      "Send me images (photos or files). When you’re ready, tap Done to get a PDF.",
    buildMainMenuKeyboard(lang),
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
