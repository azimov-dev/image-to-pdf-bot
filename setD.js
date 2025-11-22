require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is not set in .env");
  process.exit(1);
}

// ---------- TEXTS ----------

const shortDescriptions = {
  en: "📄 Convert images & PDFs into a clean PDF | by @azimov_7",
  uz: "📄 Rasm va PDFlardan tartibli PDF yaratadi | muallif: @azimov_7",
  ru: "📄 Из изображений и PDF делает аккуратный PDF | автор: @azimov_7",

  es: "📄 Convierte imágenes y PDFs en un PDF ordenado | autor: @azimov_7",
  de: "📄 Bilder & PDFs zu einem sauberen PDF vereinen | Autor: @azimov_7",
  fr: "📄 Transforme images et PDFs en un PDF propre | auteur: @azimov_7",

  tr: "📄 Görselleri ve PDF’leri tek, düzenli PDF’e çevirir | yazar: @azimov_7",
  ar: "📄 يحوّل الصور وملفات PDF إلى ملف PDF منسق واحد | بواسطة @azimov_7",

  ko: "📄 이미지와 PDF를 하나의 깔끔한 PDF로 변환 | 제작: @azimov_7",
  it: "📄 Converte immagini e PDF in un unico PDF ordinato | autore: @azimov_7",

  hi: "📄 इमेज और PDF को एक साफ़ PDF में बदलता है | लेखक: @azimov_7",
  fa: "📄 تصاویر و PDFها را به یک PDF مرتب تبدیل می‌کند | نویسنده: @azimov_7",

  zh: "📄 将图片和 PDF 合成为一个整洁的 PDF | 作者：@azimov_7",
  ja: "📄 画像とPDFを一つの整ったPDFに変換 | 作者: @azimov_7",
};

const fullDescriptions = {
  en: `
📄 This bot converts your images and PDFs into a clean, ordered PDF.

✨ Features:
• Upload images → get a single PDF
• Change page order (/list, /swap, /move)
• Rotate, remove, rename pages
• Set quality, page size, and background
• Merge multiple PDF files into one
• Multi-language support
`.trim(),

  uz: `
📄 Ushbu bot rasmlar va PDF fayllaringizdan tartibli, chiroyli PDF yaratadi.

✨ Imkoniyatlar:
• Rasmlarni yuboring → yagona PDF hosil bo‘ladi
• Tartibni o‘zgartirish (/list, /swap, /move)
• O‘chirish, aylantirish, qayta nomlash
• Sifat va sahifa o‘lchamini tanlash
• Bir nechta PDF faylni bitta PDFga birlashtirish
• Ko‘p tilli qo‘llab-quvvatlash
`.trim(),

  ru: `
📄 Бот собирает ваши изображения и PDF в один чистый, аккуратный PDF.

✨ Возможности:
• Загружайте изображения → получите один PDF
• Меняйте порядок страниц (/list, /swap, /move)
• Удаление, вращение, переименование страниц
• Настройка качества, размера страницы и фона
• Объединение нескольких PDF в один
• Поддержка нескольких языков
`.trim(),

  es: `
📄 Este bot convierte tus imágenes y PDFs en un único PDF limpio y ordenado.

✨ Funciones:
• Envía imágenes → obtén un PDF
• Cambia el orden de páginas (/list, /swap, /move)
• Rotar, eliminar y renombrar páginas
• Ajustar calidad, tamaño y fondo
• Unir varios PDFs en uno solo
• Soporte multilingüe
`.trim(),

  de: `
📄 Dieser Bot erstellt aus deinen Bildern und PDFs ein sauberes, geordnetes PDF.

✨ Funktionen:
• Bilder hochladen → ein einzelnes PDF erhalten
• Seitenreihenfolge ändern (/list, /swap, /move)
• Seiten drehen, löschen, umbenennen
• Qualität, Seitengröße und Hintergrund ändern
• Mehrere PDFs zu einem zusammenführen
• Mehrsprachige Unterstützung
`.trim(),

  fr: `
📄 Ce bot transforme vos images et PDFs en un PDF propre et bien organisé.

✨ Fonctionnalités :
• Envoyez des images → obtenez un seul PDF
• Modifiez l’ordre des pages (/list, /swap, /move)
• Faire pivoter, supprimer, renommer des pages
• Régler qualité, taille de page et arrière-plan
• Fusionner plusieurs PDFs en un seul
• Support multilingue
`.trim(),

  tr: `
📄 Bu bot, görselleri ve PDF dosyalarını tek bir düzenli PDF hâline getirir.

✨ Özellikler:
• Görselleri yükleyin → tek bir PDF alın
• Sayfa sırasını değiştirin (/list, /swap, /move)
• Döndürme, silme, yeniden adlandırma
• Kalite, sayfa boyutu ve arka plan ayarı
• Birden fazla PDF’i birleştirme
• Çoklu dil desteği
`.trim(),

  ar: `
📄 هذا البوت يحوّل الصور وملفات PDF إلى ملف PDF واحد منسق ومرتب.

✨ الميزات:
• أرسل الصور → تحصل على ملف PDF واحد
• تغيير ترتيب الصفحات (/list, /swap, /move)
• تدوير، حذف، وإعادة تسمية الصفحات
• التحكم بالجودة، حجم الصفحة، والخلفية
• دمج عدة ملفات PDF في ملف واحد
• دعم عدة لغات
`.trim(),

  ko: `
📄 이 봇은 이미지와 PDF를 하나의 깔끔하고 정렬된 PDF로 만들어 줍니다.

✨ 기능:
• 이미지를 보내면 → 하나의 PDF 생성
• /list, /swap, /move 로 페이지 순서 변경
• 페이지 회전, 삭제, 이름 변경
• 품질, 페이지 크기, 배경 설정
• 여러 PDF 파일을 하나로 병합
• 다국어 지원
`.trim(),

  it: `
📄 Questo bot trasforma le tue immagini e i tuoi PDF in un unico PDF ordinato e pulito.

✨ Funzioni:
• Invia immagini → ottieni un solo PDF
• Cambia l’ordine delle pagine (/list, /swap, /move)
• Ruotare, eliminare e rinominare pagine
• Impostare qualità, formato pagina e sfondo
• Unire più PDF in uno solo
• Supporto multilingue
`.trim(),

  hi: `
📄 यह बॉट आपकी इमेज और PDF को एक साफ़, व्यवस्थित PDF में बदल देता है।

✨ फीचर्स:
• इमेज भेजें → एक PDF प्राप्त करें
• पेज क्रम बदलें (/list, /swap, /move)
• पेज घुमाएँ, हटाएँ, नाम बदलें
• गुणवत्ता, पेज साइज़ और बैकग्राउंड चुनें
• कई PDF को एक में मिलाएँ
• मल्टी-लैंग्वेज सपोर्ट
`.trim(),

  fa: `
📄 این بات تصاویر و فایل‌های PDF شما را به یک فایل PDF مرتب و منظم تبدیل می‌کند.

✨ امکانات:
• با ارسال تصاویر یک PDF واحد بسازید
• تغییر ترتیب صفحات (/list، /swap، /move)
• چرخاندن، حذف و تغییر نام صفحات
• تنظیم کیفیت، اندازه صفحه و پس‌زمینه
• ادغام چندین PDF در یک فایل
• پشتیبانی از چند زبان
`.trim(),

  zh: `
📄 这个机器人可以把你的图片和 PDF 合成为一个整洁、有序的 PDF 文件。

✨ 功能：
• 发送图片 → 生成一个 PDF
• 调整页面顺序（/list, /swap, /move）
• 旋转、删除、重命名页面
• 设置质量、页面大小和背景
• 将多个 PDF 合并为一个
• 支持多种语言
`.trim(),

  ja: `
📄 このボットは、画像やPDFを一つのきれいに整理されたPDFファイルにまとめます。

✨ 機能:
• 画像を送信 → 1つのPDFを作成
• /list /swap /move でページ順を変更
• ページの回転・削除・名前変更
• 品質・ページサイズ・背景の設定
• 複数PDFを1つに結合
• 複数言語に対応
`.trim(),
};

// ---------- API CALL HELPER ----------

async function call(method, body) {
  const lang = body.language_code || "default";

  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log(method, lang, data);

    if (!data.ok) {
      console.error("Telegram API error for", method, lang, data);
    }
  } catch (err) {
    console.error(`Network error for ${method} ${lang}:`, err.message);
    // do NOT throw, so the loop can continue
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- MAIN ----------

(async () => {
  // 1) Language-specific short descriptions
  for (const [lang, text] of Object.entries(shortDescriptions)) {
    await call("setMyShortDescription", {
      short_description: text,
      language_code: lang,
    });
    await sleep(200); // 0.2s pause
  }

  // 2) Default short description (for unsupported languages) -> English
  await call("setMyShortDescription", {
    short_description: shortDescriptions.en,
  });

  // 3) Language-specific full descriptions
  for (const [lang, text] of Object.entries(fullDescriptions)) {
    await call("setMyDescription", {
      description: text,
      language_code: lang,
    });
    await sleep(200); // 0.2s pause
  }

  // 4) Default full description (for unsupported languages) -> English
  await call("setMyDescription", {
    description: fullDescriptions.en,
  });

  console.log("All descriptions updated.");
})();
