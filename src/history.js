/**
 * History Manager
 * Stores generated audio results in localStorage (metadata)
 * and IndexedDB (audio blobs) for replay and download.
 */

const STORAGE_KEY = 'cosyvoice_history';
const DB_NAME = 'cosyvoice_db';
const DB_STORE = 'audio_blobs';
const MAX_ITEMS = 50;

let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(DB_STORE)) {
        database.createObjectStore(DB_STORE);
      }
      if (!database.objectStoreNames.contains('voice_profiles')) {
        database.createObjectStore('voice_profiles');
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveToHistory(entry) {
  // entry: { id, mode, text, spkId?, promptText?, instructText?, timestamp }
  const id = entry.id || `cv_${Date.now()}`;
  entry.id = id;
  entry.timestamp = entry.timestamp || Date.now();

  // Save blob to IndexedDB
  if (entry.audioBlob) {
    try {
      const database = await openDB();
      const tx = database.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(entry.audioBlob, id);
    } catch (err) {
      console.warn('Failed to save audio to IndexedDB:', err);
    }
  }

  // Save metadata to localStorage
  const meta = { ...entry };
  delete meta.audioBlob;

  const list = getHistoryList();
  list.unshift(meta);
  if (list.length > MAX_ITEMS) {
    const removed = list.splice(MAX_ITEMS);
    // Clean up old blobs
    try {
      const database = await openDB();
      const tx = database.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const old of removed) store.delete(old.id);
    } catch {}
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return id;
}

export function getHistoryList() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export async function getAudioBlob(id) {
  try {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  try {
    const database = await openDB();
    const tx = database.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
  } catch {}
}

export function formatHistoryTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MODE_LABELS = {
  'sft': '预设音色',
  'zero-shot': '声音克隆',
  'cross-lingual': '跨语言',
  'instruct': '指令控制',
  'instruct2': '指令+克隆'
};

export function getModeLabel(mode) {
  return MODE_LABELS[mode] || mode;
}
