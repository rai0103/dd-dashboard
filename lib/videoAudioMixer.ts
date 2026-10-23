// [dd-dashboard移植版] investment-shorts (lib/audioMixer.ts) を移植。
// investment-shorts側はNext.jsの相対パス `/api/tts` を叩いていたが、dd-dashboardは `output: "export"` の
// 完全静的サイトのためRoute Handlerを持てない。代わりにスタンドアロンのローカルTTSヘルパーサーバー（tts-server/、既定で
// http://localhost:4100）を呼び出す。ポートは setTtsBaseUrl() で変更可能（investment-shortsは無改変）。
// [AivisSpeech対応] voiceが "aivis:" で始まる場合だけ、tts-serverを経由せずブラウザから直接AivisSpeechエンジンへ
// つなぐ（lib/videoAivisClient.ts）。CORS等で失敗したときの既存の声への自動フォールバックは
// fetchNarrationBufferSmart() で提供する（呼び出し側のDDDashboard.jsxが使う）。
import { isAivisVoice, parseAivisSpeakerId, synthesizeAivis } from './videoAivisClient';

let TTS_BASE_URL = 'http://localhost:4100';
/** ローカルTTSヘルパーサーバーのベースURLを変更する（既定: http://localhost:4100） */
export function setTtsBaseUrl(url: string): void { TTS_BASE_URL = url.replace(/\/$/, ''); }
export function getTtsBaseUrl(): string { return TTS_BASE_URL; }
function ttsUrl(path: string): string { return `${TTS_BASE_URL}${path}`; }

export class AudioMixer {
  private ctx: AudioContext | null = null;
  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmToken = 0;
  private tapDest: MediaStreamAudioDestinationNode | null = null;
  private bufSources: AudioBufferSourceNode[] = [];
  private bufferCache = new Map<string, AudioBuffer>();

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    const ctx = this.getContext();
    if (!ctx) return null;
    const res = await fetch(url);
    const data = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    this.bufferCache.set(url, buffer);
    return buffer;
  }

  /** 録画用：BGM の音声を取り出すストリームを作る（再生音はそのまま鳴る） */
  startRecordingTap(): MediaStream | null {
    const ctx = this.getContext();
    if (!ctx) return null;
    this.tapDest = ctx.createMediaStreamDestination();
    return this.tapDest.stream;
  }

  stopRecordingTap(): void {
    this.tapDest = null;
  }

  private narrationCache = new Map<string, AudioBuffer>();
  private narrationSrc: AudioBufferSourceNode | null = null;
  private narrationToken = 0;

  /** サーバー(Windows音声合成)の日本語音声一覧 */
  async listServerVoices(): Promise<string[]> {
    try {
      const res = await fetch(ttsUrl('/api/tts'));
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j.voices) ? j.voices : [];
    } catch { return []; }
  }

  /** 声（ローカルTTSサーバー、またはAivisSpeech）でナレーションのWAVを取得（同じ条件はキャッシュ） */
  async fetchNarrationBuffer(text: string, rate: number, voice: string, pitch = 1): Promise<AudioBuffer> {
    const ctx = this.getContext();
    if (!ctx) throw new Error('音声を初期化できません');
    const key = `${voice}|${rate}|${pitch}|${text}`;
    const cached = this.narrationCache.get(key);
    if (cached) return cached;
    let buf: AudioBuffer;
    if (isAivisVoice(voice)) {
      const speakerId = parseAivisSpeakerId(voice);
      if (speakerId === null) throw new Error('AivisSpeechの声の指定が不正です: ' + voice);
      // 高さを変える分、合成時の速さを逆に補正する（最終的な話速は rate のまま。tts-server側の仕組みと同じ）
      const wav = await synthesizeAivis(text, speakerId, rate / pitch);
      buf = await ctx.decodeAudioData(wav);
    } else {
      const res = await fetch(ttsUrl('/api/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 高さを変える分、合成時の速さを逆に補正する（最終的な話速は rate のまま）
        body: JSON.stringify({ text, rate: rate / pitch, voice }),
      });
      if (!res.ok) throw new Error(await res.text());
      buf = await ctx.decodeAudioData(await res.arrayBuffer());
    }
    if (Math.abs(pitch - 1) > 0.001) buf = await this.resample(buf, pitch);
    this.narrationCache.set(key, buf);
    return buf;
  }

  /**
   * 声を合成する。AivisSpeechの声で、エンジンが止まっている・CORS等で接続できない場合は、
   * fallbackVoice（ローカルTTSサーバーの声）で合成し直す。usedFallback が true のときは、
   * 呼び出し側（UI）で選択中の声を fallbackVoice に切り替えること。
   */
  async fetchNarrationBufferSmart(text: string, rate: number, voice: string, pitch: number, fallbackVoice: string): Promise<{ buffer: AudioBuffer; usedFallback: boolean }> {
    if (!isAivisVoice(voice) || !fallbackVoice) {
      return { buffer: await this.fetchNarrationBuffer(text, rate, voice, pitch), usedFallback: false };
    }
    try {
      return { buffer: await this.fetchNarrationBuffer(text, rate, voice, pitch), usedFallback: false };
    } catch (e) {
      console.warn('AivisSpeechに接続できないため、既存の声に切り替えます:', e);
      return { buffer: await this.fetchNarrationBuffer(text, rate, fallbackVoice, pitch), usedFallback: true };
    }
  }

  /** 再生速度を pitch 倍にして書き出し直す（声の高さが pitch 倍になり、長さは 1/pitch になる） */
  private async resample(buf: AudioBuffer, pitch: number): Promise<AudioBuffer> {
    const off = new OfflineAudioContext(buf.numberOfChannels, Math.max(1, Math.ceil(buf.length / pitch)), buf.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    src.connect(off.destination);
    src.start();
    return off.startRendering();
  }

  /** 画面確認用：サーバー音声で読み上げ（動画に入る声と同じ）。読み終わりで解決 */
  async speakServer(text: string, rate: number, voice: string, pitch = 1): Promise<void> {
    const ctx = this.getContext();
    if (!ctx) return;
    this.stopNarration();
    const token = ++this.narrationToken;
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await this.fetchNarrationBuffer(text, rate, voice, pitch);
    if (token !== this.narrationToken) return;
    await new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      this.narrationSrc = src;
      src.start();
    });
  }

  /** 指定秒数後にバッファを再生（画面の音と録画の両方に流す）。長さ(秒)を返す。
   *  offsetSec>0のとき、バッファの途中（その秒数だけ経過した地点）から再生を始める（シーク位置からの再開用） */
  playBufferAfter(buffer: AudioBuffer, delaySec: number, volume = 1, offsetSec = 0): number {
    const ctx = this.getContext();
    if (!ctx) return 0;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    if (this.tapDest) gain.connect(this.tapDest);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    const safeOffset = Math.min(Math.max(0, offsetSec), Math.max(0, buffer.duration - 0.001));
    src.start(ctx.currentTime + Math.max(0, delaySec), safeOffset);
    this.bufSources.push(src);
    src.onended = () => { this.bufSources = this.bufSources.filter(x => x !== src); };
    return buffer.duration;
  }

  /**
   * BGM再生（登録したMP3）。
   * Web Audio のバッファをループ再生するので、繋ぎ目に無音が入らない（シームレスループ）
   */
  /** offsetSec: シーク位置から再開するとき、BGMも同じ秒数だけ進めた地点から鳴らす（曲の長さで割った余り） */
  async playBGM(url: string, volume: number, loop: boolean = true, offsetSec: number = 0): Promise<void> {
    this.stopBGM();
    const token = ++this.bgmToken;
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = await this.loadBuffer(url);
      // 読み込み中に停止・別曲へ切り替えられたら再生しない
      if (!buffer || token !== this.bgmToken) return;

      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, Math.max(0, volume / 100));
      gain.connect(ctx.destination);
      if (this.tapDest) gain.connect(this.tapDest);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.connect(gain);
      const safeOffset = buffer.duration > 0 ? Math.max(0, offsetSec) % buffer.duration : 0;
      source.start(0, safeOffset);

      this.bgmSource = source;
      this.bgmGain = gain;
    } catch (err) {
      console.warn('BGMを再生できません', err);
    }
  }

  stopBGM(): void {
    this.bgmToken++;
    if (this.bgmSource) {
      try { this.bgmSource.stop(); } catch { /* 既に停止 */ }
      this.bgmSource.disconnect();
      this.bgmSource = null;
    }
    if (this.bgmGain) {
      this.bgmGain.disconnect();
      this.bgmGain = null;
    }
  }

  /** 指定秒数かけて音量を下げ、止める */
  fadeBGM(duration: number = 2): void {
    const ctx = this.ctx;
    const gain = this.bgmGain;
    const source = this.bgmSource;
    if (!ctx || !gain || !source) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    try { source.stop(now + duration + 0.05); } catch { /* 既に停止 */ }
  }

  updateBGMVolume(volume: number): void {
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setValueAtTime(Math.min(1, Math.max(0, volume / 100)), this.ctx.currentTime);
    }
  }

  /**
   * ナレーション再生
   * voiceIndex が空のときは、最も自然な日本語音声を自動選択する
   */
  playNarration(text: string, rate: number = 1.0, pitch: number = 1.0, voiceIndex?: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve();
        return;
      }

      const synth = window.speechSynthesis;
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.lang = 'ja-JP';

      const voices = synth.getVoices();
      const chosen = voiceIndex && voices[parseInt(voiceIndex)]
        ? voices[parseInt(voiceIndex)]
        : this.getJapaneseVoices()[0];
      if (chosen) utterance.voice = chosen;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      synth.speak(utterance);
    });
  }

  stopNarration(): void {
    this.narrationToken++;
    try { this.narrationSrc?.stop(); } catch { /* 無視 */ }
    this.narrationSrc = null;
    this.bufSources.forEach(s => { try { s.stop(); } catch { /* 無視 */ } });
    this.bufSources = [];
    if (typeof window !== 'undefined') window.speechSynthesis.cancel();
  }

  /**
   * 利用可能な音声一覧取得
   */
  getAvailableVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined') return [];
    const synth = window.speechSynthesis;
    return synth.getVoices();
  }

  /**
   * 音声の自然さの目安スコア（高いほど流ちょう・男性寄り）
   * Natural/Online（ニューラル音声）を最優先する
   */
  static voiceScore(v: SpeechSynthesisVoice): number {
    const n = v.name;
    let score = 0;
    if (/natural/i.test(n)) score += 100;
    if (/online/i.test(n)) score += 50;
    if (/google/i.test(n)) score += 20;
    if (/ichiro|keita|takumi|ken\b|otoya|hattori|ryusei|naoki|daichi|kenji|male|男性/i.test(n) && !/female/i.test(n)) score += 30;
    if (/haruka|ayumi|sayaka|nanami|ayako|mayu|shiori|aoi|hikari|female|女性/i.test(n)) score -= 30;
    return score;
  }

  /**
   * 日本語音声を、自然さの高い順に返す
   */
  getJapaneseVoices(): SpeechSynthesisVoice[] {
    return this.getAvailableVoices()
      .filter(v => v.lang.replace('_', '-').toLowerCase().startsWith('ja'))
      .sort((a, b) => AudioMixer.voiceScore(b) - AudioMixer.voiceScore(a));
  }

  /**
   * 日本語男性音声（互換用）
   */
  getJapaneseMaleVoices(): SpeechSynthesisVoice[] {
    return this.getJapaneseVoices();
  }
}
