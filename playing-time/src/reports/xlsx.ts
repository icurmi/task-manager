import { Capacitor } from '@capacitor/core';
import { fmtClock, minutesOf } from '../domain/clock';
import type { ReportRow } from '../domain/stats';
import type { Match, Player, PlayingInterval } from '../domain/types';

export const REPORT_COLUMNS = [
  'Player', 'Team', 'Called Up', 'Starts', 'Appearances', 'Minutes', 'Available Minutes', '% Played',
] as const;

export interface ExportOptions {
  title: string;
  subtitle?: string;
  filename: string;
  /** Include an "Intervals" sheet with every ON/OFF for these matches (audit trail). */
  matches?: { match: Match; intervals: PlayingInterval[]; players: Player[] }[];
}

export async function buildWorkbook(rows: ReportRow[], opts: ExportOptions): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Player's Playing Time";
  wb.created = new Date();

  const ws = wb.addWorksheet('Playing time', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.addRow([opts.title]).font = { bold: true, size: 14 };
  ws.addRow([opts.subtitle ?? '']).font = { italic: true, color: { argb: 'FF666666' } };
  const head = ws.addRow([...REPORT_COLUMNS]);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F3A' } };
  });
  for (const r of rows) {
    ws.addRow([r.player, r.team, r.calledUp, r.starts, r.appearances, r.minutes, r.availableMinutes, r.pctPlayed]);
  }
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 12;
  for (let c = 3; c <= 7; c++) ws.getColumn(c).width = c === 7 ? 18 : 12;
  ws.getColumn(8).width = 11;
  ws.getColumn(8).numFmt = '0%';
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: REPORT_COLUMNS.length } };

  if (opts.matches?.length) {
    const iv = wb.addWorksheet('Intervals');
    const h = iv.addRow(['Match', 'Date', 'Player', 'ON', 'OFF', 'Minutes']);
    h.font = { bold: true };
    for (const { match, intervals, players } of opts.matches) {
      const pm = new Map(players.map((p) => [p.id, p]));
      for (const i of [...intervals].sort((a, b) => (pm.get(a.playerId)?.lastName ?? '').localeCompare(pm.get(b.playerId)?.lastName ?? '') || a.onMs - b.onMs)) {
        const p = pm.get(i.playerId);
        iv.addRow([
          match.opponent || 'Match', new Date(match.kickoffAt ?? match.createdAt).toLocaleDateString(),
          p ? `${p.firstName} ${p.lastName}` : '?', fmtClock(i.onMs), fmtClock(i.offMs), minutesOf(i.offMs - i.onMs),
        ]);
      }
    }
    iv.columns.forEach((c, idx) => (c.width = [22, 12, 26, 8, 8, 9][idx]));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function exportReport(rows: ReportRow[], opts: ExportOptions) {
  const buf = await buildWorkbook(rows, opts);
  const name = `${opts.filename.replace(/[^\w.-]+/g, '-')}.xlsx`;
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const res = await Filesystem.writeFile({ path: name, data: toBase64(buf), directory: Directory.Cache });
    await Share.share({ title: opts.title, url: res.uri });
    return;
  }
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
