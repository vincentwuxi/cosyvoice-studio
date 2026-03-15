/**
 * Audio Player Module (v2 — Waveform Selection + Trim)
 * Renders a professional audio player with:
 * - Static waveform visualization from decoded audio data
 * - Real-time frequency visualizer during playback
 * - Drag-to-select waveform region
 * - Trim/Crop selected region (keep or delete)
 * - Download trimmed or original audio
 */

export class AudioPlayer {
  /**
   * @param {HTMLElement} container
   * @param {Blob} audioBlob - WAV blob
   * @param {Object} opts - { showTrim: true, onTrimmed: null }
   */
  constructor(container, audioBlob, opts = {}) {
    this.container = container;
    this.audioBlob = audioBlob;
    this.audioUrl = URL.createObjectURL(audioBlob);
    this.audio = new Audio(this.audioUrl);
    this.isPlaying = false;
    this.audioCtx = null;
    this.analyser = null;
    this.animFrame = null;
    this.showTrim = opts.showTrim !== false;
    this.onTrimmed = opts.onTrimmed || null;

    // Waveform data cache
    this.audioBuffer = null;
    this.waveformData = null;

    // Selection state (in ratio 0-1)
    this.selStart = null;
    this.selEnd = null;
    this.isDragging = false;

    this._render();
    this._bindEvents();
  }

  _render() {
    const trimBtns = this.showTrim ? `
      <div class="trim-toolbar hidden" id="trimToolbar_${this._uid()}">
        <button class="trim-btn trim-keep" title="保留选中区域">✂️ 保留选区</button>
        <button class="trim-btn trim-delete" title="删除选中区域">🗑️ 删除选区</button>
        <button class="trim-btn trim-cancel" title="取消选区">✕ 取消</button>
        <span class="trim-info"></span>
      </div>
    ` : '';

    this.container.innerHTML = `
      <div class="result-waveform">
        <canvas class="waveform-canvas"></canvas>
        <div class="waveform-selection" style="display:none;"></div>
        <div class="waveform-playhead" style="display:none;"></div>
      </div>
      <div class="result-controls">
        <button class="play-btn" title="播放/暂停 (Space)">▶</button>
        <div class="result-time">
          <span class="current-time">0:00</span> / <span class="total-time">--:--</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar">
            <div class="progress-fill"></div>
          </div>
        </div>
        <button class="download-btn" title="下载 (Ctrl+S)">💾 下载</button>
      </div>
      ${trimBtns}
    `;

    this.canvas = this.container.querySelector('.waveform-canvas');
    this.playBtn = this.container.querySelector('.play-btn');
    this.currentTimeEl = this.container.querySelector('.current-time');
    this.totalTimeEl = this.container.querySelector('.total-time');
    this.progressFill = this.container.querySelector('.progress-fill');
    this.progressBar = this.container.querySelector('.progress-bar');
    this.downloadBtn = this.container.querySelector('.download-btn');
    this.selectionEl = this.container.querySelector('.waveform-selection');
    this.playheadEl = this.container.querySelector('.waveform-playhead');

    if (this.showTrim) {
      this.trimToolbar = this.container.querySelector(`#trimToolbar_${this._uid()}`);
      this.trimInfo = this.trimToolbar?.querySelector('.trim-info');
    }

    // Set canvas dimensions
    const waveformEl = this.container.querySelector('.result-waveform');
    this.canvas.width = waveformEl.clientWidth || 500;
    this.canvas.height = 80;
    this.canvasCtx = this.canvas.getContext('2d');
  }

  _uid() {
    if (!this._id) this._id = Math.random().toString(36).slice(2, 8);
    return this._id;
  }

  _bindEvents() {
    this.playBtn.addEventListener('click', () => this.togglePlay());

    this.audio.addEventListener('loadedmetadata', () => {
      this.totalTimeEl.textContent = this._formatTime(this.audio.duration);
    });

    this.audio.addEventListener('timeupdate', () => {
      this.currentTimeEl.textContent = this._formatTime(this.audio.currentTime);
      const pct = (this.audio.currentTime / this.audio.duration) * 100;
      this.progressFill.style.width = `${pct}%`;

      // Update playhead on waveform
      if (this.playheadEl && this.audio.duration) {
        const x = (this.audio.currentTime / this.audio.duration) * 100;
        this.playheadEl.style.display = 'block';
        this.playheadEl.style.left = `${x}%`;
      }
    });

    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.playBtn.textContent = '▶';
      cancelAnimationFrame(this.animFrame);
      this.progressFill.style.width = '0%';
      if (this.playheadEl) this.playheadEl.style.display = 'none';
    });

    this.progressBar.addEventListener('click', (e) => {
      const rect = this.progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      this.audio.currentTime = pct * this.audio.duration;
    });

    this.downloadBtn.addEventListener('click', () => this.download());

    // Waveform click-to-seek
    this.canvas.addEventListener('click', (e) => {
      if (this.isDragging) return; // don't seek if just finished dragging
      if (!this.audio.duration) return;
      const rect = this.canvas.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      this.audio.currentTime = pct * this.audio.duration;
    });

    // Waveform drag-to-select (for trimming)
    if (this.showTrim) {
      this._bindSelection();
      this._bindTrimButtons();
    }

    // Draw static waveform from audio data
    this._drawStaticWaveform();
  }

  // ============================
  // Selection (drag on waveform)
  // ============================
  _bindSelection() {
    let dragStart = null;

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      dragStart = (e.clientX - rect.left) / rect.width;
      this.isDragging = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (dragStart === null) return;
      this.isDragging = true;
      const rect = this.canvas.getBoundingClientRect();
      const current = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.selStart = Math.min(dragStart, current);
      this.selEnd = Math.max(dragStart, current);
      this._renderSelection();
    });

    const endDrag = () => {
      if (dragStart !== null && this.isDragging && this.selStart !== null && this.selEnd !== null) {
        const width = this.selEnd - this.selStart;
        if (width > 0.01) {
          // Valid selection
          this._showTrimToolbar();
        } else {
          this._clearSelection();
        }
      }
      dragStart = null;
      // Reset isDragging after a tick so click handler can check it
      setTimeout(() => { this.isDragging = false; }, 50);
    };

    this.canvas.addEventListener('mouseup', endDrag);
    this.canvas.addEventListener('mouseleave', endDrag);
  }

  _renderSelection() {
    if (this.selStart === null || this.selEnd === null) {
      this.selectionEl.style.display = 'none';
      return;
    }
    this.selectionEl.style.display = 'block';
    this.selectionEl.style.left = `${this.selStart * 100}%`;
    this.selectionEl.style.width = `${(this.selEnd - this.selStart) * 100}%`;

    // Redraw waveform with selection overlay on canvas
    if (this.waveformData) {
      this._drawWaveformWithSelection();
    }
  }

  _showTrimToolbar() {
    if (!this.trimToolbar) return;
    this.trimToolbar.classList.remove('hidden');
    if (this.trimInfo && this.audio.duration) {
      const startT = (this.selStart * this.audio.duration).toFixed(1);
      const endT = (this.selEnd * this.audio.duration).toFixed(1);
      const durT = (endT - startT).toFixed(1);
      this.trimInfo.textContent = `选区: ${startT}s - ${endT}s (${durT}s)`;
    }
  }

  _clearSelection() {
    this.selStart = null;
    this.selEnd = null;
    this.selectionEl.style.display = 'none';
    if (this.trimToolbar) this.trimToolbar.classList.add('hidden');
    // Redraw clean waveform
    if (this.waveformData) {
      this._drawWaveformFromData(this.waveformData);
    }
  }

  // ============================
  // Trim Controls
  // ============================
  _bindTrimButtons() {
    if (!this.trimToolbar) return;

    // Keep selection
    this.trimToolbar.querySelector('.trim-keep')?.addEventListener('click', () => {
      this._trimAudio('keep');
    });

    // Delete selection
    this.trimToolbar.querySelector('.trim-delete')?.addEventListener('click', () => {
      this._trimAudio('delete');
    });

    // Cancel
    this.trimToolbar.querySelector('.trim-cancel')?.addEventListener('click', () => {
      this._clearSelection();
    });
  }

  async _trimAudio(action) {
    if (!this.audioBuffer || this.selStart === null || this.selEnd === null) return;

    const sr = this.audioBuffer.sampleRate;
    const channels = this.audioBuffer.numberOfChannels;
    const totalSamples = this.audioBuffer.length;
    const selStartSample = Math.floor(this.selStart * totalSamples);
    const selEndSample = Math.floor(this.selEnd * totalSamples);

    let newLength;
    if (action === 'keep') {
      newLength = selEndSample - selStartSample;
    } else {
      newLength = totalSamples - (selEndSample - selStartSample);
    }

    if (newLength < sr * 0.1) {
      // Less than 100ms - too short
      return;
    }

    const offCtx = new OfflineAudioContext(channels, newLength, sr);
    const newBuffer = offCtx.createBuffer(channels, newLength, sr);

    for (let ch = 0; ch < channels; ch++) {
      const oldData = this.audioBuffer.getChannelData(ch);
      const newData = newBuffer.getChannelData(ch);

      if (action === 'keep') {
        // Copy only the selected region
        for (let i = 0; i < newLength; i++) {
          newData[i] = oldData[selStartSample + i];
        }
      } else {
        // Copy everything except the selected region
        let writeIdx = 0;
        for (let i = 0; i < totalSamples; i++) {
          if (i < selStartSample || i >= selEndSample) {
            newData[writeIdx++] = oldData[i];
          }
        }
      }

      // Apply tiny fade in/out to avoid clicks
      const fadeSamples = Math.min(Math.floor(sr * 0.01), 200);
      for (let i = 0; i < fadeSamples && i < newData.length; i++) {
        newData[i] *= i / fadeSamples; // fade in
      }
      for (let i = 0; i < fadeSamples && i < newData.length; i++) {
        newData[newData.length - 1 - i] *= i / fadeSamples; // fade out
      }
    }

    // Encode to WAV
    const wavBlob = this._bufferToWav(newBuffer);

    // Replace current audio
    this.audio.pause();
    this.isPlaying = false;
    this.playBtn.textContent = '▶';
    cancelAnimationFrame(this.animFrame);

    URL.revokeObjectURL(this.audioUrl);
    this.audioBlob = wavBlob;
    this.audioUrl = URL.createObjectURL(wavBlob);
    this.audio = new Audio(this.audioUrl);

    // Re-decode and redraw
    this.audioCtx = null; // Reset audio context for new source
    this._clearSelection();

    // Re-bind time events
    this.audio.addEventListener('loadedmetadata', () => {
      this.totalTimeEl.textContent = this._formatTime(this.audio.duration);
    });
    this.audio.addEventListener('timeupdate', () => {
      this.currentTimeEl.textContent = this._formatTime(this.audio.currentTime);
      const pct = (this.audio.currentTime / this.audio.duration) * 100;
      this.progressFill.style.width = `${pct}%`;
      if (this.playheadEl && this.audio.duration) {
        this.playheadEl.style.display = 'block';
        this.playheadEl.style.left = `${pct}%`;
      }
    });
    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.playBtn.textContent = '▶';
      cancelAnimationFrame(this.animFrame);
      this.progressFill.style.width = '0%';
      if (this.playheadEl) this.playheadEl.style.display = 'none';
    });

    await this._drawStaticWaveform();

    // Callback if provided
    if (this.onTrimmed) {
      this.onTrimmed(wavBlob);
    }
  }

  // ============================
  // WAV Encoder
  // ============================
  _bufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    // RIFF header
    this._writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    this._writeString(view, 8, 'WAVE');
    this._writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this._writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channels
    let offset = 44;
    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }

    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  _writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // ============================
  // Playback
  // ============================
  async togglePlay() {
    if (this.isPlaying) {
      this.audio.pause();
      this.playBtn.textContent = '▶';
      cancelAnimationFrame(this.animFrame);
    } else {
      await this.audio.play();
      this.playBtn.textContent = '⏸';
      this._startVisualizer();
    }
    this.isPlaying = !this.isPlaying;
  }

  _startVisualizer() {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      const source = this.audioCtx.createMediaElementSource(this.audio);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    }

    const draw = () => {
      if (!this.isPlaying) return;
      this.animFrame = requestAnimationFrame(draw);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(dataArray);

      const { width, height } = this.canvas;
      this.canvasCtx.fillStyle = 'rgba(10, 10, 15, 0.85)';
      this.canvasCtx.fillRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 2;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.85;
        const gradient = this.canvasCtx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#818cf8');
        gradient.addColorStop(1, '#34d399');
        this.canvasCtx.fillStyle = gradient;
        this.canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };

    draw();
  }

  // ============================
  // Static Waveform Drawing
  // ============================
  async _drawStaticWaveform() {
    try {
      const arrayBuffer = await this.audioBlob.arrayBuffer();
      const audioCtx = new OfflineAudioContext(1, 1, 22050);
      this.audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const rawData = this.audioBuffer.getChannelData(0);

      const { width } = this.canvas;
      const samples = width;
      const step = Math.floor(rawData.length / samples) || 1;

      // Build waveform data
      this.waveformData = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += Math.abs(rawData[i * step + j] || 0);
        }
        this.waveformData[i] = sum / step;
      }

      this._drawWaveformFromData(this.waveformData);
    } catch (err) {
      console.warn('Waveform drawing failed:', err);
    }
  }

  _drawWaveformFromData(data) {
    const { width, height } = this.canvas;
    this.canvasCtx.fillStyle = '#0a0a0f';
    this.canvasCtx.fillRect(0, 0, width, height);

    for (let i = 0; i < data.length; i++) {
      const barHeight = data[i] * height * 1.5;

      const gradient = this.canvasCtx.createLinearGradient(
        0, height / 2 - barHeight / 2,
        0, height / 2 + barHeight / 2
      );
      gradient.addColorStop(0, 'rgba(129, 140, 248, 0.6)');
      gradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.9)');
      gradient.addColorStop(1, 'rgba(52, 211, 153, 0.6)');

      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(i, height / 2 - barHeight / 2, 1, barHeight || 1);
    }
  }

  _drawWaveformWithSelection() {
    const data = this.waveformData;
    if (!data) return;

    const { width, height } = this.canvas;
    this.canvasCtx.fillStyle = '#0a0a0f';
    this.canvasCtx.fillRect(0, 0, width, height);

    const selStartPx = Math.floor((this.selStart || 0) * width);
    const selEndPx = Math.floor((this.selEnd || 0) * width);

    for (let i = 0; i < data.length; i++) {
      const barHeight = data[i] * height * 1.5;
      const inSelection = i >= selStartPx && i <= selEndPx;

      let gradient;
      if (inSelection) {
        gradient = this.canvasCtx.createLinearGradient(
          0, height / 2 - barHeight / 2,
          0, height / 2 + barHeight / 2
        );
        gradient.addColorStop(0, 'rgba(251, 191, 36, 0.7)'); // amber
        gradient.addColorStop(0.5, 'rgba(251, 191, 36, 1.0)');
        gradient.addColorStop(1, 'rgba(245, 158, 11, 0.7)');
      } else {
        gradient = this.canvasCtx.createLinearGradient(
          0, height / 2 - barHeight / 2,
          0, height / 2 + barHeight / 2
        );
        gradient.addColorStop(0, 'rgba(129, 140, 248, 0.4)');
        gradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.6)');
        gradient.addColorStop(1, 'rgba(52, 211, 153, 0.4)');
      }

      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(i, height / 2 - barHeight / 2, 1, barHeight || 1);
    }
  }

  // ============================
  // Public API
  // ============================
  download() {
    const a = document.createElement('a');
    a.href = this.audioUrl;
    a.download = `cosyvoice_${Date.now()}.wav`;
    a.click();
  }

  getBlob() {
    return this.audioBlob;
  }

  destroy() {
    this.audio.pause();
    cancelAnimationFrame(this.animFrame);
    if (this.audioCtx) this.audioCtx.close();
    URL.revokeObjectURL(this.audioUrl);
  }

  _formatTime(secs) {
    if (!isFinite(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
}
