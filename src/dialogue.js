/**
 * Dialogue Mode Module
 * Multi-speaker dialogue synthesis — assign voices to roles,
 * compose lines, and generate a combined audio output.
 * 
 * Supports: SFT preset voices + voice library cloned voices
 */

import { callSFT, callZeroShot } from './api.js';
import { callF5TTS } from './f5api.js';
import { getVoiceList, getVoiceAudio } from './voicelib.js';

/**
 * Dialogue line structure:
 * { id, role, text, voiceType, voiceId, audioBlob? }
 * voiceType: 'sft' | 'cloned'
 * voiceId: SFT speaker id or voice library id
 */

const ROLE_COLORS = [
  '#818cf8', '#34d399', '#f59e0b', '#ec4899',
  '#06b6d4', '#a78bfa', '#fb923c', '#14b8a6',
];

const ROLE_ICONS = ['👩', '👨', '👧', '🧑', '👴', '👵', '🧒', '🤖'];

let dialogueLines = [];
let lineIdCounter = 0;
let roles = []; // { name, voiceType, voiceId, color, icon }
let sftSpeakers = []; // Will be populated from server info

/**
 * Initialize — call after DOM ready
 */
export function initDialogueMode(speakers = []) {
  sftSpeakers = speakers;

  // Default roles
  if (roles.length === 0) {
    roles = [
      { name: '角色 A', voiceType: 'sft', voiceId: sftSpeakers[0] || '', color: ROLE_COLORS[0], icon: ROLE_ICONS[0] },
      { name: '角色 B', voiceType: 'sft', voiceId: sftSpeakers[1] || sftSpeakers[0] || '', color: ROLE_COLORS[1], icon: ROLE_ICONS[1] },
    ];
  }

  renderRolesPanel();
  renderDialogueEditor();
  bindDialogueEvents();
}

/**
 * Update available SFT speakers
 */
export function updateDialogueSpeakers(speakers) {
  sftSpeakers = speakers;
  renderRolesPanel();
}

// ============================
// Roles Panel
// ============================
function renderRolesPanel() {
  const panel = document.getElementById('dialogueRolesPanel');
  if (!panel) return;

  const voiceLibVoices = getVoiceList();

  panel.innerHTML = roles.map((role, idx) => `
    <div class="dialogue-role-card" data-role-idx="${idx}" style="border-left: 3px solid ${role.color}">
      <div class="dialogue-role-header">
        <span class="dialogue-role-icon">${role.icon}</span>
        <input class="dialogue-role-name" value="${escapeHtml(role.name)}" data-idx="${idx}" placeholder="角色名" />
        ${roles.length > 1 ? `<button class="dialogue-role-remove" data-idx="${idx}" title="移除角色">✕</button>` : ''}
      </div>
      <div class="dialogue-role-voice">
        <select class="dialogue-voice-select" data-idx="${idx}">
          <optgroup label="预设音色">
            ${sftSpeakers.map(spk => `
              <option value="sft:${spk}" ${role.voiceType === 'sft' && role.voiceId === spk ? 'selected' : ''}>
                🗣️ ${spk}
              </option>
            `).join('')}
          </optgroup>
          ${voiceLibVoices.length > 0 ? `
            <optgroup label="声音库">
              ${voiceLibVoices.map(v => `
                <option value="cloned:${v.id}" ${role.voiceType === 'cloned' && role.voiceId === v.id ? 'selected' : ''}>
                  🎙️ ${escapeHtml(v.name)}
                </option>
              `).join('')}
            </optgroup>
          ` : ''}
        </select>
      </div>
    </div>
  `).join('');

  // Add role button
  panel.innerHTML += `
    <button class="dialogue-add-role" id="dialogueAddRole">+ 添加角色</button>
  `;

  // Bind events
  panel.querySelectorAll('.dialogue-role-name').forEach(input => {
    input.addEventListener('change', (e) => {
      roles[parseInt(e.target.dataset.idx)].name = e.target.value;
      renderDialogueEditor(); // Update role names in lines
    });
  });

  panel.querySelectorAll('.dialogue-voice-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const [type, id] = e.target.value.split(':');
      roles[idx].voiceType = type;
      roles[idx].voiceId = id;
    });
  });

  panel.querySelectorAll('.dialogue-role-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      roles.splice(idx, 1);
      renderRolesPanel();
      renderDialogueEditor();
    });
  });

  document.getElementById('dialogueAddRole')?.addEventListener('click', () => {
    const idx = roles.length;
    roles.push({
      name: `角色 ${String.fromCharCode(65 + idx)}`,
      voiceType: 'sft',
      voiceId: sftSpeakers[idx % sftSpeakers.length] || '',
      color: ROLE_COLORS[idx % ROLE_COLORS.length],
      icon: ROLE_ICONS[idx % ROLE_ICONS.length],
    });
    renderRolesPanel();
    renderDialogueEditor();
  });
}

// ============================
// Dialogue Editor
// ============================
function renderDialogueEditor() {
  const editor = document.getElementById('dialogueEditor');
  if (!editor) return;

  if (dialogueLines.length === 0) {
    // Add two default lines
    dialogueLines = [
      { id: ++lineIdCounter, roleIdx: 0, text: '' },
      { id: ++lineIdCounter, roleIdx: 1, text: '' },
    ];
  }

  editor.innerHTML = dialogueLines.map((line, i) => {
    const role = roles[line.roleIdx] || roles[0];
    return `
      <div class="dialogue-line" data-line-id="${line.id}">
        <div class="dialogue-line-role" style="color: ${role.color}">
          <select class="dialogue-line-role-select" data-line-idx="${i}">
            ${roles.map((r, ri) => `
              <option value="${ri}" ${ri === line.roleIdx ? 'selected' : ''}>${r.icon} ${escapeHtml(r.name)}</option>
            `).join('')}
          </select>
        </div>
        <textarea class="dialogue-line-text" data-line-idx="${i}" rows="2" placeholder="输入台词...">${escapeHtml(line.text)}</textarea>
        <div class="dialogue-line-actions">
          <button class="dialogue-line-btn move-up" data-idx="${i}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="dialogue-line-btn move-down" data-idx="${i}" title="下移" ${i === dialogueLines.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="dialogue-line-btn remove" data-idx="${i}" title="删除">✕</button>
        </div>
      </div>
    `;
  }).join('');

  editor.innerHTML += `
    <button class="dialogue-add-line" id="dialogueAddLine">+ 添加台词</button>
  `;

  bindEditorEvents();
}

function bindEditorEvents() {
  const editor = document.getElementById('dialogueEditor');
  if (!editor) return;

  // Role select change
  editor.querySelectorAll('.dialogue-line-role-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const lineIdx = parseInt(e.target.dataset.lineIdx);
      dialogueLines[lineIdx].roleIdx = parseInt(e.target.value);
    });
  });

  // Text change
  editor.querySelectorAll('.dialogue-line-text').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const lineIdx = parseInt(e.target.dataset.lineIdx);
      dialogueLines[lineIdx].text = e.target.value;
    });
  });

  // Move up/down
  editor.querySelectorAll('.move-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (idx > 0) {
        [dialogueLines[idx - 1], dialogueLines[idx]] = [dialogueLines[idx], dialogueLines[idx - 1]];
        renderDialogueEditor();
      }
    });
  });

  editor.querySelectorAll('.move-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (idx < dialogueLines.length - 1) {
        [dialogueLines[idx], dialogueLines[idx + 1]] = [dialogueLines[idx + 1], dialogueLines[idx]];
        renderDialogueEditor();
      }
    });
  });

  // Remove
  editor.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (dialogueLines.length > 1) {
        dialogueLines.splice(idx, 1);
        renderDialogueEditor();
      }
    });
  });

  // Add line
  document.getElementById('dialogueAddLine')?.addEventListener('click', () => {
    // Alternate between roles
    const lastRole = dialogueLines.length > 0 ? dialogueLines[dialogueLines.length - 1].roleIdx : 0;
    const nextRole = (lastRole + 1) % roles.length;
    dialogueLines.push({ id: ++lineIdCounter, roleIdx: nextRole, text: '' });
    renderDialogueEditor();
  });
}

function bindDialogueEvents() {
  // Generate all dialogue
  document.getElementById('dialogueGenBtn')?.addEventListener('click', () => {
    generateDialogue();
  });
}

// ============================
// Dialogue Generation
// ============================
async function generateDialogue() {
  const validLines = dialogueLines.filter(l => l.text.trim());
  if (validLines.length === 0) {
    showToastGlobal('请至少输入一行台词', 'error');
    return;
  }

  const genBtn = document.getElementById('dialogueGenBtn');
  const resultArea = document.getElementById('dialogueResult');
  const progressEl = document.getElementById('dialogueProgress');

  genBtn.disabled = true;
  genBtn.textContent = '⏳ 合成中...';
  resultArea.classList.remove('hidden');
  progressEl.innerHTML = '';

  const audioBuffers = [];
  let hasError = false;

  for (let i = 0; i < validLines.length; i++) {
    const line = validLines[i];
    const role = roles[line.roleIdx] || roles[0];

    progressEl.innerHTML += `
      <div class="dialogue-progress-item" id="dprog_${line.id}">
        <span style="color:${role.color}">${role.icon} ${escapeHtml(role.name)}</span>: 
        <span class="dprog-status">⏳ 生成中...</span>
      </div>
    `;

    try {
      let wavBlob;
      if (role.voiceType === 'sft') {
        wavBlob = await callSFT(line.text.trim(), role.voiceId);
      } else {
        // Cloned voice — use zero-shot with voice library audio
        const voiceAudio = await getVoiceAudio(role.voiceId);
        if (!voiceAudio) {
          throw new Error('声音库音频未找到');
        }
        const voiceMeta = getVoiceList().find(v => v.id === role.voiceId);
        const promptText = voiceMeta?.promptText || '';
        const file = new File([voiceAudio], 'ref.wav', { type: 'audio/wav' });
        wavBlob = await callZeroShot(line.text.trim(), promptText, file);
      }

      audioBuffers.push(wavBlob);
      const statusEl = document.querySelector(`#dprog_${line.id} .dprog-status`);
      if (statusEl) statusEl.textContent = '✅ 完成';
    } catch (err) {
      const statusEl = document.querySelector(`#dprog_${line.id} .dprog-status`);
      if (statusEl) statusEl.textContent = `❌ ${err.message}`;
      hasError = true;
    }
  }

  if (audioBuffers.length > 0) {
    // Concatenate all audio blobs with 300ms silence gap
    const mergedBlob = await concatenateAudioBlobs(audioBuffers, 300);

    // Show result player
    const playerEl = document.getElementById('dialoguePlayer');
    const { AudioPlayer } = await import('./player.js');
    if (window._dialoguePlayer) window._dialoguePlayer.destroy();
    window._dialoguePlayer = new AudioPlayer(playerEl, mergedBlob);

    if (!hasError) {
      showToastGlobal(`🎭 对话合成完成！共 ${audioBuffers.length} 段`, 'success');
    } else {
      showToastGlobal(`⚠️ 部分台词合成失败，已跳过`, 'error');
    }
  }

  genBtn.disabled = false;
  genBtn.textContent = '🎭 合成对话';
}

// ============================
// Audio Concatenation
// ============================
async function concatenateAudioBlobs(blobs, gapMs = 300) {
  const audioCtx = new OfflineAudioContext(1, 1, 22050);

  // Decode all blobs
  const buffers = [];
  for (const blob of blobs) {
    const ab = await blob.arrayBuffer();
    try {
      const decoded = await audioCtx.decodeAudioData(ab);
      buffers.push(decoded);
    } catch (err) {
      console.warn('Failed to decode audio segment:', err);
    }
  }

  if (buffers.length === 0) return blobs[0];

  const sampleRate = buffers[0].sampleRate;
  const gapSamples = Math.floor((gapMs / 1000) * sampleRate);

  // Calculate total length
  let totalLength = 0;
  for (const buf of buffers) {
    totalLength += buf.length + gapSamples;
  }
  totalLength -= gapSamples; // No gap after last segment

  // Create merged buffer
  const offCtx = new OfflineAudioContext(1, totalLength, sampleRate);
  const mergedBuffer = offCtx.createBuffer(1, totalLength, sampleRate);
  const channelData = mergedBuffer.getChannelData(0);

  let offset = 0;
  for (let i = 0; i < buffers.length; i++) {
    const srcData = buffers[i].getChannelData(0);
    channelData.set(srcData, offset);
    offset += srcData.length;
    if (i < buffers.length - 1) {
      // Gap is already zero-filled
      offset += gapSamples;
    }
  }

  // Encode to WAV
  return bufferToWav(mergedBuffer);
}

function bufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  let pos = 44;
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      pos += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ============================
// Helpers
// ============================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToastGlobal(msg, type) {
  // Use the global showToast from main.js
  const event = new CustomEvent('show-toast', { detail: { msg, type } });
  document.dispatchEvent(event);
}
