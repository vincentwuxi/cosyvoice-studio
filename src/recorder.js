/**
 * Audio Recorder Module
 * Provides microphone recording with real-time waveform visualization.
 * Outputs WAV format compatible with CosyVoice API.
 */

export class AudioRecorder {
  constructor({ canvas, timeDisplay, onComplete }) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.timeDisplay = timeDisplay;
    this.onComplete = onComplete;
    
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.analyser = null;
    this.startTime = 0;
    this.timerInterval = null;
    this.animationFrame = null;
    this.isRecording = false;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
    } catch (err) {
      throw new Error('无法访问麦克风，请确保已授权');
    }

    // Set up analyser for waveform
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(this.stream);
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this._audioCtx = audioCtx;

    // Set up recorder
    this.audioChunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this._getSupportedMimeType()
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onstop = async () => {
      const blob = new Blob(this.audioChunks, { type: 'audio/wav' });
      // Convert to WAV via AudioContext for compatibility
      const wavBlob = await this._convertToWav(blob);
      if (this.onComplete) this.onComplete(wavBlob);
    };

    this.mediaRecorder.start(100);
    this.isRecording = true;
    this.startTime = Date.now();

    // Start timer
    this.timerInterval = setInterval(() => this._updateTimer(), 100);

    // Start waveform
    this._drawWaveform();
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    if (this._audioCtx) {
      this._audioCtx.close();
    }
    clearInterval(this.timerInterval);
    cancelAnimationFrame(this.animationFrame);
    this.isRecording = false;
  }

  _getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  _updateTimer() {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    if (this.timeDisplay) this.timeDisplay.textContent = `${mins}:${secs}`;
  }

  _drawWaveform() {
    if (!this.isRecording || !this.analyser || !this.ctx) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);

    const { width, height } = this.canvas;
    this.ctx.fillStyle = 'rgba(15, 15, 24, 0.3)';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = '#f87171';
    this.ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
      x += sliceWidth;
    }

    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();

    this.animationFrame = requestAnimationFrame(() => this._drawWaveform());
  }

  async _convertToWav(blob) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new OfflineAudioContext(1, 1, 16000);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      // Resample to 16kHz mono
      const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      
      const rendered = await offlineCtx.startRendering();
      const float32 = rendered.getChannelData(0);
      
      // Convert float32 to int16
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Create WAV
      return this._createWavBlob(int16.buffer, 16000, 1, 16);
    } catch (err) {
      console.warn('WAV conversion failed, using original blob:', err);
      return blob;
    }
  }

  _createWavBlob(pcmBuffer, sampleRate, channels, bitsPerSample) {
    const pcmData = new Uint8Array(pcmBuffer);
    const dataLength = pcmData.byteLength;
    const headerLength = 44;
    const buffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, headerLength + dataLength - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
    view.setUint16(32, channels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLength, true);
    new Uint8Array(buffer).set(pcmData, headerLength);

    return new Blob([buffer], { type: 'audio/wav' });
  }
}
