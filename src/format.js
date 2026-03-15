/**
 * Audio Format Converter
 * Supports WAV and MP3 output.
 * MP3 encoding uses @breezystack/lamejs with dynamic import for ESM compat.
 */

let _lamejs = null;

/**
 * Lazily load lamejs to avoid ESM bundling issues
 */
async function getLamejs() {
  if (_lamejs) return _lamejs;
  try {
    // Dynamic import avoids Vite pre-bundling issues
    const mod = await import('@breezystack/lamejs');
    _lamejs = mod.default || mod;
    return _lamejs;
  } catch (err) {
    console.error('Failed to load lamejs:', err);
    return null;
  }
}

/**
 * Convert WAV blob to MP3 blob using lamejs
 * @param {Blob} wavBlob - Input WAV blob
 * @param {number} bitrate - MP3 bitrate (default 128kbps)
 * @returns {Promise<Blob>} MP3 blob
 */
export async function wavToMp3(wavBlob, bitrate = 128) {
  const lamejs = await getLamejs();
  if (!lamejs || !lamejs.Mp3Encoder) {
    throw new Error('MP3 编码器加载失败，请使用 WAV 格式');
  }

  const arrayBuffer = await wavBlob.arrayBuffer();
  const dataView = new DataView(arrayBuffer);

  // Parse WAV header
  const channels = dataView.getUint16(22, true);
  const sampleRate = dataView.getUint32(24, true);
  const bitsPerSample = dataView.getUint16(34, true);
  const dataOffset = 44;
  const dataLength = dataView.getUint32(40, true);

  // Read PCM samples
  const numSamples = dataLength / (bitsPerSample / 8);
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = dataView.getInt16(dataOffset + i * 2, true);
  }

  // Encode MP3
  const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
  const mp3Data = [];
  const blockSize = 1152;

  for (let i = 0; i < samples.length; i += blockSize) {
    const chunk = samples.subarray(i, Math.min(i + blockSize, samples.length));
    const mp3buf = mp3Encoder.encodeBuffer(chunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }

  const end = mp3Encoder.flush();
  if (end.length > 0) mp3Data.push(end);

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

/**
 * Generate a semantic filename
 * @param {object} opts - { spkId, text, index, format }
 */
export function generateFileName({ spkId, text, index, format = 'wav' }) {
  const spk = spkId || 'voice';
  const preview = (text || '').slice(0, 12).replace(/[\\/:*?"<>|\s]/g, '_');
  const idx = String(index || 1).padStart(2, '0');
  return `${spk}_${preview}_${idx}.${format}`;
}
