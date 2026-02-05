// src/converter.js
const { PDFDocument, rgb, degrees } = require("pdf-lib");

// page sizes in points
const PAGE_SIZES = {
  auto: null,
  a4p: { width: 595.28, height: 841.89 }, // A4 portrait
  a4l: { width: 841.89, height: 595.28 }, // A4 landscape
  square: { width: 600, height: 600 },
};

function getBgColor(background) {
  switch (background) {
    case "black":
      return rgb(0, 0, 0);
    case "transparent":
      return null; // no rect; default viewer background
    case "white":
    default:
      return rgb(1, 1, 1);
  }
}

/**
 * images: array of { buffer, rotationDeg }
 * options: { quality: 'high'|'standard'|'light',
 *            pageSize: 'auto'|'a4p'|'a4l'|'square',
 *            background: 'white'|'black'|'transparent' }
 */
async function imagesToPdf(images, options = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("No images provided");
  }

  const quality = options.quality || "high";
  const pageSizeKey = options.pageSize || "auto";
  const background = options.background || "white";

  const pdfDoc = await PDFDocument.create();

  for (const imgObj of images) {
    const buffer = imgObj.buffer || imgObj;
    const rotationDeg = imgObj.rotationDeg || 0;

    let img;
    try {
      img = await pdfDoc.embedJpg(buffer);
    } catch {
      img = await pdfDoc.embedPng(buffer);
    }

    let { width, height } = img;

    // "quality" approximation by scaling down
    if (quality === "standard") {
      width *= 0.75;
      height *= 0.75;
    } else if (quality === "light") {
      width *= 0.5;
      height *= 0.5;
    }

    let pageWidth = width;
    let pageHeight = height;

    const preset = PAGE_SIZES[pageSizeKey];
    if (preset) {
      pageWidth = preset.width;
      pageHeight = preset.height;
    }

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    const bgColor = getBgColor(background);
    if (bgColor) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: bgColor,
      });
    }

    const normalizedRotation = ((rotationDeg % 360) + 360) % 360;
    const safeRotation = [0, 90, 180, 270].includes(normalizedRotation)
      ? normalizedRotation
      : 0;

    let drawWidth = width;
    let drawHeight = height;
    if (safeRotation === 90 || safeRotation === 270) {
      drawWidth = height;
      drawHeight = width;
    }

    let x = (pageWidth - drawWidth) / 2;
    let y = (pageHeight - drawHeight) / 2;

    if (safeRotation === 90) {
      x += drawWidth;
    } else if (safeRotation === 180) {
      x += drawWidth;
      y += drawHeight;
    } else if (safeRotation === 270) {
      y += drawHeight;
    }

    page.drawImage(img, {
      x,
      y,
      width,
      height,
      rotate: safeRotation ? degrees(safeRotation) : undefined,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  imagesToPdf,
};
