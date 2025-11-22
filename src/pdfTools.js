// src/pdfTools.js
const { PDFDocument } = require("pdf-lib");

/**
 * Merge multiple PDFs (given as Buffers) into one.
 * @param {Buffer[]} pdfBuffers
 * @returns {Promise<Buffer>} merged PDF buffer
 */
async function mergePdfs(pdfBuffers) {
  if (!Array.isArray(pdfBuffers) || pdfBuffers.length === 0) {
    throw new Error("No PDFs to merge");
  }

  const mergedPdf = await PDFDocument.create();

  for (const buf of pdfBuffers) {
    const srcDoc = await PDFDocument.load(buf);
    const srcPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
    srcPages.forEach((p) => mergedPdf.addPage(p));
  }

  const mergedBytes = await mergedPdf.save();
  return Buffer.from(mergedBytes);
}

module.exports = {
  mergePdfs,
};
