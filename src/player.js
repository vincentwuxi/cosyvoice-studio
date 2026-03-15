/**
 * Audio Player Module
 * Renders a custom audio player with waveform visualization.
 */

export class AudioPlayer {
  /**
   * Create a player in the given container
   * @param {HTMLElement} container 
   * @param {Blob} audioBlob - WAV blob
   */
  constructor(container, audioBlob) {
    this.container = container;
    this.audioBlob = audioBlob;
    this.audioUrl = URL.createObjectURL(audioBlob);
    this.audio = new Audio(this.audioUrl);
    this.isPlaying = false;
    this.audioCtx = null;
    this.analyser = null;
    this.animFrame = null;

    this._render();
    this._bindEvents();
  }

  _render() {
    this.container.innerHTML = `
      <div class="result-waveform">
        <canvas class="waveform-canvas"></canvas>
      </div>
      <div class="result-controls">
        <button class="play-btn" title="播放/暂停">▶</button>
        <div class="result-time">
          <span class="current-time">0:00</span> / <span class="total-time">--:--</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar">
            <div class="progress-fill"></div>
          </div>
        </div>
        <button class="download-btn">💾 下载</button>
      </div>
    `;

    // Add inline styles for progress bar
    const style = document.createElement('style');
    style.textContent = `
      .progress-bar-container {
        flex: 1;
        padding: 0 8px;
      }
      .progress-bar {
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        cursor: pointer;
        position: relative;
      }
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #818cf8, #34d399);
        border-radius: 2px;
        width: 0%;
        transition: width 0.1s linear;
      }
    `;
    this.container.appendChild(style);

    this.canvas = this.container.querySelector('.waveform-canvas');
    this.playBtn = this.container.querySelector('.play-btn');
    this.currentTimeEl = this.container.querySelector('.current-time');
    this.totalTimeEl = this.container.querySelector('.total-time');
    this.progressFill = this.container.querySelector('.progress-fill');
    this.progressBar = this.container.querySelector('.progress-bar');
    this.downloadBtn = this.container.querySelector('.download-btn');

    // Set canvas dimensions
    const rect = this.container.querySelector('.result-waveform');
    this.canvas.width = rect.clientWidth || 500;
    this.canvas.height = 80;
    this.canvasCtx = this.canvas.getContext('2d');
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
    });

    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.playBtn.textContent = '▶';
      cancelAnimationFrame(this.animFrame);
      this.progressFill.style.width = '0%';
    });

    this.progressBar.addEventListener('click', (e) => {
      const rect = this.progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      this.audio.currentTime = pct * this.audio.duration;
    });

    this.downloadBtn.addEventListener('click', () => this.download());

    // Draw static waveform from audio data
    this._drawStaticWaveform();
  }

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

  async _drawStaticWaveform() {
    try {
      const arrayBuffer = await this.audioBlob.arrayBuffer();
      const audioCtx = new OfflineAudioContext(1, 1, 22050);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const rawData = audioBuffer.getChannelData(0);

      const { width, height } = this.canvas;
      const samples = width;
      const step = Math.floor(rawData.length / samples);

      this.canvasCtx.fillStyle = '#0a0a0f';
      this.canvasCtx.fillRect(0, 0, width, height);

      for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += Math.abs(rawData[i * step + j] || 0);
        }
        const avg = sum / step;
        const barHeight = avg * height * 1.5;

        const gradient = this.canvasCtx.createLinearGradient(0, height / 2 - barHeight / 2, 0, height / 2 + barHeight / 2);
        gradient.addColorStop(0, 'rgba(129, 140, 248, 0.6)');
        gradient.addColorStop(0.5, 'rgba(129, 140, 248, 0.9)');
        gradient.addColorStop(1, 'rgba(52, 211, 153, 0.6)');

        this.canvasCtx.fillStyle = gradient;
        this.canvasCtx.fillRect(i, height / 2 - barHeight / 2, 1, barHeight || 1);
      }
    } catch (err) {
      console.warn('Waveform drawing failed:', err);
    }
  }

  download() {
    const a = document.createElement('a');
    a.href = this.audioUrl;
    a.download = `cosyvoice_${Date.now()}.wav`;
    a.click();
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
