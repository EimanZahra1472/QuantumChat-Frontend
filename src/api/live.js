import client from './client.js';

// Thin wrappers over /api/live. Only stream metadata goes through here —
// video, comments and reactions travel peer-to-peer (see useLiveStream.js).

export async function startLive({ title, audience, record }) {
  const { data } = await client.post('/live', { title, audience, record });
  return data.data.stream;
}

export async function listLive() {
  const { data } = await client.get('/live');
  return data.data?.streams || [];
}

export async function getLive(id) {
  const { data } = await client.get(`/live/${id}`);
  return data.data.stream;
}

export async function joinLive(id) {
  const { data } = await client.post(`/live/${id}/join`);
  return data.data;
}

export async function leaveLive(id) {
  await client.post(`/live/${id}/leave`);
}

export async function heartbeatLive(id, connectedViewerIds) {
  const { data } = await client.post(`/live/${id}/heartbeat`, { connectedViewerIds });
  return data.data;
}

export async function inviteToLive(id, userIds) {
  const { data } = await client.post(`/live/${id}/invite`, { userIds });
  return data.data?.invited || [];
}

export async function removeLiveViewer(id, userId) {
  await client.post(`/live/${id}/remove`, { userId });
}

export async function endLive(id) {
  const { data } = await client.post(`/live/${id}/end`);
  return data.data.stream;
}

export async function setLiveRecordingDecision(id, decision) {
  await client.post(`/live/${id}/recording`, { decision });
}
