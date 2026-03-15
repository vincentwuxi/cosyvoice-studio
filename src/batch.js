/**
 * Batch Generation Engine
 * Manages a queue of text items, generates audio sequentially,
 * and packages results as a downloadable ZIP.
 */
import JSZip from 'jszip';
import { wavToMp3, generateFileName } from './format.js';

/**
 * @typedef {Object} BatchItem
 * @property {string} text - Text to synthesize
 * @property {number} index - 1-based index
 * @property {'pending'|'generating'|'done'|'error'} status
 * @property {Blob|null} audioBlob - Generated WAV blob
 * @property {string|null} error - Error message if failed
 */

/**
 * Run a batch generation job
 * @param {string[]} texts - Array of text strings to generate
 * @param {Function} apiFn - API function: (text) => Promise<Blob>
 * @param {Function} onProgress - Callback: (item, completedCount, totalCount) => void
 * @returns {Promise<BatchItem[]>} All items with results
 */
export async function runBatch(texts, apiFn, onProgress) {
  /** @type {BatchItem[]} */
  const items = texts.map((text, i) => ({
    text: text.trim(),
    index: i + 1,
    status: 'pending',
    audioBlob: null,
    error: null,
  }));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.status = 'generating';
    if (onProgress) onProgress(item, i, items.length);

    try {
      item.audioBlob = await apiFn(item.text);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }

    if (onProgress) onProgress(item, i + 1, items.length);
  }

  return items;
}

/**
 * Package batch results into a ZIP file and trigger download
 * @param {BatchItem[]} items - Completed batch items
 * @param {Object} opts - { spkId, format: 'wav'|'mp3' }
 */
export async function downloadBatchAsZip(items, opts = {}) {
  const { spkId = 'voice', format = 'wav' } = opts;
  const zip = new JSZip();
  const successItems = items.filter(it => it.status === 'done' && it.audioBlob);

  if (successItems.length === 0) {
    throw new Error('没有可下载的音频');
  }

  for (const item of successItems) {
    let blob = item.audioBlob;
    let ext = 'wav';

    if (format === 'mp3') {
      try {
        blob = await wavToMp3(blob);
        ext = 'mp3';
      } catch (e) {
        console.warn(`MP3 conversion failed for item ${item.index}, falling back to WAV`, e);
        ext = 'wav';
      }
    }

    const fileName = generateFileName({
      spkId,
      text: item.text,
      index: item.index,
      format: ext,
    });

    zip.file(fileName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cosyvoice_batch_${Date.now()}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  return successItems.length;
}

/**
 * Estimate generation duration based on text length
 * Based on empirical avg: ~1s per 5 characters for CosyVoice
 * @param {string} text - Input text
 * @returns {number} Estimated seconds
 */
export function estimateDuration(text) {
  const chars = text.trim().length;
  return Math.max(2, Math.ceil(chars / 5));
}
