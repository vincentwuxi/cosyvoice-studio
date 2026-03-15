/**
 * CosyVoice API Service Layer
 * Handles all communication with the CosyVoice FastAPI server.
 * Converts raw PCM int16 streaming responses to playable WAV.
 * 
 * Uses Vite proxy (/api → server) to avoid CORS issues.
 */

const API_BASE = '/api';
const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Check server connectivity
 */
export async function checkServer() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get server info: available speakers, endpoints, model type
 * Returns: { status, model, model_type, available_spk_ids, available_endpoints }
 */
export async function getServerInfo() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}/`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * SFT inference — preset speaker voice
 */
export async function callSFT(ttsText, spkId, onProgress) {
  const form = new URLSearchParams();
  form.append('tts_text', ttsText);
  form.append('spk_id', spkId);

  return fetchAudio(`${API_BASE}/inference_sft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, onProgress);
}

/**
 * Zero-Shot inference — voice cloning
 */
export async function callZeroShot(ttsText, promptText, promptWavFile, onProgress) {
  const form = new FormData();
  form.append('tts_text', ttsText);
  form.append('prompt_text', promptText);
  form.append('prompt_wav', promptWavFile);

  return fetchAudio(`${API_BASE}/inference_zero_shot`, {
    method: 'POST',
    body: form,
  }, onProgress);
}

/**
 * Cross-Lingual inference
 */
export async function callCrossLingual(ttsText, promptWavFile, onProgress) {
  const form = new FormData();
  form.append('tts_text', ttsText);
  form.append('prompt_wav', promptWavFile);

  return fetchAudio(`${API_BASE}/inference_cross_lingual`, {
    method: 'POST',
    body: form,
  }, onProgress);
}

/**
 * Instruct2 inference — instruction-controlled voice cloning
 */
export async function callInstruct2(ttsText, instructText, promptWavFile, onProgress) {
  const form = new FormData();
  form.append('tts_text', ttsText);
  form.append('instruct_text', instructText);
  form.append('prompt_wav', promptWavFile);

  return fetchAudio(`${API_BASE}/inference_instruct2`, {
    method: 'POST',
    body: form,
  }, onProgress);
}

/**
 * Fetch streaming PCM audio and convert to WAV blob
 * Handles stream interruption, 0-byte responses, and server crashes.
 */
async function fetchAudio(url, options, onProgress) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('无法连接到 CosyVoice 服务器，请检查服务是否运行');
    }
    throw new Error(`网络错误: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`服务端错误 (${response.status}): ${text || response.statusText}`);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
      if (onProgress) onProgress(totalBytes);
    }
  } catch (streamErr) {
    console.error('Stream interrupted:', streamErr);
    if (totalBytes === 0) {
      throw new Error(
        '服务端推理崩溃（0 字节返回）。可能原因：\n' +
        '• 当前模型不支持该推理模式\n' +
        '• GPU 显存不足\n' +
        '• CosyVoice 服务端发生异常\n' +
        '请检查服务器日志排查问题'
      );
    }
    console.warn(`Stream interrupted after ${totalBytes} bytes, attempting to use partial data`);
  }

  if (totalBytes === 0) {
    throw new Error(
      '服务端返回空数据（0 字节）。可能原因：\n' +
      '• 当前模型不支持该推理模式\n' +
      '• GPU 显存不足或模型未正确加载\n' +
      '请检查 CosyVoice 服务端日志'
    );
  }

  const pcmData = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    pcmData.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const wavBlob = pcmToWav(pcmData, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
  return wavBlob;
}

/**
 * Convert raw PCM int16 data to WAV file blob
 */
function pcmToWav(pcmData, sampleRate, channels, bitsPerSample) {
  const dataLength = pcmData.byteLength;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmData, headerLength);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
