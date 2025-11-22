// src/telegram.js

/**
 * Build Telegram file download URL.
 */
function buildFileUrl(botToken, filePath) {
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
}

async function downloadTelegramFileToBuffer(fileUrl) {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  buildFileUrl,
  downloadTelegramFileToBuffer,
};
