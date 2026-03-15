/**
 * Voice Library Module (v2 — Dual Persistence)
 * 
 * Storage strategy:
 *   Primary:   File system via /voices-api/* (survives cache clear)
 *   Secondary: IndexedDB + localStorage (fast local access)
 * 
 * On save:  write to BOTH file system and IndexedDB
 * On load:  prefer file system, fall back to IndexedDB
 * On init:  sync file system → IndexedDB (restore after cache clear)
 */

import JSZip from 'jszip';

const VOICES_KEY = 'cosyvoice_voices';
const DB_NAME = 'cosyvoice_db';
const VOICE_STORE = 'voice_profiles';

let db = null;

// ============================
// IndexedDB Helpers
// ============================

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('audio_blobs')) {
        database.createObjectStore('audio_blobs');
      }
      if (!database.objectStoreNames.contains(VOICE_STORE)) {
        database.createObjectStore(VOICE_STORE);
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(id, blob) {
  try {
    const database = await openDB();
    const tx = database.transaction(VOICE_STORE, 'readwrite');
    tx.objectStore(VOICE_STORE).put(blob, id);
  } catch (err) {
    console.warn('[voicelib] IDB put failed:', err);
  }
}

async function idbGet(id) {
  try {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(VOICE_STORE, 'readonly');
      const req = tx.objectStore(VOICE_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbDelete(id) {
  try {
    const database = await openDB();
    const tx = database.transaction(VOICE_STORE, 'readwrite');
    tx.objectStore(VOICE_STORE).delete(id);
  } catch {}
}

// ============================
// File System API Helpers
// ============================

async function fsSave(meta, audioBlob) {
  const formData = new FormData();
  formData.append('meta', JSON.stringify(meta));
  formData.append('audio', audioBlob, `${meta.id}.wav`);

  const res = await fetch('/voices-api/save', {
    method: 'POST',
    body: formData,
  });
  return res.ok;
}

async function fsList() {
  try {
    const res = await fetch('/voices-api/list');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fsGetAudio(id) {
  try {
    const res = await fetch(`/voices-api/audio/${id}`);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function fsDelete(id) {
  try {
    await fetch(`/voices-api/delete/${id}`, { method: 'DELETE' });
  } catch {}
}

// ============================
// Local Metadata (localStorage)
// ============================

function getLocalMeta() {
  try {
    return JSON.parse(localStorage.getItem(VOICES_KEY) || '[]');
  } catch {
    return [];
  }
}

function setLocalMeta(list) {
  localStorage.setItem(VOICES_KEY, JSON.stringify(list));
}

// ============================
// Public API
// ============================

/**
 * Save a voice profile (dual write: filesystem + IndexedDB)
 * @param {Object} profile - { name, promptText, tags? }
 * @param {Blob} audioBlob - reference audio WAV blob
 * @returns {string} profile ID
 */
export async function saveVoiceProfile(profile, audioBlob) {
  const id = `voice_${Date.now()}`;
  const meta = {
    id,
    name: profile.name,
    promptText: profile.promptText || '',
    tags: profile.tags || [],
    createdAt: Date.now(),
    audioSize: audioBlob.size,
  };

  // Write to file system (primary)
  try {
    await fsSave(meta, audioBlob);
  } catch (err) {
    console.warn('[voicelib] FS save failed, using IndexedDB only:', err);
  }

  // Write to IndexedDB (secondary)
  await idbPut(id, audioBlob);

  // Update localStorage metadata
  const list = getLocalMeta();
  list.unshift(meta);
  setLocalMeta(list);

  return id;
}

/**
 * Get all saved voice profiles — prefer filesystem, fall back to localStorage
 */
export function getVoiceList() {
  return getLocalMeta();
}

/**
 * Get voice audio blob by ID — prefer filesystem, fall back to IndexedDB
 */
export async function getVoiceAudio(id) {
  // Try filesystem first
  const fsBlob = await fsGetAudio(id);
  if (fsBlob && fsBlob.size > 0) {
    // Also put into IDB cache
    idbPut(id, fsBlob);
    return fsBlob;
  }
  // Fall back to IndexedDB
  return await idbGet(id);
}

/**
 * Get voice metadata by ID
 */
export function getVoiceById(id) {
  return getVoiceList().find(v => v.id === id) || null;
}

/**
 * Delete a voice profile (both filesystem and IndexedDB)
 */
export async function deleteVoiceProfile(id) {
  await fsDelete(id);
  await idbDelete(id);
  const list = getLocalMeta().filter(v => v.id !== id);
  setLocalMeta(list);
}

/**
 * Update voice profile metadata
 */
export function updateVoiceProfile(id, updates) {
  const list = getLocalMeta();
  const idx = list.findIndex(v => v.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...updates };
  setLocalMeta(list);
  return true;
}

/**
 * Sync filesystem → local storage + IndexedDB
 * Call on init to restore voices after browser cache clear
 */
export async function syncFromFilesystem() {
  const fsMeta = await fsList();
  if (!fsMeta || fsMeta.length === 0) return 0;

  const localMeta = getLocalMeta();
  const localIds = new Set(localMeta.map(v => v.id));
  let restored = 0;

  for (const meta of fsMeta) {
    if (!localIds.has(meta.id)) {
      // Restore metadata
      localMeta.push(meta);
      restored++;
    }
  }

  if (restored > 0) {
    // Sort by createdAt descending
    localMeta.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    setLocalMeta(localMeta);
  }

  return restored;
}

// ============================
// Export / Import
// ============================

/**
 * Export entire voice library as a ZIP file
 * ZIP structure:
 *   voices.json — metadata array
 *   audio/voice_xxx.wav — audio files
 * 
 * @returns {Blob} ZIP blob ready for download
 */
export async function exportVoiceLibrary() {
  const voices = getVoiceList();
  if (voices.length === 0) {
    throw new Error('声音库为空，没有可导出的内容');
  }

  const zip = new JSZip();
  const audioFolder = zip.folder('audio');
  const exportMeta = [];

  for (const voice of voices) {
    const audioBlob = await getVoiceAudio(voice.id);
    if (audioBlob && audioBlob.size > 0) {
      audioFolder.file(`${voice.id}.wav`, audioBlob);
      exportMeta.push(voice);
    }
  }

  if (exportMeta.length === 0) {
    throw new Error('没有找到可用的音频数据');
  }

  zip.file('voices.json', JSON.stringify(exportMeta, null, 2));
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Import voice library from a ZIP file
 * @param {File|Blob} zipFile — ZIP file to import
 * @returns {{ imported: number, skipped: number }}
 */
export async function importVoiceLibrary(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const metaFile = zip.file('voices.json');
  
  if (!metaFile) {
    throw new Error('无效的声音库文件：缺少 voices.json');
  }

  const metaList = JSON.parse(await metaFile.async('string'));
  const localMeta = getLocalMeta();
  const localIds = new Set(localMeta.map(v => v.id));
  
  let imported = 0;
  let skipped = 0;

  for (const meta of metaList) {
    if (localIds.has(meta.id)) {
      skipped++;
      continue;
    }

    const audioFile = zip.file(`audio/${meta.id}.wav`);
    if (!audioFile) {
      skipped++;
      continue;
    }

    const audioBlob = new Blob(
      [await audioFile.async('arraybuffer')],
      { type: 'audio/wav' }
    );

    // Save to both filesystem and IndexedDB
    try {
      await fsSave(meta, audioBlob);
    } catch (err) {
      console.warn('[voicelib] FS import failed for', meta.id, err);
    }
    await idbPut(meta.id, audioBlob);
    
    localMeta.unshift(meta);
    imported++;
  }

  setLocalMeta(localMeta);
  return { imported, skipped };
}
