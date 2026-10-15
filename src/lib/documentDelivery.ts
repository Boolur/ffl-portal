export function documentDisposition(name: string, download: boolean) {
  const safeName = name.replace(/[\r\n\x00-\x1f\x7f/\\]/g, '_');
  const fallback = safeName.replace(/[^\x20-\x7e]|[";]/g, '_');
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function populateDocumentDrag(transfer: DataTransfer, file: File, url: string) {
  transfer.effectAllowed = 'copy';
  transfer.clearData();
  // Provide real bytes to compatible web upload targets, with Chrome's download
  // descriptor for supported desktop destinations. Never offer a text/link fallback.
  try { transfer.items.add(file); } catch { /* Native DownloadURL may still work. */ }
  transfer.setData('DownloadURL', `${file.type}:${file.name.replace(/[:\r\n]/g, '_')}:${url}`);
}
