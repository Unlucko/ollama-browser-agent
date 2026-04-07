// PDF text extraction using pdf.js
var pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('./pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
  return pdfjsLib;
}

async function extractPdfText(file) {
  var lib = await loadPdfJs();
  var arrayBuffer = await file.arrayBuffer();
  var pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  var pages = [];
  for (var i = 1; i <= pdf.numPages; i++) {
    var page = await pdf.getPage(i);
    var content = await page.getTextContent();
    var text = content.items.map(function(item) { return item.str; }).join(' ');
    pages.push(text);
  }
  return pages.join('\n\n--- Page Break ---\n\n');
}

async function extractFileText(file) {
  var name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    return await extractPdfText(file);
  }
  // Plain text files
  return await file.text();
}

window.extractFileText = extractFileText;
