import client from './client.js';

export async function listHighlights(userId) {
  const { data } = await client.get('/highlights', {
    params: userId ? { userId } : undefined,
  });
  return data.data || [];
}

export async function getHighlight(id) {
  const { data } = await client.get(`/highlights/${id}`);
  return data.data;
}

export async function addHighlightItem({ category, file, sourceStoryId, caption, durationMs, mediaType }) {
  const form = new FormData();
  form.append('file', file);
  form.append('category', category);
  if (sourceStoryId) form.append('sourceStoryId', String(sourceStoryId));
  if (caption) form.append('caption', caption);
  if (durationMs != null) form.append('durationMs', String(durationMs));
  if (mediaType) form.append('mediaType', mediaType);
  const { data } = await client.post('/highlights/items', form, {
    // Let the browser set multipart boundary — do not force JSON content-type.
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: [
      (body, headers) => {
        if (body instanceof FormData) {
          delete headers['Content-Type'];
        }
        return body;
      },
    ],
  });
  return data.data;
}

export async function deleteHighlight(id) {
  const { data } = await client.delete(`/highlights/${id}`);
  return data.data;
}

export async function deleteHighlightItem(highlightId, itemId) {
  const { data } = await client.delete(`/highlights/${highlightId}/items/${itemId}`);
  return data.data;
}

export async function fetchHighlightCoverBlob(highlightId) {
  const { data } = await client.get(`/highlights/${highlightId}/cover`, {
    responseType: 'blob',
  });
  return data;
}

export async function fetchHighlightItemMediaBlob(highlightId, itemId) {
  const { data } = await client.get(`/highlights/${highlightId}/items/${itemId}/media`, {
    responseType: 'blob',
  });
  return data;
}
