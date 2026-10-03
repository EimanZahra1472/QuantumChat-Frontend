import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from 'vite';

test('shared DM and group decrypts survive one consumer aborting', async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

  const vite = await createServer({
    configFile: 'vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  try {
    const [clientModule, cache, keys] = await Promise.all([
      vite.ssrLoadModule('/src/api/client.js'),
      vite.ssrLoadModule('/src/crypto/voiceCache.js'),
      vite.ssrLoadModule('/src/crypto/keys.js'),
    ]);
    const client = clientModule.default;
    const previousAdapter = client.defaults.adapter;
    const dmBytes = new Uint8Array([1, 2, 3]);
    const groupBytes = new Uint8Array([4, 5, 6, 7]);
    const recipient = keys.generateKeyPair();
    const dm = keys.sealBytes(dmBytes, recipient.publicKey);
    const group = keys.secretboxSeal(groupBytes);
    const idPrefix = `abort-probe-${Date.now()}-${Math.random()}`;
    const dmId = `${idPrefix}-dm`;
    const groupId = `${idPrefix}-group`;

    client.defaults.adapter = async (config) => {
      assert.equal(config.signal, undefined);
      return {
        data: config.url.includes(dmId) ? dm.cipherBytes : group.cipherBytes,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    try {
      const dmArgs = {
        attachmentId: dmId,
        envelope: {
          nonce: dm.nonce,
          ephemeralPublicKey: dm.ephemeralPublicKey,
          targetPublicKey: recipient.publicKey,
        },
        secretKey: recipient.secretKey,
      };
      const dmController = new AbortController();
      const dmFirst = cache.resolveSealedAttachment({ ...dmArgs, signal: dmController.signal });
      dmController.abort();
      const dmSecond = cache.resolveSealedAttachment(dmArgs);
      const [firstDmResult, secondDmResult] = await Promise.all([dmFirst, dmSecond]);

      assert.deepEqual(new Uint8Array(await firstDmResult.blob.arrayBuffer()), dmBytes);
      assert.deepEqual(new Uint8Array(await secondDmResult.blob.arrayBuffer()), dmBytes);

      const groupArgs = {
        attachmentId: groupId,
        keyB64: group.key,
        nonce: group.nonce,
        openFn: keys.secretboxOpen,
      };
      const groupController = new AbortController();
      const groupFirst = cache.resolveGroupAttachment({ ...groupArgs, signal: groupController.signal });
      groupController.abort();
      const groupSecond = cache.resolveGroupAttachment(groupArgs);
      const [firstGroupResult, secondGroupResult] = await Promise.all([groupFirst, groupSecond]);

      assert.deepEqual(new Uint8Array(await firstGroupResult.blob.arrayBuffer()), groupBytes);
      assert.deepEqual(new Uint8Array(await secondGroupResult.blob.arrayBuffer()), groupBytes);
    } finally {
      client.defaults.adapter = previousAdapter;
      for (const id of [dmId, groupId]) {
        for (const key of cache.attachmentBlobCache.keys()) {
          if (key.startsWith(`${id}:`)) cache.attachmentBlobCache.delete(key);
        }
        for (const [key, url] of cache.attachmentUrlCache) {
          if (key.startsWith(`${id}:`)) {
            URL.revokeObjectURL(url);
            cache.attachmentUrlCache.delete(key);
          }
        }
      }
    }
  } finally {
    await vite.close();
  }
});