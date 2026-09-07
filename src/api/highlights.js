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
  if (sourceStoryId) form.append('sourceStoryId', sourceStoryId);
  if (caption) form.append('caption', caption);
  if (durationMs != null) form.append('durationMs', String(durationMs));
  if (mediaType) form.append('mediaType', mediaType);
  const { data } = await client.post('/highlights/items', form);
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
