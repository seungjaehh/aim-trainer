const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/skins/manifest.json')));
const champions = '9bf19b77-4b33-7203-9f2c-16932970622f';
const gaia = '000ad7b1-44b0-9345-ea47-9cbd7dcdbb38';
const hash = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');

function publicBrowser() {
  const fetched = [], played = [];
  class AudioContext {
    decodeAudioData(bytes) {
      assert.equal(Buffer.from(bytes).toString('ascii', 0, 4), 'RIFF');
      assert.equal(Buffer.from(bytes).toString('ascii', 8, 12), 'WAVE');
      return Promise.resolve({ id: hash(bytes) });
    }
    createBufferSource() { return { connect(gain) { return gain; }, start() { played.push(this.buffer.id); } }; }
    createGain() { return { gain: {}, connect() {} }; }
  }
  class Image {
    set src(value) { this.url = value; this.complete = true; this.naturalWidth = 1; }
  }
  const Aim = { cfg: { kill: 'skin', volume: .6 } };
  const sandbox = {
    window: { Aim, AudioContext }, location: { hostname: 'seungjaehh.github.io' }, Image,
    fetch: async (url) => {
      fetched.push(url);
      assert.ok(url.startsWith('assets/skins/'), 'Public site must fetch bundled assets without localhost');
      const bytes = fs.readFileSync(path.join(root, url.split('?')[0]));
      return { ok: true, json: async () => JSON.parse(bytes),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  };
  vm.createContext(sandbox);
  for (const file of ['skins.js', 'audio.js']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), sandbox);
  return { Aim, fetched, played };
}

test('published skin files are complete and preserve the prepared originals', () => {
  for (const entry of Object.values(manifest)) for (const name of [entry.gun, entry.kill, ...(entry.kills || [])].filter(Boolean)) {
    const published = fs.readFileSync(path.join(root, 'assets/skins', name));
    const original = path.join(root, 'local', name);
    if (fs.existsSync(original)) assert.equal(hash(published), hash(fs.readFileSync(original)));
    if (name.endsWith('.png')) assert.equal(published.toString('hex', 0, 8), '89504e470d0a1a0a');
  }
});

test('public origin loads the first-person image and plays recorded kills 1 through 5', async () => {
  const { Aim, played } = publicBrowser();
  const img = await Aim.skins.loadImage(champions);
  assert.equal(img.url, 'assets/skins/champions_vandal_gun.png');
  assert.equal(await Aim.audio.loadSkinSound(champions), true);
  for (let i = 0; i < 6; i++) Aim.audio.kill(true);
  const expected = manifest[champions].kills.map((name) => hash(fs.readFileSync(path.join(root, 'assets/skins', name))));
  assert.deepEqual(played, [...expected, expected[4]]);
  Aim.audio.resetStreak(); Aim.audio.kill(true);
  assert.equal(played[6], expected[0]);
});

test('switching to Gaia replaces both its first-person image and recorded sound', async () => {
  const { Aim, played } = publicBrowser();
  await Aim.audio.loadSkinSound(champions);
  assert.equal((await Aim.skins.loadImage(gaia)).url, 'assets/skins/gaia_vandal_gun.png');
  assert.equal(await Aim.audio.loadSkinSound(gaia), true);
  Aim.audio.kill(true);
  assert.equal(played[0], hash(fs.readFileSync(path.join(root, 'assets/skins', manifest[gaia].kills[0]))));
});

test('Gaia plays all five recorded kill stages, holds the fifth, and resets after a miss', async () => {
  const { Aim, played } = publicBrowser();
  assert.equal(await Aim.audio.loadSkinSound(gaia), true);
  const expected = manifest[gaia].kills.map((name) => hash(fs.readFileSync(path.join(root, 'assets/skins', name))));
  assert.equal(expected.length, 5);
  for (let i = 0; i < 7; i++) Aim.audio.kill(true);
  assert.deepEqual(played, [...expected, expected[4], expected[4]]);
  Aim.audio.resetStreak(); Aim.audio.kill(true);
  assert.equal(played[7], expected[0]);
  Aim.audio.kill(false); Aim.audio.kill(true);
  assert.deepEqual(played.slice(8), [expected[0], expected[0]]);
});
