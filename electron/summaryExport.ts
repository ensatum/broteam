import { dialog, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { shiftIsoDate, isoDate, type SummaryPeriod, type SummaryReport, type SummaryRow } from '../shared/summary';

type Report = SummaryReport & { reportNote?: string; issueNotes?: Record<string, string> };

export async function exportSummary(
  win: BrowserWindow | null,
  format: 'xlsx' | 'docx',
  report: Report,
): Promise<{ ok: true; path: string } | { ok: false; reason: 'cancelled' }> {
  const excel = format === 'xlsx';
  const ext = excel ? 'xlsx' : 'docx';
  const options = {
    title: excel ? 'Экспорт в Excel' : 'Экспорт в Word',
    defaultPath: exportFileName(report, ext),
    filters: [{ name: excel ? 'Excel' : 'Word', extensions: [ext] }],
  };
  const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (picked.canceled || !picked.filePath) return { ok: false, reason: 'cancelled' };
  let filePath = picked.filePath;
  if (!filePath.toLowerCase().endsWith(`.${ext}`)) filePath += `.${ext}`;
  const body = excel ? toExcel(report) : toWord(report);
  fs.writeFileSync(filePath, body);
  return { ok: true, path: filePath };
}

function exportFileName(report: Report, ext: string): string {
  const name = translit(report.participantName.trim() || 'Все');
  const bounds = periodDates(report.period);
  return `brief__${name}__${compactDate(bounds.from)}_-_${compactDate(bounds.to)}__${compactStamp(new Date())}.${ext}`;
}

function periodDates(period: SummaryPeriod): { from: string; to: string } {
  if (period.kind === 'custom') {
    const from = period.from <= period.to ? period.from : period.to;
    const to = period.from <= period.to ? period.to : period.from;
    return { from, to };
  }
  const days = period.id === 'day' ? 1 : period.id === 'week' ? 7 : period.id === 'month' ? 30 : 90;
  const today = isoDate(new Date());
  const back = days === 1 ? 1 : days - 1;
  return { from: shiftIsoDate(today, -back), to: today };
}

function compactDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[1]}${match[2]}${match[3]}` : '00000000';
}

function compactStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function translit(value: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const slug = value
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'vse';
}

type SheetCell = { kind: 'text'; value: string; header?: boolean } | { kind: 'date'; value: number | null } | { kind: 'number'; value: number };

const DATE_COLUMNS = new Set([6, 7, 8, 9, 14, 16, 17]);

function toExcel(report: Report): Buffer {
  const headers = [
    'Задача',
    'Название',
    'Исполнитель',
    'Ревьюер',
    'Тестировщик',
    'Автор',
    'Создана',
    'Взята',
    'Завершена',
    'Получена',
    'Статус при получении',
    'Спринт при получении',
    'Спринт сейчас',
    'Статус сейчас',
    'Дата статуса',
    'Комментарии',
    'Первый комментарий',
    'Последний комментарий',
    'Время по колонкам',
    'Заметка',
  ];
  const rows: SheetCell[][] = [
    [text('Сводка'), text(report.participantName)],
    [text('Сформирована'), dateCell(report.formedAt)],
    [text('Заметка'), text(report.reportNote || '')],
    [text('Запросов к API'), { kind: 'number', value: report.requests }],
    headers.map((header) => text(header, true)),
    ...report.rows.map((row) => excelRow(row, report.issueNotes?.[row.key] || '')),
  ];
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes('xlsx') },
    { name: '_rels/.rels', data: packageRels('xl/workbook.xml') },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Сводка" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', data: excelStyles() },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows) },
  ]);
}

function excelRow(row: SummaryRow, note: string): SheetCell[] {
  const values: Array<string | number | null> = [
    row.key,
    row.summary,
    listed(row.assignees, row.assignee),
    listed(row.reviewers, row.reviewer),
    listed(row.qas, row.qa),
    row.author || '—',
    row.createdAt,
    row.takenAt || row.receivedAt,
    row.finalStatusAt,
    row.receivedAt,
    row.receivedStatus,
    row.receivedSprint,
    row.currentSprint,
    row.currentStatus,
    row.currentStatusAt,
    row.commentCount,
    row.firstCommentAt,
    row.lastCommentAt,
    row.columns.map((column) => `${column.label} — ${formatStay(column)}`).join('\n'),
    note,
  ];
  return values.map((value, index) => {
    if (DATE_COLUMNS.has(index)) return dateCell(typeof value === 'string' ? value : null);
    if (typeof value === 'number') return { kind: 'number', value };
    return text(value == null ? '' : String(value));
  });
}

function toWord(report: Report): Buffer {
  const blocks = report.rows.flatMap((row) => {
    const note = report.issueNotes?.[row.key] || '';
    const sprints = sprintLine(row);
    return [
      paragraph(`${row.key}  ${row.summary}`, { heading: true }),
      factTable([
        ['Исполнитель', listed(row.assignees, row.assignee)],
        ['Тестировщик', listed(row.qas, row.qa)],
        ['Ревьюер', listed(row.reviewers, row.reviewer)],
        ['Автор', row.author || '—'],
        ['Создана', showDate(row.createdAt)],
        ['Взята', showDate(row.takenAt || row.receivedAt)],
        ['Завершена', showDate(row.finalStatusAt)],
        ['Сейчас', `${row.currentStatus || '—'}, с ${showDate(row.currentStatusAt)}`],
        ['Получена', `${showDate(row.receivedAt)}, ${row.receivedStatus || '—'}, ${row.receivedSprint || '—'}`],
        ['Комментарии', `${row.commentCount}, ${showDate(row.firstCommentAt)} — ${showDate(row.lastCommentAt)}`],
      ]),
      timeTable(row),
      sprints ? paragraph(sprints) : '',
      note.trim() ? paragraph(`Заметка: ${note}`) : '',
      paragraph(''),
    ];
  });
  const intro: Array<[string, string]> = [
    ['Участник', report.participantName],
    ['Сформирована', showDate(report.formedAt)],
    ['Запросов к API', String(report.requests)],
  ];
  if (report.reportNote?.trim()) intro.push(['Заметка', report.reportNote.trim()]);
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraph('Сводка', { title: true })}
${factTable(intro)}
${paragraph('')}
${blocks.join('')}
<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
</w:sectPr>
</w:body>
</w:document>`;
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes('docx') },
    { name: '_rels/.rels', data: packageRels('word/document.xml') },
    { name: 'word/document.xml', data: document },
  ]);
}

function timeTable(row: SummaryRow): string {
  if (!row.columns.length) return '';
  const body = row.columns
    .map((column, index) => {
      const bold = emphasizeColumn(row, column.kind) ? '<w:b/>' : '';
      const shade = index % 2 === 1 ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : '';
      const run = `<w:rPr>${bold}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;
      return `<w:tr>
<w:tc>
<w:tcPr><w:tcW w:w="4200" w:type="dxa"/>${shade}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="200" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>
<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r>${run}<w:t xml:space="preserve">${xml(column.label)}</w:t></w:r></w:p>
</w:tc>
<w:tc>
<w:tcPr><w:tcW w:w="2800" w:type="dxa"/>${shade}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tcMar></w:tcPr>
<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r>${run}<w:t xml:space="preserve">${xml(formatStay(column))}</w:t></w:r></w:p>
</w:tc>
</w:tr>`;
    })
    .join('');
  return `<w:p><w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr></w:p>
<w:tbl>
<w:tblPr><w:tblW w:w="7000" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>${nilBorders()}</w:tblPr>
<w:tblGrid><w:gridCol w:w="4200"/><w:gridCol w:w="2800"/></w:tblGrid>
${body}
</w:tbl>
<w:p><w:pPr><w:spacing w:before="120" w:after="80"/></w:pPr></w:p>`;
}

function factTable(pairs: Array<[string, string]>): string {
  return `<w:tbl>
<w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:jc w:val="left"/><w:tblLayout w:type="fixed"/>${nilBorders()}</w:tblPr>
<w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="7160"/></w:tblGrid>
${pairs.map(([label, value]) => factRow(label, value)).join('')}
</w:tbl>`;
}

function factRow(label: string, value: string): string {
  const labelRun = `<w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr><w:t xml:space="preserve">${xml(label)}</w:t></w:r>`;
  const valueRun = `<w:r><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr><w:t xml:space="preserve">${xml(value || '—')}</w:t></w:r>`;
  const para = (body: string) =>
    `<w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>${body}</w:p>`;
  return `<w:tr>
<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr>${para(labelRun)}</w:tc>
<w:tc><w:tcPr><w:tcW w:w="7160" w:type="dxa"/></w:tcPr>${para(valueRun)}</w:tc>
</w:tr>`;
}

function nilBorders(): string {
  const edge = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>';
  return `<w:tblBorders>${edge}</w:tblBorders>`;
}

function emphasizeColumn(row: SummaryRow, kind: SummaryRow['columns'][number]['kind']): boolean {
  if (row.emphasizeTesting && kind === 'testing') return true;
  if (row.emphasizeWork && kind === 'work') return true;
  if (row.emphasizeReview && kind === 'review') return true;
  return false;
}

function formatStay(column: SummaryRow['columns'][number]): string {
  const hours = Math.max(0, Math.round(column.ms / 3_600_000));
  const days = Math.floor(hours / 24);
  return `${days} дней ${hours - days * 24} часов`;
}

function listed(list: string[] | undefined, fallback: string): string {
  const names = (list || []).map((name) => name.trim()).filter((name) => name && name !== '—');
  if (names.length) return names.join(', ');
  const single = fallback.trim();
  return single && single !== '—' ? single : '—';
}

function sprintLine(row: SummaryRow): string {
  const source = row.sprints?.length ? row.sprints : [row.receivedSprint, row.currentSprint];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of source) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '—' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    names.push(trimmed);
  }
  return names.length ? `Спринты: ${names.join(', ')}` : '';
}

function text(value: string, header = false): SheetCell {
  return { kind: 'text', value, header };
}

function dateCell(value: string | null | undefined): SheetCell {
  return { kind: 'date', value: excelSerial(value) };
}

function excelSerial(value: string | null | undefined): number | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const utc = dateOnly
    ? Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : localUtc(value);
  if (utc == null) return null;
  return (utc - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function localUtc(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes());
}

function sheetXml(rows: SheetCell[][]): string {
  const widths = [18, 42, 22, 22, 22, 22, 18, 18, 18, 18, 22, 20, 20, 18, 18, 14, 18, 18, 42, 28];
  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('');
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => cellXml(cell, `${columnLetters(columnIndex)}${rowIndex + 1}`))
        .join('');
      const lines = Math.max(...row.map((cell) => (cell.kind === 'text' ? cell.value.split('\n').length : 1)));
      const height = lines > 1 ? ` ht="${Math.min(240, 15 * lines)}" customHeight="1"` : '';
      return `<row r="${rowIndex + 1}"${height}>${cells}</row>`;
    })
    .join('');
  const header = rows.findIndex((row) => row.some((cell) => cell.kind === 'text' && cell.header));
  const freeze = header >= 0 ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header + 1}" topLeftCell="A${header + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${header + 2}" sqref="A${header + 2}"/></sheetView></sheetViews>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${freeze}
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
</worksheet>`;
}

function cellXml(cell: SheetCell, ref: string): string {
  if (cell.kind === 'date') {
    if (cell.value == null) return '';
    return `<c r="${ref}" s="1"><v>${cell.value.toFixed(8)}</v></c>`;
  }
  if (cell.kind === 'number') return `<c r="${ref}"><v>${cell.value}</v></c>`;
  const wrapped = cell.value.includes('\n');
  const style = cell.header ? ' s="2"' : wrapped ? ' s="3"' : '';
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value).replace(/\n/g, '&#10;')}</t></is></c>`;
}

function excelStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function contentTypes(kind: 'xlsx' | 'docx'): string {
  const extra =
    kind === 'xlsx'
      ? `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      : `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${extra}
</Types>`;
}

function packageRels(target: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>
</Relationships>`;
}

function paragraph(text: string, opts?: { heading?: boolean; title?: boolean }): string {
  const size = opts?.title ? 36 : opts?.heading ? 28 : 22;
  const bold = opts?.title || opts?.heading ? '<w:b/>' : '';
  return `<w:p><w:r><w:rPr>${bold}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function formatExportDate(value: string | null | undefined): string {
  if (!value) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} 00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showDate(value: string | null | undefined): string {
  return formatExportDate(value) || '—';
}

function columnLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function zipStore(entries: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localFull = Buffer.concat([local, name, compressed]);
    locals.push(localFull);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localFull.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}
