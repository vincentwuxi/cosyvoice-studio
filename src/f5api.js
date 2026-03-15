/**
 * F5-TTS Gradio API Client
 * Handles communication with F5-TTS via its Gradio API.
 * 
 * F5-TTS uses a 2-step Gradio call flow:
 * 1. Upload reference audio via /gradio_api/upload
 * 2. Call /gradio_api/call/basic_tts with uploaded path + params
 * 3. Poll /gradio_api/call/basic_tts/{event_id} for SSE result
 * 4. Download the generated WAV from the returned file URL
 */

const F5_BASE = '/f5api';

/**
 * Check if F5-TTS server is available
 */
export async function checkF5Server() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${F5_BASE}/gradio_api/config`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Upload a file to Gradio and get the server path
 * @param {File|Blob} file 
 * @returns {string} server file path
 */
async function uploadToGradio(file) {
  const formData = new FormData();
  const fileName = file.name || 'audio.wav';
  formData.append('files', file, fileName);

  const res = await fetch(`${F5_BASE}/gradio_api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`F5-TTS 文件上传失败 (${res.status})`);
  }

  const paths = await res.json();
  if (!paths || paths.length === 0) {
    throw new Error('F5-TTS 文件上传返回空路径');
  }
  return paths[0]; // server file path
}

/**
 * Call F5-TTS basic TTS generation
 * @param {File|Blob} refAudio - reference audio file
 * @param {string} refText - reference text (empty = auto-transcribe with Whisper)
 * @param {string} genText - text to synthesize
 * @param {object} opts - { speed: 1.0, nfeSteps: 32, removeSilence: false }
 * @returns {Blob} WAV audio blob
 */
export async function callF5TTS(refAudio, refText, genText, opts = {}) {
  const { speed = 1.0, nfeSteps = 32, removeSilence = false } = opts;

  // Step 1: Upload reference audio
  const uploadedPath = await uploadToGradio(refAudio);

  // Step 2: Submit the inference request
  const submitRes = await fetch(`${F5_BASE}/gradio_api/call/basic_tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [
        // ref_audio_input (filepath)
        { path: uploadedPath, meta: { _type: 'gradio.FileData' } },
        // gen_text_input
        genText,
        // ref_text_input  
        refText || '',
        // remove_silence
        removeSilence,
        // randomize_seed
        true,
        // seed_input
        0,
        // cross_fade_duration
        0.15,
        // nfe_slider
        nfeSteps,
        // speed_slider
        speed,
      ],
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '');
    throw new Error(`F5-TTS 推理请求失败 (${submitRes.status}): ${errText}`);
  }

  const submitData = await submitRes.json();
  const eventId = submitData.event_id;

  if (!eventId) {
    throw new Error('F5-TTS 未返回 event_id');
  }

  // Step 3: Poll SSE for the result
  const resultRes = await fetch(`${F5_BASE}/gradio_api/call/basic_tts/${eventId}`);
  if (!resultRes.ok) {
    throw new Error(`F5-TTS 结果轮询失败 (${resultRes.status})`);
  }

  const sseText = await resultRes.text();
  // Parse SSE: look for "data: " lines
  const dataLines = sseText.split('\n').filter(l => l.startsWith('data: '));
  
  let resultData = null;
  for (const line of dataLines) {
    try {
      const parsed = JSON.parse(line.substring(6));
      if (Array.isArray(parsed)) {
        resultData = parsed;
      }
    } catch {
      // skip non-JSON data lines
    }
  }

  if (!resultData || !resultData[0]) {
    // Check if there's an error in SSE
    const errorLine = sseText.split('\n').find(l => l.startsWith('data: ') && l.includes('error'));
    if (errorLine) {
      throw new Error(`F5-TTS 生成失败: ${errorLine.substring(6)}`);
    }
    throw new Error('F5-TTS 返回结果解析失败');
  }

  // resultData[0] = { path, url, ... } for the generated audio
  // resultData[1] = spectrogram image
  // resultData[2] = ref text used
  // resultData[3] = seed used
  const audioInfo = resultData[0];
  const audioUrl = audioInfo.url || `${F5_BASE}/gradio_api/file=${audioInfo.path}`;

  // Step 4: Download the WAV
  const audioRes = await fetch(audioUrl.startsWith('/') ? audioUrl : `${F5_BASE}/gradio_api/file=${audioInfo.path}`);
  if (!audioRes.ok) {
    throw new Error(`F5-TTS 音频下载失败 (${audioRes.status})`);
  }

  const audioBlob = await audioRes.blob();
  if (audioBlob.size === 0) {
    throw new Error('F5-TTS 返回空音频');
  }

  return new Blob([audioBlob], { type: 'audio/wav' });
}
