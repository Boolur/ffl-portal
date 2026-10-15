type StorageInfo = {
  data: { size?: unknown; contentType?: unknown; metadata?: Record<string, unknown> } | null;
  error: { status?: unknown; statusCode?: unknown } | null;
};

export function assertStoredUpload({ data, error }: StorageInfo, expected: { name: string; size: number; type: string }) {
  if (error) {
    const status = Number(error.statusCode ?? error.status);
    if (status === 404) throw new Error(`Uploaded file not found: ${expected.name}. Please upload it again.`);
    throw new Error(`Storage could not be reached to verify ${expected.name}. Keep this submission open and try again; you do not need to re-upload yet.`);
  }
  if (!data) throw new Error(`Uploaded file not found: ${expected.name}. Please upload it again.`);
  // info() returns top-level camelCase fields; older responses used metadata.
  const size = data.size ?? data.metadata?.size;
  const type = data.contentType ?? data.metadata?.mimetype;
  if (size === undefined || size === null || type === undefined || type === null) {
    throw new Error(`Storage returned incomplete file information for ${expected.name}. Keep this submission open and try again.`);
  }
  if (Number(size) !== expected.size || type !== expected.type) {
    throw new Error(`Uploaded file size or type does not match: ${expected.name}. Please upload it again.`);
  }
}
