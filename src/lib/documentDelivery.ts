export function documentDisposition(name: string, download: boolean) {
  const safeName = name.replace(/[\r\n\x00-\x1f\x7f/\\]/g, '_');
  const fallback = safeName.replace(/[^\x20-\x7e]|[";]/g, '_');
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function populateDocumentDrag(transfer: DataTransfer, file: Pick<File, 'name' | 'type'>, url: string) {
  transfer.effectAllowed = 'copy';
  transfer.clearData();
  // Chrome can convert a synthetic File drag into filename text at native drag
  // boundaries. Offer only its download descriptor for supported desktop folders.
  // Website uploads and Outlook should use the downloaded file instead.
  try { transfer.setData('DownloadURL', `${file.type}:${file.name.replace(/[:\r\n]/g, '_')}:${url}`); }
  catch { throw new Error('This browser could not prepare the folder drag. Use the download icon, then attach the saved file.'); }
}
