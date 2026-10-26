// 動画の書き出し（Canvas + BGM を MediaRecorder で録画）。FFmpeg などの外部ライブラリは使わない

export interface RecordingHandle {
  mimeType: string;
  extension: 'mp4' | 'webm';
  stop: () => Promise<Blob>;
}

// 優先順：WebM → MP4。ブラウザのMediaRecorderが生成するMP4は、録画しながら書き出す都合上、
// 総再生時間を録画開始時点では確定できず、ファイル先頭のmoov（mvhd・tkhd・mdhd）のdurationが
// 0のまま書き出される（fragmented MP4）既知の制約がある。多くのプレイヤーは末尾のフラグメントを
// 読んで長さを推測できるが、YouTube側の取り込み処理がこれを嫌って「処理を中止しました」として
// アップロードを失敗させることがある（毎回ではなく断続的）。WebMは同じ録画方式でもYouTubeへの
// アップロードで安定して動作するため、対応していれば常にWebMを使う（FFmpeg等の外部ライブラリは
// 使わず、録画形式の優先順位を変えるだけで回避する）。
const MIME_CANDIDATES: { mime: string; ext: 'mp4' | 'webm' }[] = [
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
];

export class VideoExporter {
  /**
   * 録画開始。Canvas の映像と、（あれば）BGM の音声を1本にまとめて録画する
   */
  startRecording(canvas: HTMLCanvasElement, audioStream: MediaStream | null, fps: number = 30): RecordingHandle {
    const canvasStream: MediaStream | undefined = (canvas as any).captureStream?.(fps);
    if (!canvasStream) throw new Error('このブラウザは Canvas の録画に対応していません');

    const tracks = [...canvasStream.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const stream = new MediaStream(tracks);

    const picked = MIME_CANDIDATES.find(c => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime));
    if (!picked) throw new Error('このブラウザは動画の録画形式に対応していません');

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: picked.mime,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(500);

    return {
      mimeType: picked.mime,
      extension: picked.ext,
      stop: () => new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          tracks.forEach(t => t.stop());
          resolve(new Blob(chunks, { type: picked.mime.split(';')[0] }));
        };
        recorder.onerror = (ev: any) => reject(new Error(`録画エラー: ${ev?.error?.message ?? 'unknown'}`));
        if (recorder.state !== 'inactive') recorder.stop();
        else recorder.onstop?.(new Event('stop'));
      }),
    };
  }

  /**
   * 動画ファイルをダウンロード
   */
  downloadVideo(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**
   * ファイルサイズをMBで取得
   */
  getFileSizeMB(blob: Blob): number {
    return blob.size / (1024 * 1024);
  }
}
