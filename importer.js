'use strict';

// Reads a list of items from Excel (.xlsx), CSV, Word (.docx), PDF, RTF or plain text
// (an iPhone note shared as text). Same rules as the Mac app: in a table, the header
// row finds the name and category columns; in text, one item per line, a line ending
// in ":" names the category of the lines below it, and "name; category" sets one line's.

const NAME_HEADERS = ['nombre', 'name', 'item', 'items', 'articulo', 'equipo', 'descripcion'];
const CATEGORY_HEADERS = ['categoria', 'category', 'tipo', 'type'];
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';

async function readItemsFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'xlsx') return draftsFromRows(await xlsxRows(file));
  if (extension === 'csv') return draftsFromRows(csvRows(await file.text()));
  if (extension === 'docx') return draftsFromText(await docxText(file));
  if (extension === 'pdf') return draftsFromText(await pdfText(file));
  if (extension === 'rtf') return draftsFromText(rtfText(await file.text()));
  if (['txt', 'text', 'md', ''].includes(extension) || file.type.startsWith('text/')) return draftsFromText(await file.text());
  throw new Error(`OSKI no sabe leer archivos .${extension}. Usa Excel (.xlsx), CSV, Word (.docx), PDF o texto.`);
}

function fold(text) { return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

function stripListMarker(line) {
  return line.trim().replace(/^(?:[-–—•*·▪◦○●☐☑✓✔]\s*|\[[ xX]?\]\s*|\d+[.)]\s+)+/, '').trim();
}

function draftsFromText(text) {
  const drafts = [];
  let category = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = stripListMarker(raw);
    if (!line) continue;
    if (line.endsWith(':')) { category = line.slice(0, -1).trim(); continue; }
    const [name, lineCategory] = line.split(/[\t;|]/).map((part) => part.trim());
    if (name) drafts.push({ name, category: lineCategory || category });
  }
  return drafts;
}

function draftsFromRows(allRows) {
  const rows = allRows.map((row) => row.map((cell) => String(cell ?? '').trim())).filter((row) => row.some(Boolean));
  if (!rows.length) return [];
  const header = rows[0].map(fold);
  const nameColumn = header.findIndex((h) => NAME_HEADERS.includes(h));
  const categoryColumn = header.findIndex((h) => CATEGORY_HEADERS.includes(h));
  const hasHeader = nameColumn >= 0 || categoryColumn >= 0;
  const nameAt = nameColumn >= 0 ? nameColumn : (categoryColumn === 0 ? 1 : 0);
  const categoryAt = categoryColumn >= 0 ? categoryColumn : (hasHeader ? -1 : 1);
  return rows.slice(hasHeader ? 1 : 0).map((row) => {
    const name = row[nameAt] || '';
    const value = categoryAt >= 0 ? row[categoryAt] || '' : '';
    // A number in the second column is a quantity or a price, not a category.
    const category = value && Number.isNaN(Number(value.replace(',', '.'))) ? value : '';
    return { name, category };
  }).filter((draft) => draft.name);
}

function csvRows(text) {
  const lines = text.split(/\r?\n/);
  const separator = (lines[0] || '').includes(';') ? ';' : ',';
  return lines.map((line) => line.split(separator).map((cell) => cell.replace(/^[\s"]+|[\s"]+$/g, '')));
}

function rtfText(rtf) {
  let text = rtf.replace(/\\\r?\n/g, '\\par ').replace(/\r?\n/g, '');
  let previous;
  do { // drop font, colour and other non-text groups, innermost first
    previous = text;
    text = text.replace(/\{\\(?:\*|fonttbl|colortbl|stylesheet|info)[^{}]*\}/g, '');
  } while (text !== previous);
  return text
    .replace(/\\(?:par|line)\b ?/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(hex, 16)])))
    .replace(/\\u(-?\d+) ?\??/g, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536))
    .replace(/\\([{}\\])/g, '\u0000$1')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\u0000/g, '');
}

// ---------- zip (xlsx and docx are zip archives of XML files)

async function zipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('El archivo está dañado o no es un documento de Office.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = {};
  for (let i = 0; i < count; i += 1) {
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries[name] = { method, size, local };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return async (name) => {
    const entry = entries[name];
    if (!entry) return null;
    const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
    const data = bytes.subarray(start, start + entry.size);
    if (entry.method === 0) return new TextDecoder().decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

function xml(text) { return new DOMParser().parseFromString(text, 'application/xml'); }

async function xlsxRows(file) {
  const read = await zipEntries(file);
  const shared = [...xml((await read('xl/sharedStrings.xml')) || '<sst/>').getElementsByTagName('si')]
    .map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const sheet = await read('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('El Excel no tiene ninguna hoja que leer.');
  const column = (ref) => [...ref.replace(/\d/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return [...xml(sheet).getElementsByTagName('row')].map((row) => {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const value = type === 'inlineStr'
        ? [...c.getElementsByTagName('t')].map((t) => t.textContent).join('')
        : (c.getElementsByTagName('v')[0] || {}).textContent || '';
      cells[c.getAttribute('r') ? column(c.getAttribute('r')) : cells.length] = type === 's' ? shared[Number(value)] : value;
    }
    return Array.from(cells, (cell) => cell ?? '');
  });
}

/** Paragraphs one per line; a table row becomes "cell; cell" so its second cell is the category. */
async function docxText(file) {
  const read = await zipEntries(file);
  const doc = xml((await read('word/document.xml')) || '');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const text = (node) => [...node.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('');
  const lines = [];
  for (const node of doc.getElementsByTagNameNS(W, 'body')[0]?.children || []) {
    if (node.localName === 'p') lines.push(text(node));
    else if (node.localName === 'tbl') {
      for (const row of node.getElementsByTagNameNS(W, 'tr')) {
        lines.push([...row.getElementsByTagNameNS(W, 'tc')].map(text).join('; '));
      }
    }
  }
  return lines.join('\n');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar el lector de PDF. Comprueba la conexión.'));
    document.head.appendChild(script);
  });
}

/** Loads pdf.js on first use. With its worker loaded as a script, pdf.js runs it in the page. */
async function pdfText(file) {
  if (!window.pdfjsLib) {
    await loadScript(`${PDFJS}pdf.min.js`);
    await loadScript(`${PDFJS}pdf.worker.min.js`);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
  }
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const lines = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    let line = '';
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}
