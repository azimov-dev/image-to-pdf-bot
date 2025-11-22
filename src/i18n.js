// src/i18n.js

const SUPPORTED_LANGS = ["en", "uz", "ru"];
const DEFAULT_LANG = "en";

const messages = {
  en: {
    // shown after language selection or /start
    start: `👋 Hi! I turn your images and PDFs into a clean, ordered PDF.

📸 Images → PDF:
1) Send me one or more images (photos or image files).
2) Use /list to see the current order.
3) Use /swap a b or /move a b to change positions.
4) Use /remove n to delete a page, and /rotate n [deg] to fix rotation.
5) When you’re ready, send /done and I’ll send you the PDF.

⚙️ Extra options:
- /name MyFile — set PDF file name.
- /quality high|standard|light — change quality/size.
- /pagesize auto|a4p|a4l|square — change page size.
- /bg white|black|transparent — change background.

📚 PDF merge:
- Send PDF files as documents.
- Use /listpdf to see all stored PDFs.
- Use /mergepdf to get one merged PDF.

🔁 Other:
- /cancel — clear current images and PDFs.
- /lang en|uz|ru — change language.`,

    cleared: "Session cleared. You can start again.",
    noImages: "You have no images stored.",
    listHeader: "Current image order:",
    listFooter: "Use /swap a b or /move a b to change positions.",
    usageSwap: "Usage: /swap a b",
    invalidPositions: "Invalid positions. You currently have {count} image(s).",
    samePositions: "Positions are the same, nothing to swap.",
    swapSuccess:
      "Swapped positions {a} and {b}. Use /list to check the new order.",
    langUsage: "Usage: /lang en|uz|ru",
    langInvalid: "Unsupported language code. Use: en, uz, ru.",
    langSet: "Language changed.",
    converting: "Converting images to PDF...",
    convertedCaption: "Your PDF with {pages} page(s).",
    convertError: "Error while converting images to PDF. Try again.",
    onlyImages: "Send only image files or PDFs.",
    readError: "Could not read file.",
    receiveError: "Error while receiving the file. Try again.",
    gotImage:
      "Got image #{id} at position {pos}. Send more images or use /list, /swap, /move, /remove, /rotate, /done.",
    fallback:
      "Send me images or PDFs. I can build an ordered PDF from them. Use /done for images or /mergepdf for PDFs.",
    gotPdf:
      "Got PDF #{id}. Use /listpdf to see all PDFs or /mergepdf to merge them.",
    noPdfs: "You have no PDFs stored. Send PDF files as documents.",
    listPdfHeader: "Current PDFs:",
    mergeNoPdfs: "No PDFs to merge. Send PDFs first.",
    mergeError: "Error while merging PDFs. Try again.",
    mergingPdfs: "Merging PDFs, please wait...",
    mergedResultCaption: "Your merged PDF is ready!",
  },

  uz: {
    start: `👋 Salom! Men rasmlar va PDF fayllaringizdan tartibli PDF yasab beraman.

📸 Rasmlardan PDF:
1) Bir yoki bir nechta rasm yuboring (foto yoki rasm fayli).
2) /list bilan hozirgi tartibni ko‘ring.
3) /swap a b yoki /move a b bilan tartibni o‘zgartiring.
4) /remove n bilan sahifani o‘chiring, /rotate n [gradus] bilan aylantiring.
5) Tayyor bo‘lgach, /done yuboring — men sizga PDF yuboraman.

⚙️ Qo‘shimcha sozlamalar:
- /name MeningFaylim — PDF nomini o‘rnatish.
- /quality high|standard|light — sifat/hajmni tanlash.
- /pagesize auto|a4p|a4l|square — sahifa o‘lchamini tanlash.
- /bg white|black|transparent — fon rangini o‘zgartirish.

📚 PDF birlashtirish:
- PDF fayllarni document qilib yuboring.
- /listpdf bilan saqlangan PDF larni ko‘ring.
- /mergepdf bilan ularni bitta PDF ga birlashtiring.

🔁 Boshqa:
- /cancel — joriy rasmlar va PDF larni tozalaydi.
- /lang en|uz|ru — tilni almashtiradi.`,

    cleared: "Session tozalandi. Yangi boshlasangiz bo‘ladi.",
    noImages: "Sizda saqlangan rasm yo‘q.",
    listHeader: "Hozirgi rasm tartibi:",
    listFooter:
      "Tartibni o‘zgartirish uchun /swap a b yoki /move a b dan foydalaning.",
    usageSwap: "Foydalanish: /swap a b",
    invalidPositions: "Noto‘g‘ri pozitsiya. Hozir {count} ta rasm bor.",
    samePositions: "Pozitsiyalar bir xil, almashtirishga hojat yo‘q.",
    swapSuccess:
      "{a} va {b}-pozitsiyalar almashtirildi. Yangi tartibni /list orqali ko‘ring.",
    langUsage: "Foydalanish: /lang en|uz|ru",
    langInvalid:
      "Bunday til kodi qo‘llab-quvvatlanmaydi. en, uz yoki ru dan foydalaning.",
    langSet: "Til muvaffaqiyatli o‘zgartirildi.",
    converting: "Rasmlar PDF ga aylantirilmoqda...",
    convertedCaption: "{pages} ta sahifali PDF tayyor.",
    convertError:
      "Rasmlarni PDF ga aylantirishda xatolik yuz berdi. Qayta urinib ko‘ring.",
    onlyImages: "Faqat rasm fayllari yoki PDF yuboring.",
    readError: "Faylni o‘qib bo‘lmadi.",
    receiveError: "Faylni qabul qilishda xatolik. Qayta urinib ko‘ring.",
    gotImage:
      "Rasm #{id} qabul qilindi. Pozitsiya: {pos}. Yana rasm yuboring yoki /list, /swap, /move, /remove, /rotate, /done dan foydalaning.",
    fallback:
      "Menga rasm yoki PDF yuboring. Men ularni tartibli PDF ga aylantirib beraman. Rasmlar uchun /done, PDF larni birlashtirish uchun /mergepdf ishlating.",
    gotPdf:
      "PDF #{id} qabul qilindi. Barcha PDF larni /listpdf bilan ko‘ring yoki /mergepdf bilan birlashtiring.",
    noPdfs: "Saqlangan PDF fayl yo‘q. Avval PDF yuboring (document sifatida).",
    listPdfHeader: "Hozirgi PDF lar:",
    mergeNoPdfs: "Birlashtirish uchun PDF yo‘q. Avval PDF yuboring.",
    mergeError: "PDF fayllarni birlashtirishda xatolik. Qayta urinib ko‘ring.",
    mergingPdfs: "PDF fayllar birlashtirilmoqda, biroz kuting...",
    mergedResultCaption: "Birlashtirilgan PDF tayyor!",
  },

  ru: {
    start: `👋 Привет! Я собираю твои изображения и PDF в аккуратный, упорядоченный PDF.

📸 Картинки → PDF:
1) Отправь одно или несколько изображений (фото или файлы).
2) Используй /list, чтобы увидеть текущий порядок.
3) Меняй порядок через /swap a b или /move a b.
4) Удаляй страницу командой /remove n, вращай /rotate n [градусы].
5) Когда всё готово — отправь /done, и я пришлю PDF.

⚙️ Дополнительно:
- /name MyFile — задать имя итогового PDF.
- /quality high|standard|light — выбрать качество/размер.
- /pagesize auto|a4p|a4l|square — выбрать размер страницы.
- /bg white|black|transparent — выбрать фон.

📚 Объединение PDF:
- Отправь несколько PDF как документ.
- Посмотри список через /listpdf.
- Объедини их командой /mergepdf.

🔁 Прочее:
- /cancel очищает текущие картинки и PDF.
- /lang en|uz|ru меняет язык.`,

    cleared: "Сессия очищена. Можно начать заново.",
    noImages: "У тебя нет сохранённых изображений.",
    listHeader: "Текущий порядок изображений:",
    listFooter: "Используй /swap a b или /move a b, чтобы изменить порядок.",
    usageSwap: "Использование: /swap a b",
    invalidPositions: "Неверные позиции. Сейчас у тебя {count} изображений.",
    samePositions: "Позиции совпадают, нечего менять.",
    swapSuccess:
      "Поменял местами позиции {a} и {b}. Посмотри новый порядок через /list.",
    langUsage: "Использование: /lang en|uz|ru",
    langInvalid: "Такой язык не поддерживается. Используй: en, uz или ru.",
    langSet: "Язык успешно изменён.",
    converting: "Преобразую изображения в PDF...",
    convertedCaption: "Твой PDF из {pages} страницы(страниц).",
    convertError: "Ошибка при конвертации в PDF. Попробуй ещё раз.",
    onlyImages: "Отправляй только изображения или PDF.",
    readError: "Не удалось прочитать файл.",
    receiveError: "Ошибка при получении файла. Попробуй ещё раз.",
    gotImage:
      "Изображение #{id} получено. Позиция: {pos}. Отправляй ещё или пользуйся /list, /swap, /move, /remove, /rotate, /done.",
    fallback:
      "Отправь мне изображения или PDF. Я соберу из них аккуратный PDF. Для картинок используй /done, для объединения PDF — /mergepdf.",
    gotPdf:
      "PDF #{id} получен. Посмотри все через /listpdf или объедини через /mergepdf.",
    noPdfs: "У тебя нет сохранённых PDF. Сначала отправь PDF как документ.",
    listPdfHeader: "Текущий список PDF:",
    mergeNoPdfs: "Нет PDF для объединения. Сначала отправь PDF.",
    mergeError: "Ошибка при объединении PDF. Попробуй ещё раз.",
    mergingPdfs: "Идёт объединение PDF файлов, подождите...",
    mergedResultCaption: "Объединённый PDF готов!",
  },
};

/**
 * Resolve raw Telegram language_code to one of SUPPORTED_LANGS
 */
function resolveLang(rawCode) {
  if (!rawCode) return DEFAULT_LANG;
  const code = rawCode.toLowerCase();
  if (SUPPORTED_LANGS.includes(code)) return code;
  const short = code.slice(0, 2);
  if (SUPPORTED_LANGS.includes(short)) return short;
  return DEFAULT_LANG;
}

/**
 * Get localized text
 */
function getText(lang, key) {
  const l = SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
  const pack = messages[l] || messages[DEFAULT_LANG];
  return pack[key] || messages[DEFAULT_LANG][key] || "";
}

/**
 * Very simple {var} string formatter
 */
function format(str, vars = {}) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

module.exports = {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  messages,
  resolveLang,
  getText,
  format,
};
