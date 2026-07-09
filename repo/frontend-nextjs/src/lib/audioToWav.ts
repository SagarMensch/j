"use client";

/**
 * Converts any browser-recorded audio Blob (webm, mp4, ogg, etc.) into a
 * standard WAV Blob (16-bit PCM, mono) that Sarvam STT accepts.
 *
 * Uses the Web Audio API's decodeAudioData so there is zero server-side
 * dependency on ffmpeg or pydub.
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();

  const AudioContextCtor: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioContextCtor();

  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0); // mono

    // Float32 → Int16 PCM
    const pcm = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }

    // Build WAV container
    const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(wavBuffer);

    // RIFF header
    _writeStr(v, 0, "RIFF");
    v.setUint32(4, 36 + pcm.length * 2, true);
    _writeStr(v, 8, "WAVE");

    // fmt chunk
    _writeStr(v, 12, "fmt ");
    v.setUint32(16, 16, true);            // sub-chunk size
    v.setUint16(20, 1, true);             // PCM format
    v.setUint16(22, 1, true);             // mono
    v.setUint32(24, sampleRate, true);    // sample rate
    v.setUint32(28, sampleRate * 2, true); // byte rate
    v.setUint16(32, 2, true);             // block align
    v.setUint16(34, 16, true);            // bits per sample

    // data chunk
    _writeStr(v, 36, "data");
    v.setUint32(40, pcm.length * 2, true);

    new Int16Array(wavBuffer, 44).set(pcm);

    return new Blob([wavBuffer], { type: "audio/wav" });
  } finally {
    try { await ctx.close(); } catch { /* noop */ }
  }
}

function _writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
