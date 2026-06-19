/**
 * Read/write OS master output volume (local server only — not available on cloud deploy).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const PLATFORM = process.platform;

function clampPercent(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

async function getDarwinVolume() {
  const { stdout } = await execFileAsync('osascript', ['-e', 'output volume of (get volume settings)']);
  const vol = parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(vol)) return { available: false, platform: 'darwin' };
  return { available: true, volume_percent: clampPercent(vol), platform: 'darwin' };
}

async function setDarwinVolume(percent) {
  const vol = clampPercent(percent);
  await execFileAsync('osascript', ['-e', `set volume output volume ${vol}`]);
  return { available: true, volume_percent: vol, platform: 'darwin' };
}

async function getLinuxVolume() {
  try {
    const { stdout } = await execFileAsync('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    const match = stdout.match(/(\d+)%/);
    if (match) {
      return { available: true, volume_percent: clampPercent(match[1]), platform: 'linux' };
    }
  } catch (_) { /* try amixer */ }
  try {
    const { stdout } = await execFileAsync('amixer', ['get', 'Master']);
    const match = stdout.match(/\[(\d+)%\]/);
    if (match) {
      return { available: true, volume_percent: clampPercent(match[1]), platform: 'linux' };
    }
  } catch (_) { /* ignore */ }
  return { available: false, platform: 'linux' };
}

async function setLinuxVolume(percent) {
  const vol = clampPercent(percent);
  try {
    await execFileAsync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${vol}%`]);
    return { available: true, volume_percent: vol, platform: 'linux' };
  } catch (_) { /* fall through */ }
  await execFileAsync('amixer', ['set', 'Master', `${vol}%`]);
  return { available: true, volume_percent: vol, platform: 'linux' };
}

async function getSystemVolume() {
  try {
    if (PLATFORM === 'darwin') return await getDarwinVolume();
    if (PLATFORM === 'linux') return await getLinuxVolume();
    return { available: false, platform: PLATFORM };
  } catch (err) {
    return { available: false, platform: PLATFORM, error: err.message };
  }
}

async function setSystemVolume(percent) {
  const vol = clampPercent(percent);
  try {
    if (PLATFORM === 'darwin') return await setDarwinVolume(vol);
    if (PLATFORM === 'linux') return await setLinuxVolume(vol);
    return { available: false, platform: PLATFORM };
  } catch (err) {
    return { available: false, platform: PLATFORM, error: err.message };
  }
}

function isSupported() {
  return PLATFORM === 'darwin' || PLATFORM === 'linux';
}

module.exports = {
  getSystemVolume,
  setSystemVolume,
  isSupported
};
