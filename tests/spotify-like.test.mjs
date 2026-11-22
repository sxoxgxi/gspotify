// Run: node --experimental-vm-modules tests/spotify-like.test.mjs
// All GI services are replaced: no network, keyring or GNOME session access.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function harness({ token = 'test-token', refresh = null } = {}) {
  const requests = [], replies = [], stores = [], signals = new Map();
  let signalId = 0, clientId = 'test-client';
  const secrets = { access_token: token ? JSON.stringify({ token, expiresAt: Date.now() + 3600000 }) : null, refresh_token: refresh };
  const settings = {
    get_string: () => clientId, get_int: () => 9000,
    connect: (name, callback) => { signals.set(++signalId, { name, callback }); return signalId; },
    disconnect: id => signals.delete(id),
  };
  const Secret = {
    Schema: class {}, SchemaFlags: { NONE: 0 }, SchemaAttributeType: { STRING: 0 },
    password_lookup: (_s, attrs, _c, cb) => cb(null, secrets[Object.keys(attrs)[0]]),
    password_lookup_finish: result => result,
    password_store: (_s, attrs, _collection, _label, value, _c, cb) => {
      stores.push(value); secrets[Object.keys(attrs)[0]] = value; cb(null, true);
    },
    password_store_finish: value => value,
  };
  const Soup = {
    Message: { new: (method, url) => ({
      method, url, headers: {}, status: null,
      get_request_headers() { return { append: (k, v) => { this.headers[k] = v; } }; },
      set_request_body_from_bytes(_type, bytes) { this.body = new TextDecoder().decode(bytes.data); },
      get_status() { return this.status; },
      get_response_headers() { return { get_one: () => this.retryAfter }; },
    }) },
    Session: class {
      send_and_read_async(msg, _priority, _cancel, cb) {
        requests.push(msg);
        const reply = replies.shift();
        assert.ok(reply, `Unexpected request: ${msg.method} ${msg.url}`);
        msg.status = reply.status ?? 200; msg.retryAfter = reply.retryAfter ?? null;
        const finish = () => cb(this, reply);
        if (reply.defer) reply.defer(finish); else finish();
      }
      send_and_read_finish(reply) {
        if (reply.network) throw new Error('simulated network error');
        return { get_data: () => new TextEncoder().encode(reply.body ?? '') };
      }
      abort() {}
    },
  };
  const context = vm.createContext({ TextEncoder, TextDecoder, Date, console });
  const modules = new Map();
  const mocks = {
    'gi://Soup': { default: Soup },
    'gi://GLib': { default: { PRIORITY_DEFAULT: 0, Bytes: class { constructor(data) { this.data = data; } } } },
    'gi://Secret': { default: Secret },
    './utils.js': { logInfo() {}, logWarn() {}, logError() {}, buildQueryString() {}, toggleSpotifyWindow() {} },
    './constants.js': { INFO_TIPS: [] },
  };
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let mod;
    if (mocks[name] || name.startsWith('gi://')) {
      const values = mocks[name] || { default: {} };
      mod = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    } else {
      mod = new vm.SourceTextModule(await readFile(new URL(`../${name.slice(2)}`, import.meta.url), 'utf8'), { context, identifier: name });
    }
    modules.set(name, mod);
    await mod.link(load);
    return mod;
  }
  const authModule = await load('./spotify-auth.js'); await authModule.evaluate();
  const auth = authModule.namespace; auth.initializeAuth(settings);
  const helperModule = await load('./spotify-helper.js'); await helperModule.evaluate();
  const uiModule = await load('./spotui.js'); await uiModule.evaluate();
  const ui = Object.create(uiModule.namespace.SpotifyUI.prototype);
  Object.assign(ui, {
    _currentTrackId: 'A', _likeRevision: 0, _likeBusy: false, _destroyed: false,
    _isLiked: true, _isSpotifyConnected: false, _likeButton: { reactive: true },
    messages: [], icons: [],
    _extension: { sendOSDMessage(message) { ui.messages.push(message); } },
    _updateLikeButtonIcon() { this.icons.push(this._isLiked); },
  });
  for (const name of ['_updateText', '_updateProgress', '_updatePlayState', '_updateArtwork', '_updateShuffleButton']) ui[name] = () => {};
  return { auth, helper: helperModule.namespace, ui, replies, requests, stores, secrets, signals, settings,
    setClient(value) { clientId = value; for (const { callback } of signals.values()) callback(); } };
}

for (const liked of [false, true]) {
  test(`toggle ${liked ? 'Unlike' : 'Like'} uses library URI and empty success response`, async () => {
    const h = await harness();
    h.replies.push({ body: JSON.stringify([liked]) }, {});
    assert.equal(await h.helper.toggleLike('A'), !liked);
    assert.deepEqual(h.requests.map(r => r.method), ['GET', liked ? 'DELETE' : 'PUT']);
    assert.equal(h.requests[0].url, 'https://api.spotify.com/v1/me/library/contains?uris=spotify%3Atrack%3AA');
    assert.equal(h.requests[1].url, 'https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3AA');
    assert.equal(h.requests[1].body, undefined);
  });
}

test('missing token makes no HTTP requests or token stores', async () => {
  const h = await harness({ token: null });
  await assert.rejects(h.helper.toggleLike('A'), { code: 'not-authenticated' });
  assert.equal(h.requests.length, 0); assert.equal(h.stores.length, 0);
});

for (const [reply, code] of [
  [{ status: 400 }, 'http'], [{ status: 401 }, 'unauthorized'],
  [{ status: 403, body: '{"error":{"message":"sensitive detail"}}' }, 'forbidden'],
  [{ status: 429, retryAfter: '30' }, 'rate-limited'], [{ status: 500 }, 'http'],
  [{ network: true }, 'network'], [{ body: 'invalid' }, 'invalid-response'],
  [{ body: '{}' }, 'invalid-response'], [{ body: '[null]' }, 'invalid-response'],
]) {
  test(`query failure ${code}/${reply.status ?? reply.body ?? 'network'} never writes`, async () => {
    const h = await harness(); h.replies.push(reply);
    await assert.rejects(h.helper.toggleLike('A'), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('sensitive detail'));
      if (reply.status === 429) assert.equal(error.retryAfter, '30');
      return true;
    });
    assert.equal(h.requests.length, 1);
  });
}

for (const status of [401, 403, 429, 500]) {
  test(`write HTTP ${status} preserves icon and gives appropriate message`, async () => {
    const h = await harness(); h.replies.push({ body: '[false]' }, { status });
    await h.ui._onLikeButtonClicked();
    assert.equal(h.ui._isLiked, true); assert.equal(h.ui.icons.length, 0);
    assert.equal(h.ui._likeButton.reactive, true);
    assert.match(h.ui.messages[0], status === 500 ? /Try again/ : new RegExp(String(status)));
  });
}

test('login after UI creation permits click despite old disconnected flag', async () => {
  const h = await harness({ token: null });
  await h.ui._onLikeButtonClicked(); assert.equal(h.requests.length, 0);
  h.secrets.access_token = JSON.stringify({ token: 'new-test-token', expiresAt: Date.now() + 3600000 });
  h.replies.push({ body: '[false]' }, {});
  await h.ui._onLikeButtonClicked();
  assert.equal(h.ui._isLiked, true); assert.equal(h.ui._isSpotifyConnected, true);
  assert.equal(h.requests.length, 2);
});

test('same track refreshes status after connecting', async () => {
  const h = await harness({ token: null });
  h.secrets.access_token = JSON.stringify({ token: 'new-test-token', expiresAt: Date.now() + 3600000 });
  h.replies.push({ body: '[false]' });
  await h.ui.update({ success: true, url: 'spotify:track:A' });
  assert.equal(h.ui._isLiked, false); assert.equal(h.requests.length, 1);
});

test('query refusal preserves visual state', async () => {
  const h = await harness(); h.replies.push({ status: 403 });
  await h.ui._checkLikeStatus();
  assert.equal(h.ui._isLiked, true); assert.equal(h.ui.icons.length, 0);
});

test('out of order track queries do not overwrite current track', async () => {
  const h = await harness(); let finish;
  h.replies.push({ body: '[true]', defer: callback => { finish = callback; } });
  const first = h.ui._checkLikeStatus();
  while (!finish) await Promise.resolve();
  h.ui._currentTrackId = 'B'; h.ui._likeRevision++;
  h.replies.push({ body: '[false]' }); await h.ui._checkLikeStatus();
  finish(); await first;
  assert.equal(h.ui._isLiked, false); assert.deepEqual(h.ui.icons, [false]);
});

test('track change during toggle and duplicate clicks cannot change new track icon', async () => {
  const h = await harness(); let finish;
  h.replies.push({ body: '[false]', defer: callback => { finish = callback; } }, {});
  const click = h.ui._onLikeButtonClicked();
  while (!finish) await Promise.resolve();
  await h.ui._onLikeButtonClicked();
  h.ui._currentTrackId = 'B'; h.ui._likeRevision++;
  finish(); await click;
  assert.equal(h.ui.icons.length, 0); assert.equal(h.ui.messages.length, 0);
  assert.equal(h.requests.length, 2);
});

test('destroyed UI ignores pending response', async () => {
  const h = await harness(); let finish;
  h.replies.push({ body: '[false]', defer: callback => { finish = callback; } });
  const pending = h.ui._checkLikeStatus();
  while (!finish) await Promise.resolve();
  h.ui._destroyed = true; h.ui._likeRevision++; finish(); await pending;
  assert.equal(h.ui.icons.length, 0);
});

test('auth initialization does not accumulate signals; cleanup disconnects all', async () => {
  const h = await harness(); assert.equal(h.signals.size, 2);
  h.auth.initializeAuth(h.settings); assert.equal(h.signals.size, 2);
  h.auth.cleanupSpotifyAuth(); assert.equal(h.signals.size, 0);
  h.auth.initializeAuth(h.settings); assert.equal(h.signals.size, 2);
});

test('refresh failure never stores invalid credentials or calls library', async () => {
  const h = await harness({ token: null, refresh: 'test-refresh' });
  h.replies.push({ status: 400, body: '{"error":"invalid_client"}' });
  await assert.rejects(h.helper.toggleLike('A'), { code: 'refresh-failed', status: 400 });
  assert.equal(h.stores.length, 0); assert.equal(h.requests.length, 1);
});

test('changed client ID is used for refresh', async () => {
  const h = await harness({ token: null, refresh: 'test-refresh' }); h.setClient('replacement-client');
  h.replies.push({ body: '{"access_token":"new-test-token","expires_in":3600}' });
  assert.equal(await h.auth.getValidAccessToken(), 'new-test-token');
  assert.match(h.requests[0].body, /client_id=replacement-client/);
});

for (const reply of [{ body: '{}' }, { body: 'invalid' }, { network: true }]) {
  test(`invalid refresh response ${JSON.stringify(reply)} never stores tokens`, async () => {
    const h = await harness({ token: null, refresh: 'test-refresh' });
    h.replies.push(reply);
    await assert.rejects(h.auth.getValidAccessToken());
    assert.equal(h.stores.length, 0);
  });
}

test('missing client ID prevents refresh request', async () => {
  const h = await harness({ token: null, refresh: 'test-refresh' }); h.setClient(' ');
  await assert.rejects(h.auth.getValidAccessToken(), { code: 'missing-client-id' });
  assert.equal(h.requests.length, 0);
});

test('cleanup invalidates pending refresh before token storage', async () => {
  const h = await harness({ token: null, refresh: 'test-refresh' }); let finish;
  h.replies.push({ body: '{"access_token":"test-token"}', defer: callback => { finish = callback; } });
  const pending = h.auth.getValidAccessToken();
  while (!finish) await Promise.resolve();
  h.auth.cleanupSpotifyAuth(); finish();
  await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(h.stores.length, 0);
});

for (const liked of [false, true]) {
  test(`successful UI ${liked ? 'Unlike' : 'Like'} updates icon only after write`, async () => {
    const h = await harness(); let finish;
    h.ui._isLiked = liked;
    h.replies.push({ body: JSON.stringify([liked]) }, { defer: callback => { finish = callback; } });
    const click = h.ui._onLikeButtonClicked();
    while (!finish) await Promise.resolve();
    assert.equal(h.ui._isLiked, liked); assert.equal(h.ui.icons.length, 0);
    finish(); await click;
    assert.equal(h.ui._isLiked, !liked); assert.deepEqual(h.ui.icons, [!liked]);
  });
}

test('no current track never makes requests', async () => {
  const h = await harness(); h.ui._currentTrackId = null;
  await h.ui._onLikeButtonClicked(); assert.equal(h.requests.length, 0);
});
