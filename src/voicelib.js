/**
 * Voice Library Module
 * Stores and manages saved voice profiles (reference audio + metadata).
 * Audio blobs stored in IndexedDB, metadata in localStorage.
 */

const VOICES_KEY = 'cosyvoice_voices';
const DB_NAME = 'cosyvoice_db';
const VOICE_STORE = 'voice_profiles';

let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Version 2 adds voice_profiles store
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

/**
 * Save a voice profile
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

  // Save audio blob to IndexedDB
  try {
    const database = await openDB();
    const tx = database.transaction(VOICE_STORE, 'readwrite');
    tx.objectStore(VOICE_STORE).put(audioBlob, id);
  } catch (err) {
    console.error('Failed to save voice audio:', err);
    throw new Error('保存声音档案失败');
  }

  // Save metadata to localStorage
  const list = getVoiceList();
  list.unshift(meta);
  localStorage.setItem(VOICES_KEY, JSON.stringify(list));

  return id;
}

/**
 * Get all saved voice profiles (metadata only)
 */
export function getVoiceList() {
  try {
    return JSON.parse(localStorage.getItem(VOICES_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Get voice audio blob by ID
 */
export async function getVoiceAudio(id) {
  try {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(VOICE_STORE, 'readonly');
      const req = tx.objectStore(VOICE_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Get voice metadata by ID
 */
export function getVoiceById(id) {
  return getVoiceList().find(v => v.id === id) || null;
}

/**
 * Delete a voice profile
 */
export async function deleteVoiceProfile(id) {
  // Remove from IndexedDB
  try {
    const database = await openDB();
    const tx = database.transaction(VOICE_STORE, 'readwrite');
    tx.objectStore(VOICE_STORE).delete(id);
  } catch {}

  // Remove from localStorage
  const list = getVoiceList().filter(v => v.id !== id);
  localStorage.setItem(VOICES_KEY, JSON.stringify(list));
}

/**
 * Update voice profile metadata
 */
export function updateVoiceProfile(id, updates) {
  const list = getVoiceList();
  const idx = list.findIndex(v => v.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...updates };
  localStorage.setItem(VOICES_KEY, JSON.stringify(list));
  return true;
}
