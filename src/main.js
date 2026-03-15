/**
 * CosyVoice Studio — Main Application Entry
 * Orchestrates all modules: tabs, audio sources, generation, history, voice library.
 * Features: smart mode detection, dynamic speakers, recording protection, text templates.
 */
import './style.css';
import { checkServer, getServerInfo, callSFT, callZeroShot, callCrossLingual, callInstruct2 } from './api.js';
import { checkF5Server, callF5TTS } from './f5api.js';
import { AudioRecorder } from './recorder.js';
import { AudioPlayer } from './player.js';
import { saveToHistory, getHistoryList, getAudioBlob, formatHistoryTime, getModeLabel } from './history.js';
import { saveVoiceProfile, getVoiceList, getVoiceAudio, getVoiceById, deleteVoiceProfile, syncFromFilesystem, exportVoiceLibrary, importVoiceLibrary } from './voicelib.js';
import { runBatch, downloadBatchAsZip, estimateDuration } from './batch.js';
import { wavToMp3, generateFileName } from './format.js';

// ============================
// Constants
// ============================
const MAX_RECORD_SECONDS = 15;
const WARN_RECORD_SECONDS = 10;
let currentEngine = 'cosyvoice'; // 'cosyvoice' | 'f5tts'

// Endpoint → tab mapping for smart mode detection
const ENDPOINT_TAB_MAP = {
  '/inference_sft': 'sft',
  '/inference_zero_shot': 'zero-shot',
  '/inference_cross_lingual': 'cross-lingual',
  '/inference_instruct2': 'instruct2',
};

// Text templates per mode
const TEXT_TEMPLATES = {
  'zero-shot': [
    { label: '🇨🇳 中文示例', text: '在这个信息爆炸的时代，我们需要更加冷静地思考，用理性的光芒照亮前行的道路。' },
    { label: '🇺🇸 English', text: 'In a world full of noise, the ability to think clearly and communicate effectively is more valuable than ever.' },
    { label: '🇯🇵 日本語', text: 'テクノロジーの進化は、私たちの生活を根本から変えつつあります。' },
    { label: '🇩🇪 Deutsch', text: 'In einer Welt voller Veränderungen ist die Fähigkeit, klar zu denken und effektiv zu kommunizieren, wertvoller denn je.' },
  ],
  'sft': [
    { label: '🇨🇳 新闻播报', text: '各位观众大家好，欢迎收看今天的新闻联播。今天的主要内容有：科技创新驱动高质量发展。' },
    { label: '🇨🇳 故事叙述', text: '很久很久以前，在一座大山的深处，住着一位白发苍苍的老人。他每天都会坐在门前的石头上，望着远方的天空。' },
    { label: '🇺🇸 English', text: 'Good morning everyone. Today we are going to discuss the future of artificial intelligence and its impact on our daily lives.' },
    { label: '🇯🇵 日本語', text: 'こんにちは、CosyVoiceへようこそ。これは高品質な音声合成のデモンストレーションです。' },
  ],
  'cross-lingual': [
    { label: '🇺🇸 English', text: 'Hello everyone, welcome to CosyVoice Studio. This is a cross-lingual synthesis demonstration.' },
    { label: '🇨🇳 中文', text: '大家好，这是一段跨语言合成的演示文本，AI 将用参考音频的声音来朗读这段话。' },
    { label: '🇫🇷 Français', text: 'Bonjour à tous, bienvenue dans CosyVoice Studio. Ceci est une démonstration de synthèse multilingue.' },
    { label: '🇩🇪 Deutsch', text: 'Hallo zusammen, willkommen im CosyVoice Studio. Dies ist eine Demonstration der mehrsprachigen Sprachsynthese.' },
  ],
  'instruct2': [
    { label: '🇨🇳 正式', text: '尊敬的各位来宾，欢迎参加本次人工智能技术研讨会。今天我们将共同探讨语音合成技术的最新进展。' },
    { label: '🇨🇳 轻松', text: '嘿，你知道吗？今天天气特别好，阳光明媚的，我心情也跟着变好了呢！' },
    { label: '🇺🇸 Formal', text: 'Ladies and gentlemen, it is my great pleasure to welcome you to this conference on artificial intelligence.' },
  ],
};

// Speaker emoji map
const SPK_EMOJI = {
  '中文女': '👩', '中文男': '👨', '日语男': '🇯🇵', '粤语女': '🇭🇰',
  '英文女': '🇺🇸', '英文男': '🇬🇧', '韩语女': '🇰🇷',
};

// ============================
// Globals
// ============================
const audioFiles = {
  'zero-shot': null,
  'cross-lingual': null,
  'instruct2': null,
};

const players = {};
let saveVoiceContext = null;
let serverInfo = null; // cached server info

// ============================
// Init
// ============================
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initAudioSources();
  initInstructChips();
  initCharCounters();
  initGenerateButtons();
  initHistory();
  initVoiceLibrary();
  initTextTemplates();
  initBatchMode();
  initFormatSelector();
  initEngineSelector();

  // Async: server check + smart mode detection + dynamic speakers
  await initServerCheck();
});

// ============================
// Server Status Check + Smart Mode Detection
// ============================
async function initServerCheck() {
  const el = document.getElementById('serverStatus');
  const textEl = el.querySelector('.status-text');

  serverInfo = await getServerInfo();

  if (serverInfo && serverInfo.status === 'ok') {
    el.classList.add('online');
    el.classList.remove('offline');
    const modelName = serverInfo.model?.split('/').pop() || '未知';
    textEl.textContent = `在线 · ${modelName}`;
    textEl.title = `模型: ${serverInfo.model}`;

    // Smart mode detection — disable unsupported tabs
    applySmartModeDetection(serverInfo);

    // Dynamic speaker grid
    if (serverInfo.available_spk_ids?.length > 0) {
      renderDynamicSpeakers(serverInfo.available_spk_ids);
    }
  } else {
    el.classList.add('offline');
    el.classList.remove('online');
    textEl.textContent = '服务离线';

    // Also check F5-TTS even if CosyVoice is offline
    checkF5ServerStatus();
  }
}

function applySmartModeDetection(info) {
  const endpoints = info.available_endpoints || [];
  const availableTabs = new Set();

  for (const ep of endpoints) {
    for (const [path, tab] of Object.entries(ENDPOINT_TAB_MAP)) {
      if (ep.includes(path)) availableTabs.add(tab);
    }
  }

  // If no endpoints info, assume all available
  if (availableTabs.size === 0) return;

  const allTabs = document.querySelectorAll('.tab-btn');
  allTabs.forEach(btn => {
    const tab = btn.dataset.tab;
    if (!availableTabs.has(tab)) {
      btn.classList.add('disabled');
      btn.title = `当前模型不支持此功能`;
      btn.addEventListener('click', (e) => {
        if (btn.classList.contains('disabled')) {
          e.stopImmediatePropagation();
          showToast(`当前模型 (${info.model?.split('/').pop()}) 不支持此功能`, 'error');
        }
      }, true);
    }
  });

  // If current active tab is disabled, switch to first available
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab?.classList.contains('disabled')) {
    const firstAvailable = document.querySelector('.tab-btn:not(.disabled)');
    if (firstAvailable) firstAvailable.click();
  }
}

function renderDynamicSpeakers(spkIds) {
  const grid = document.getElementById('sftSpeakerGrid');
  if (!grid) return;

  grid.innerHTML = spkIds.map((spk, i) => {
    const emoji = SPK_EMOJI[spk] || '🎤';
    const activeClass = i === 0 ? ' active' : '';
    return `<button class="speaker-chip${activeClass}" data-spk="${spk}">${emoji} ${spk}</button>`;
  }).join('');

  // Re-bind click events
  initSpeakerGrids();
}

// ============================
// Engine Selector (CosyVoice ↔ F5-TTS)
// ============================
function initEngineSelector() {
  const btns = document.querySelectorAll('.engine-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEngine = btn.dataset.engine;

      // Toggle F5 params visibility
      const f5Params = document.getElementById('f5Params');
      const f5Hint = document.getElementById('f5RefTextHint');
      const genBtnText = document.querySelector('#zeroShotGenBtn .btn-text');
      
      if (currentEngine === 'f5tts') {
        f5Params?.classList.remove('hidden');
        f5Hint?.classList.remove('hidden');
        if (genBtnText) genBtnText.textContent = '⚡ F5-TTS 生成';
      } else {
        f5Params?.classList.add('hidden');
        f5Hint?.classList.add('hidden');
        if (genBtnText) genBtnText.textContent = '🚀 生成克隆语音';
      }
    });
  });

  // F5 slider value display
  const speedSlider = document.getElementById('f5Speed');
  const nfeSlider = document.getElementById('f5Nfe');
  speedSlider?.addEventListener('input', () => {
    document.getElementById('f5SpeedVal').textContent = `${speedSlider.value}x`;
  });
  nfeSlider?.addEventListener('input', () => {
    document.getElementById('f5NfeVal').textContent = nfeSlider.value;
  });

  // Check F5-TTS server on init
  checkF5ServerStatus();
}

async function checkF5ServerStatus() {
  const statusEl = document.getElementById('engineStatus');
  if (!statusEl) return;

  const f5Online = await checkF5Server();
  if (f5Online) {
    statusEl.textContent = 'F5-TTS ✓';
    statusEl.className = 'engine-status online';
  } else {
    statusEl.textContent = 'F5-TTS ✗';
    statusEl.className = 'engine-status offline';
  }
}

// ============================
// Tab Navigation
// ============================
function initTabs() {
  const nav = document.getElementById('tabNav');
  const btns = nav.querySelectorAll('.tab-btn');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) return;
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ============================
// Audio Source (Upload + Record) with Time Protection
// ============================
function initAudioSources() {
  const configs = [
    { prefix: 'zeroShot', mode: 'zero-shot' },
    { prefix: 'crossLingual', mode: 'cross-lingual' },
    { prefix: 'instruct2', mode: 'instruct2' },
  ];

  for (const { prefix, mode } of configs) {
    const fileInput = document.getElementById(`${prefix}FileInput`);
    const uploadZone = document.getElementById(`${prefix}Upload`);
    const recordBtn = document.getElementById(`${prefix}RecordBtn`);
    const recordingUI = document.getElementById(`${prefix}RecordingUI`);
    const stopBtn = document.getElementById(`${prefix}StopBtn`);
    const preview = document.getElementById(`${prefix}Preview`);
    const audioEl = document.getElementById(`${prefix}Audio`);
    const fileName = document.getElementById(`${prefix}FileName`);
    const removeBtn = document.getElementById(`${prefix}Remove`);
    const canvas = document.getElementById(`${prefix}WaveCanvas`);
    const timeDisplay = document.getElementById(`${prefix}RecordTime`);

    let recorder = null;
    let recordTimer = null;

    // Upload click
    uploadZone.addEventListener('click', () => fileInput.click());

    // Drag & Drop
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('audio/')) {
        handleAudioFile(file, mode, preview, audioEl, fileName, uploadZone, recordBtn);
      }
    });

    // File input
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleAudioFile(file, mode, preview, audioEl, fileName, uploadZone, recordBtn);
      }
    });

    // Record with time protection
    recordBtn.addEventListener('click', async () => {
      try {
        recorder = new AudioRecorder({
          canvas,
          timeDisplay,
          onComplete: (wavBlob) => {
            const file = new File([wavBlob], 'recording.wav', { type: 'audio/wav' });
            handleAudioFile(file, mode, preview, audioEl, fileName, uploadZone, recordBtn);
            recordingUI.classList.add('hidden');
            recordBtn.classList.remove('hidden');
            clearInterval(recordTimer);
          }
        });
        await recorder.start();
        recordBtn.classList.add('hidden');
        recordingUI.classList.remove('hidden');

        // Recording time protection
        let elapsed = 0;
        recordTimer = setInterval(() => {
          elapsed++;
          if (elapsed === WARN_RECORD_SECONDS) {
            showToast(`⏱️ 已录制 ${WARN_RECORD_SECONDS} 秒，建议 3-10 秒为佳`, 'info');
          }
          if (elapsed >= MAX_RECORD_SECONDS) {
            showToast(`⏹️ 已达到 ${MAX_RECORD_SECONDS} 秒上限，自动停止`, 'info');
            if (recorder) recorder.stop();
            clearInterval(recordTimer);
          }
        }, 1000);

      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Stop recording
    stopBtn.addEventListener('click', () => {
      if (recorder) recorder.stop();
      clearInterval(recordTimer);
    });

    // Remove audio
    removeBtn.addEventListener('click', () => {
      audioFiles[mode] = null;
      preview.classList.add('hidden');
      uploadZone.classList.remove('hidden');
      recordBtn.classList.remove('hidden');
      audioEl.src = '';
      const grid = document.getElementById(`${prefix}VoiceGrid`);
      if (grid) grid.querySelectorAll('.voice-chip').forEach(c => c.classList.remove('active'));
    });

    // Save to voice library
    const saveBtn = document.getElementById(`${prefix}SaveVoice`);
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!audioFiles[mode]) return showToast('没有可保存的音频', 'error');
        const promptInput = document.getElementById(`${prefix}PromptText`);
        const modalPrompt = document.getElementById('saveVoicePromptText');
        if (promptInput && modalPrompt) modalPrompt.value = promptInput.value;
        else if (modalPrompt) modalPrompt.value = '';
        document.getElementById('saveVoiceName').value = '';
        saveVoiceContext = { mode, audioBlob: audioFiles[mode] };
        document.getElementById('saveVoiceModal').classList.remove('hidden');
      });
    }
  }
}

function handleAudioFile(file, mode, preview, audioEl, fileNameEl, uploadZone, recordBtn) {
  audioFiles[mode] = file;
  audioEl.src = URL.createObjectURL(file);
  fileNameEl.textContent = file.name;
  preview.classList.remove('hidden');
  uploadZone.classList.add('hidden');
  recordBtn.classList.add('hidden');
  const prefix = toCamel(mode);
  const grid = document.getElementById(`${prefix}VoiceGrid`);
  if (grid) grid.querySelectorAll('.voice-chip').forEach(c => c.classList.remove('active'));
}

// ============================
// Speaker Grids
// ============================
function initSpeakerGrids() {
  document.querySelectorAll('.speaker-grid').forEach(grid => {
    grid.addEventListener('click', (e) => {
      const chip = e.target.closest('.speaker-chip');
      if (!chip) return;
      grid.querySelectorAll('.speaker-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

// ============================
// Instruct Quick-Fill Chips
// ============================
function initInstructChips() {
  document.querySelectorAll('.instruct-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const target = chip.closest('.form-group').querySelector('.form-textarea')
        || document.getElementById('instructText');
      target.value = chip.dataset.text;
      target.dispatchEvent(new Event('input'));
    });
  });
}

// ============================
// Text Templates
// ============================
function initTextTemplates() {
  for (const [mode, templates] of Object.entries(TEXT_TEMPLATES)) {
    const prefix = toCamel(mode);
    const container = document.getElementById(`${prefix}Templates`);
    if (!container) continue;

    container.innerHTML = templates.map(t =>
      `<button class="template-chip" data-text="${escapeAttr(t.text)}">${t.label}</button>`
    ).join('');

    container.querySelectorAll('.template-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const textarea = document.getElementById(`${prefix}TtsText`);
        if (textarea) {
          textarea.value = chip.dataset.text;
          textarea.dispatchEvent(new Event('input'));
          showToast('已填入示例文本', 'success');
        }
      });
    });
  }
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================
// Character Counters
// ============================
function initCharCounters() {
  const pairs = [
    ['zeroShotTtsText', 'zeroShotCharCount'],
    ['sftTtsText', 'sftCharCount'],
    ['crossLingualTtsText', 'crossLingualCharCount'],
    ['instruct2TtsText', 'instruct2CharCount'],
  ];

  for (const [inputId, countId] of pairs) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(countId);
    if (input && counter) {
      input.addEventListener('input', () => {
        counter.textContent = input.value.length;
      });
    }
  }
}

// ============================
// Generate Buttons
// ============================
function initGenerateButtons() {
  // Zero-Shot
  document.getElementById('zeroShotGenBtn').addEventListener('click', async () => {
    const ttsText = document.getElementById('zeroShotTtsText').value.trim();
    const promptText = document.getElementById('zeroShotPromptText').value.trim();
    const promptWav = audioFiles['zero-shot'];

    if (!ttsText) return showToast('请输入要合成的文字', 'error');
    if (!promptWav) return showToast('请上传或录制参考音频', 'error');

    if (currentEngine === 'f5tts') {
      // F5-TTS: promptText is optional (Whisper auto-transcribe)
      const speed = parseFloat(document.getElementById('f5Speed')?.value || '1.0');
      const nfeSteps = parseInt(document.getElementById('f5Nfe')?.value || '32');
      const removeSilence = document.getElementById('f5RemoveSilence')?.checked || false;

      await generateAudio('zero-shot', () => callF5TTS(promptWav, promptText, ttsText, { speed, nfeSteps, removeSilence }), {
        text: ttsText,
        promptText: promptText || '(auto)',
        engine: 'f5tts',
      });

      // Show engine badge
      const badge = document.getElementById('resultEngineBadge');
      if (badge) {
        badge.textContent = '⚡ F5-TTS';
        badge.className = 'result-engine-badge f5tts';
      }
    } else {
      // CosyVoice: promptText required
      if (!promptText) return showToast('请输入参考音频对应的文字', 'error');

      await generateAudio('zero-shot', () => callZeroShot(ttsText, promptText, promptWav, updateProgress), {
        text: ttsText,
        promptText,
        engine: 'cosyvoice',
      });

      const badge = document.getElementById('resultEngineBadge');
      if (badge) {
        badge.textContent = '🎯 CosyVoice';
        badge.className = 'result-engine-badge cosyvoice';
      }
    }
  });

  // SFT
  document.getElementById('sftGenBtn').addEventListener('click', async () => {
    const ttsText = document.getElementById('sftTtsText').value.trim();
    const spkId = document.querySelector('#sftSpeakerGrid .speaker-chip.active')?.dataset.spk;

    if (!ttsText) return showToast('请输入要合成的文字', 'error');
    if (!spkId) return showToast('请选择一个音色', 'error');

    await generateAudio('sft', () => callSFT(ttsText, spkId, updateProgress), {
      text: ttsText,
      spkId,
    });
  });

  // Cross-Lingual
  document.getElementById('crossLingualGenBtn').addEventListener('click', async () => {
    const ttsText = document.getElementById('crossLingualTtsText').value.trim();
    const promptWav = audioFiles['cross-lingual'];

    if (!ttsText) return showToast('请输入目标文本', 'error');
    if (!promptWav) return showToast('请上传或录制参考音频', 'error');

    await generateAudio('cross-lingual', () => callCrossLingual(ttsText, promptWav, updateProgress), {
      text: ttsText,
    });
  });

  // Instruct2
  document.getElementById('instruct2GenBtn').addEventListener('click', async () => {
    const ttsText = document.getElementById('instruct2TtsText').value.trim();
    const instructText = document.getElementById('instruct2InstructText').value.trim();
    const promptWav = audioFiles['instruct2'];

    if (!ttsText) return showToast('请输入要合成的文字', 'error');
    if (!instructText) return showToast('请输入语音指令', 'error');
    if (!promptWav) return showToast('请上传或录制参考音频', 'error');

    await generateAudio('instruct2', () => callInstruct2(ttsText, instructText, promptWav, updateProgress), {
      text: ttsText,
      instructText,
    });
  });
}

function updateProgress(totalBytes) {
  const statusEl = document.getElementById('loadingStatus');
  if (statusEl) {
    const kb = (totalBytes / 1024).toFixed(1);
    statusEl.textContent = `已接收 ${kb} KB 音频流...`;
  }
}

async function generateAudio(mode, apiFn, meta) {
  const resultEl = document.getElementById(`${toCamel(mode)}Result`);
  const playerEl = document.getElementById(`${toCamel(mode)}Player`);
  const genBtn = document.getElementById(`${toCamel(mode)}GenBtn`);

  showLoading(true);
  genBtn.disabled = true;

  // Show duration estimate
  const statusEl = document.getElementById('loadingStatus');
  if (statusEl && meta.text) {
    const est = estimateDuration(meta.text);
    statusEl.textContent = `预计 ${est} 秒，请稍候...`;
  }

  try {
    const wavBlob = await apiFn();

    if (players[mode]) {
      players[mode].destroy();
    }

    resultEl.classList.remove('hidden');
    players[mode] = new AudioPlayer(playerEl, wavBlob);

    await saveToHistory({
      mode,
      audioBlob: wavBlob,
      ...meta,
    });
    refreshHistoryUI();

    showToast('✨ 语音生成成功！', 'success');
  } catch (err) {
    console.error('Generation error:', err);
    showToast(`生成失败: ${err.message}`, 'error');
  } finally {
    showLoading(false);
    genBtn.disabled = false;
    if (statusEl) statusEl.textContent = '请稍候，可能需要几秒到一分钟';
  }
}

// ============================
// Batch Mode
// ============================
let batchFormat = 'wav';

function initBatchMode() {
  // Mode toggle
  const singleBtn = document.getElementById('sftModeSingle');
  const batchBtn = document.getElementById('sftModeBatch');
  const singleMode = document.getElementById('sftSingleMode');
  const batchMode = document.getElementById('sftBatchMode');

  singleBtn.addEventListener('click', () => {
    singleBtn.classList.add('active');
    batchBtn.classList.remove('active');
    singleMode.classList.remove('hidden');
    batchMode.classList.add('hidden');
  });

  batchBtn.addEventListener('click', () => {
    batchBtn.classList.add('active');
    singleBtn.classList.remove('active');
    batchMode.classList.remove('hidden');
    singleMode.classList.add('hidden');
  });

  // Batch text counter + time estimate
  const batchText = document.getElementById('sftBatchText');
  const batchCount = document.getElementById('sftBatchCount');
  const batchEstimate = document.getElementById('sftBatchEstimate');

  batchText.addEventListener('input', () => {
    const lines = batchText.value.split('\n').filter(l => l.trim());
    batchCount.textContent = `${lines.length} 条`;
    const totalChars = lines.reduce((sum, l) => sum + l.length, 0);
    const est = lines.length > 0 ? estimateDuration(batchText.value.replace(/\n/g, '')) : 0;
    batchEstimate.textContent = est > 0 ? `预计 ~${est} 秒` : '';
  });

  // Batch generate button
  document.getElementById('sftBatchGenBtn').addEventListener('click', async () => {
    const text = document.getElementById('sftBatchText').value;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const spkId = document.querySelector('#sftSpeakerGrid .speaker-chip.active')?.dataset.spk;

    if (lines.length === 0) return showToast('请输入至少一条文本', 'error');
    if (!spkId) return showToast('请选择一个音色', 'error');

    const genBtn = document.getElementById('sftBatchGenBtn');
    const progress = document.getElementById('sftBatchProgress');
    const progressFill = document.getElementById('sftBatchProgressFill');
    const progressText = document.getElementById('sftBatchProgressText');
    const itemList = document.getElementById('sftBatchItemList');

    genBtn.disabled = true;
    progress.classList.remove('hidden');
    progressFill.style.width = '0%';
    itemList.innerHTML = '';

    // Render initial item list
    lines.forEach((line, i) => {
      itemList.innerHTML += `<div class="batch-item" id="batchItem${i}">
        <span class="batch-item-status">⏳</span>
        <span class="batch-item-text">${escapeHtml(line.slice(0, 60))}</span>
      </div>`;
    });

    try {
      const items = await runBatch(
        lines,
        (text) => callSFT(text, spkId, null),
        (item, completed, total) => {
          const pct = Math.round((completed / total) * 100);
          progressFill.style.width = `${pct}%`;
          progressText.textContent = `${completed} / ${total} 完成`;

          // Update item UI
          const el = document.getElementById(`batchItem${item.index - 1}`);
          if (el) {
            el.className = `batch-item ${item.status}`;
            const statusEl = el.querySelector('.batch-item-status');
            if (item.status === 'generating') statusEl.textContent = '🔄';
            else if (item.status === 'done') statusEl.textContent = '✅';
            else if (item.status === 'error') statusEl.textContent = '❌';
          }
        }
      );

      const successCount = items.filter(i => i.status === 'done').length;
      const failCount = items.filter(i => i.status === 'error').length;

      if (successCount > 0) {
        progressText.textContent = `✅ ${successCount} 条成功${failCount > 0 ? `，❌ ${failCount} 条失败` : ''}，正在打包...`;
        const downloaded = await downloadBatchAsZip(items, { spkId, format: batchFormat });
        showToast(`📦 ${downloaded} 条音频已打包下载！`, 'success');
        progressText.textContent = `✅ 全部完成！${downloaded} 条已下载`;
      } else {
        showToast('全部生成失败，请检查服务端状态', 'error');
        progressText.textContent = '❌ 全部失败';
      }
    } catch (err) {
      showToast(`批量生成失败: ${err.message}`, 'error');
    } finally {
      genBtn.disabled = false;
    }
  });
}

function initFormatSelector() {
  const formatBtns = document.querySelectorAll('.format-btn');
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      batchFormat = btn.dataset.format;
    });
  });
}

function toCamel(mode) {
  const map = {
    'zero-shot': 'zeroShot',
    'sft': 'sft',
    'cross-lingual': 'crossLingual',
    'instruct2': 'instruct2',
  };
  return map[mode] || mode;
}

// ============================
// Loading Overlay
// ============================
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

// ============================
// Toast Notifications
// ============================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================
// History
// ============================
function initHistory() {
  const fab = document.getElementById('historyFab');
  const sidebar = document.getElementById('historySidebar');
  const closeBtn = document.getElementById('closeHistory');

  fab.addEventListener('click', () => {
    sidebar.classList.remove('hidden');
    refreshHistoryUI();
  });

  closeBtn.addEventListener('click', () => {
    sidebar.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!sidebar.classList.contains('hidden') &&
        !sidebar.contains(e.target) &&
        e.target !== fab && !fab.contains(e.target)) {
      sidebar.classList.add('hidden');
    }
  });
}

function refreshHistoryUI() {
  const list = document.getElementById('historyList');
  const items = getHistoryList();

  if (items.length === 0) {
    list.innerHTML = `<div class="history-empty">
      <p>📭 暂无历史记录</p>
      <p style="font-size:0.75rem;margin-top:8px">生成语音后将自动保存在这里</p>
    </div>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="history-item" data-id="${item.id}">
      <div class="history-item-header">
        <span class="history-mode">${getModeLabel(item.mode)}</span>
        <span class="history-time">${formatHistoryTime(item.timestamp)}</span>
      </div>
      <div class="history-text">${escapeHtml(item.text || '')}</div>
      <div class="history-actions">
        <button class="history-play-btn" data-id="${item.id}">▶ 播放</button>
        <button class="history-download-btn" data-id="${item.id}">💾 下载</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.history-play-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const blob = await getAudioBlob(btn.dataset.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        audio.addEventListener('ended', () => URL.revokeObjectURL(url));
      } else {
        showToast('音频数据未找到', 'error');
      }
    });
  });

  list.querySelectorAll('.history-download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const blob = await getAudioBlob(btn.dataset.id);
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `cosyvoice_${btn.dataset.id}.wav`;
        a.click();
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================
// Voice Library
// ============================
function initVoiceLibrary() {
  // Sync from filesystem first (restores voices after cache clear)
  syncFromFilesystem().then(restored => {
    if (restored > 0) {
      showToast(`🔄 从文件系统恢复了 ${restored} 个声音`, 'success');
    }
    refreshAllVoiceGrids();
  }).catch(err => {
    console.warn('[voicelib] sync failed:', err);
    refreshAllVoiceGrids();
  });

  document.getElementById('saveVoiceCancel').addEventListener('click', () => {
    document.getElementById('saveVoiceModal').classList.add('hidden');
    saveVoiceContext = null;
  });

  document.getElementById('saveVoiceConfirm').addEventListener('click', async () => {
    const name = document.getElementById('saveVoiceName').value.trim();
    if (!name) return showToast('请输入声音名称', 'error');
    if (!saveVoiceContext) return;

    const promptText = document.getElementById('saveVoicePromptText').value.trim();
    const tagsInput = document.getElementById('saveVoiceTags')?.value || '';
    const tags = tagsInput.split(/[,，]/).map(t => t.trim()).filter(Boolean);

    try {
      await saveVoiceProfile(
        { name, promptText, tags },
        saveVoiceContext.audioBlob
      );
      showToast(`✨ 声音「${name}」已保存到声音库`, 'success');
      document.getElementById('saveVoiceModal').classList.add('hidden');
      saveVoiceContext = null;
      refreshAllVoiceGrids();
    } catch (err) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  });

  document.getElementById('saveVoiceModal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      document.getElementById('saveVoiceModal').classList.add('hidden');
      saveVoiceContext = null;
    }
  });

  // Export voice library
  const exportBtn = document.getElementById('voiceLibExport');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        exportBtn.disabled = true;
        exportBtn.textContent = '⏳ 导出中...';
        const zipBlob = await exportVoiceLibrary();
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cosyvoice_voices_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ 声音库已导出', 'success');
      } catch (err) {
        showToast(`导出失败: ${err.message}`, 'error');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = '📤 导出';
      }
    });
  }

  // Import voice library
  const importBtn = document.getElementById('voiceLibImport');
  const importInput = document.getElementById('voiceLibImportFile');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        importBtn.disabled = true;
        importBtn.textContent = '⏳ 导入中...';
        const result = await importVoiceLibrary(file);
        showToast(`✅ 导入完成：${result.imported} 个新增，${result.skipped} 个跳过`, 'success');
        refreshAllVoiceGrids();
      } catch (err) {
        showToast(`导入失败: ${err.message}`, 'error');
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = '📥 导入';
        importInput.value = '';
      }
    });
  }
}

function refreshAllVoiceGrids() {
  const modes = [
    { prefix: 'zeroShot', mode: 'zero-shot' },
    { prefix: 'crossLingual', mode: 'cross-lingual' },
    { prefix: 'instruct2', mode: 'instruct2' },
  ];

  const voices = getVoiceList();

  for (const { prefix, mode } of modes) {
    const grid = document.getElementById(`${prefix}VoiceGrid`);
    if (!grid) continue;

    if (voices.length === 0) {
      grid.innerHTML = '<span class="voice-lib-empty">暂无已保存的声音，上传或录制后可保存</span>';
      continue;
    }

    grid.innerHTML = voices.map(v => `
      <button class="voice-chip" data-voice-id="${v.id}" data-mode="${mode}">
        <span class="voice-chip-icon">🎙️</span>
        ${escapeHtml(v.name)}
        <span class="voice-chip-delete" data-voice-id="${v.id}" title="删除">✕</span>
      </button>
    `).join('');

    grid.querySelectorAll('.voice-chip').forEach(chip => {
      chip.addEventListener('click', async (e) => {
        if (e.target.classList.contains('voice-chip-delete')) {
          e.stopPropagation();
          const voiceId = e.target.dataset.voiceId;
          if (confirm(`确定删除这个声音？`)) {
            await deleteVoiceProfile(voiceId);
            showToast('声音已删除', 'success');
            refreshAllVoiceGrids();
          }
          return;
        }

        const voiceId = chip.dataset.voiceId;
        const voiceMeta = getVoiceById(voiceId);
        const audioBlob = await getVoiceAudio(voiceId);

        if (!audioBlob) {
          showToast('音频数据未找到', 'error');
          return;
        }

        grid.querySelectorAll('.voice-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const file = new File([audioBlob], `${voiceMeta.name}.wav`, { type: 'audio/wav' });
        audioFiles[mode] = file;

        const modePrefix = prefix;
        const preview = document.getElementById(`${modePrefix}Preview`);
        const audioEl = document.getElementById(`${modePrefix}Audio`);
        const fileNameEl = document.getElementById(`${modePrefix}FileName`);
        const uploadZone = document.getElementById(`${modePrefix}Upload`);
        const recordBtn = document.getElementById(`${modePrefix}RecordBtn`);

        audioEl.src = URL.createObjectURL(audioBlob);
        fileNameEl.textContent = `🎙️ ${voiceMeta.name}`;
        preview.classList.remove('hidden');
        uploadZone.classList.add('hidden');
        recordBtn.classList.add('hidden');

        if (mode === 'zero-shot' && voiceMeta.promptText) {
          const promptInput = document.getElementById('zeroShotPromptText');
          if (promptInput) promptInput.value = voiceMeta.promptText;
        }

        showToast(`已加载声音「${voiceMeta.name}」`, 'success');
      });
    });
  }
}
