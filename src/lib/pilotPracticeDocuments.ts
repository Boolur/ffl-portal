import { validatePilotFile } from './submissionPilot';
import type { PracticeFile, PracticeItem } from './pilotPractice';

export function selectPracticeDocuments(items: PracticeItem[], files: PracticeFile[]) {
  const selected: Array<PracticeFile & { archivePath: string; categoryLabel: string }> = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const item of items) {
    if (item.review !== 'APPROVED' || files.some(file => file.itemId === item.id && !file.uploaded && !file.retired)) continue;
    for (const file of files.filter(value => value.itemId === item.id && value.uploaded && !value.retired)) {
      validatePilotFile(file.name, file.size, file.type);
      if (ids.has(file.id)) throw new Error('Duplicate practice document reference.');
      ids.add(file.id);
      let name = file.name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/g, '');
      if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(\.|$)/i.test(name)) name = `_${name}`;
      const dot = name.lastIndexOf('.');
      const extension = name.slice(dot);
      const base = name.slice(0, dot);
      name = `${base.slice(0, 200 - extension.length)}${extension}`;
      let candidate = name;
      let number = 1;
      while (names.has(candidate.normalize('NFKC').toLowerCase())) {
        const suffix = ` (${++number})`;
        candidate = `${base.slice(0, 200 - extension.length - suffix.length)}${suffix}${extension}`;
      }
      names.add(candidate.normalize('NFKC').toLowerCase());
      totalBytes += file.size;
      if (selected.length >= 300 || totalBytes > 200 * 1024 * 1024) throw new Error('Download All supports up to 300 practice files and 200 MB.');
      selected.push({ ...file, archivePath: candidate, categoryLabel: item.label });
    }
  }
  if (!selected.length) throw new Error('There are no approved practice documents to download.');
  return { filename: 'Practice-Approved-Documents.zip', totalBytes, files: selected };
}
