import { dotProduct, l2Normalize } from './l2-vector';

export const BGM_FINGERPRINT_DIM = 64;
export const DEFAULT_BGM_MATCH_THRESHOLD = 0.88;
export const DEFAULT_CLAP_MATCH_THRESHOLD = 0.78;

export type BgmSeverity = 'block' | 'penalty';
export type BgmEmbedderMode = 'dsp' | 'clap';

export interface BgmFingerprintAnchor {
  id: string;
  label: string;
  severity: BgmSeverity;
  embedder?: BgmEmbedderMode;
  embedding: Float32Array;
}

export interface BgmMatchResult {
  matched: boolean;
  score: number;
  anchor?: BgmFingerprintAnchor;
}

export interface AudioStyleAnalysis {
  /** 0..1 pounding bass beat strength (107-150 BPM EDM / 土嗨 remix). */
  bassBeatScore: number;
  /** 0..1 short-period spectral autocorrelation (0.56s-2.4s repetitive meme loop). */
  loopScore: number;
  /** True when the 4s clip is mostly calm human speech without heavy BGM. */
  isLikelySpeechOnly: boolean;
  /** True when physical style strongly indicates annoying heavy bass remix or meme loop. */
  hardDisgust: boolean;
  /** Human-readable physical style tags. */
  flags: string[];
}

export interface CapturedAudioSample {
  fingerprint: Float32Array;
  style: AudioStyleAnalysis;
  /** Optional 48kHz mono PCM quantized to Int16 for local CLAP semantic audio inference. */
  pcmInt16?: number[];
}

/**
 * Curated list of heavily overused Bilibili/Douyin marketing & slop BGM titles.
 * Treated as a soft low-taste penalty signal rather than an unconditional ban.
 */
export const OVERUSED_BGM_TITLES: readonly string[] = [
  'sold out',
  'the spectre',
  'faded',
  'monody',
  'astronomia',
  'coffin dance',
  'sunburst',
  'nevada',
  'unstoppable',
  'star sky',
  'victory',
  'china-x',
  'intro (the xx)',
  '悬疑',
  '成功学',
];

export function matchOverusedBgmTitle(rawTitle: string | null | undefined): string | null {
  const lower = rawTitle?.trim().toLowerCase();
  if (!lower) return null;
  for (const kw of OVERUSED_BGM_TITLES) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

const NUM_BANDS = 16;
const MIN_FREQ_HZ = 60;
const MAX_FREQ_HZ = 6000;

function buildBandEdges(sampleRate: number, fftSize: number): Array<{
  startBin: number;
  endBin: number;
  weight: number;
  centerHz: number;
}> {
  const nyquist = sampleRate / 2;
  const binCount = fftSize / 2;
  const binHz = nyquist / binCount;
  const edges: Array<{ startBin: number; endBin: number; weight: number; centerHz: number }> = [];

  for (let b = 0; b < NUM_BANDS; b++) {
    const f0 = MIN_FREQ_HZ * Math.pow(MAX_FREQ_HZ / MIN_FREQ_HZ, b / NUM_BANDS);
    const f1 = MIN_FREQ_HZ * Math.pow(MAX_FREQ_HZ / MIN_FREQ_HZ, (b + 1) / NUM_BANDS);
    const centerHz = (f0 + f1) / 2;
    const startBin = Math.max(1, Math.floor(f0 / binHz));
    const endBin = Math.min(binCount - 1, Math.max(startBin + 1, Math.ceil(f1 / binHz)));
    // De-emphasize primary human speech formants (300-850 Hz) to stay robust against voiceover.
    const weight = centerHz >= 300 && centerHz <= 850 ? 0.65 : 1.2;
    edges.push({ startBin, endBin, weight, centerHz });
  }

  return edges;
}

function extractFrameBands(
  frames: Float32Array[],
  sampleRate: number,
  fftSize: number,
): {
  rawBands: Float32Array[];
  normBands: Float32Array[];
  edges: ReturnType<typeof buildBandEdges>;
} {
  const edges = buildBandEdges(sampleRate, fftSize);
  const rawBands: Float32Array[] = [];
  const normBands: Float32Array[] = [];

  for (const frame of frames) {
    const raw = new Float32Array(NUM_BANDS);
    const weighted = new Float32Array(NUM_BANDS);
    let meanWeighted = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      const { startBin, endBin, weight } = edges[b];
      let sum = 0;
      let count = 0;
      for (let i = startBin; i < endBin && i < frame.length; i++) {
        const db = Number.isFinite(frame[i]) ? Math.max(-100, Math.min(0, frame[i])) : -100;
        sum += db;
        count += 1;
      }
      const avgLinear = count > 0 ? (sum / count + 100) / 100 : 0;
      raw[b] = avgLinear;
      weighted[b] = avgLinear * weight;
      meanWeighted += weighted[b];
    }
    meanWeighted /= NUM_BANDS;
    if (meanWeighted < 0.08) continue;

    for (let b = 0; b < NUM_BANDS; b++) {
      weighted[b] = weighted[b] / (meanWeighted + 1e-4);
    }
    rawBands.push(raw);
    normBands.push(weighted);
  }

  return { rawBands, normBands, edges };
}

/**
 * Audio L1 physical style detector (zero ML model, < 3ms):
 * detects pounding 110-155 BPM bass beats (土嗨 remix) and short-period repetitive meme loops,
 * while gating out calm human speech.
 */
export function analyzeAudioStyle(
  frames: Float32Array[],
  sampleRate = 48000,
  fftSize = 2048,
): AudioStyleAnalysis {
  const { rawBands, edges } = extractFrameBands(frames, sampleRate, fftSize);
  const n = rawBands.length;
  if (n < 12) {
    return {
      bassBeatScore: 0,
      loopScore: 0,
      isLikelySpeechOnly: true,
      hardDisgust: false,
      flags: [],
    };
  }

  // 1. Sub-band dominance for speech gating + bass envelope extraction.
  const bassEnv = new Float32Array(n);
  let bassAvg = 0;
  let speechAvg = 0;
  let highAvg = 0;

  for (let t = 0; t < n; t++) {
    let bSum = 0;
    let bCnt = 0;
    let sSum = 0;
    let sCnt = 0;
    let hSum = 0;
    let hCnt = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      const hz = edges[b].centerHz;
      const val = rawBands[t][b];
      if (hz <= 170) {
        bSum += val;
        bCnt += 1;
      } else if (hz >= 300 && hz <= 900) {
        sSum += val;
        sCnt += 1;
      } else if (hz >= 2200) {
        hSum += val;
        hCnt += 1;
      }
    }
    const bVal = bCnt > 0 ? bSum / bCnt : 0;
    bassEnv[t] = bVal;
    bassAvg += bVal;
    speechAvg += sCnt > 0 ? sSum / sCnt : 0;
    highAvg += hCnt > 0 ? hSum / hCnt : 0;
  }
  bassAvg /= n;
  speechAvg /= n;
  highAvg /= n;

  // 2. Bass beat pulse score: combine bass presence, pulse variance, and 107-150 BPM lag correlation (lags 5..7 @ 80ms).
  let bassVar = 0;
  for (let t = 0; t < n; t++) {
    const d = bassEnv[t] - bassAvg;
    bassVar += d * d;
  }
  const bassVariance = bassVar / n;
  const bassStd = Math.sqrt(bassVariance);
  let maxBeatCorr = 0;
  if (bassStd > 0.025) {
    for (let lag = 5; lag <= 7 && lag < n - 4; lag++) {
      let cov = 0;
      const len = n - lag;
      for (let t = 0; t < len; t++) {
        cov += (bassEnv[t] - bassAvg) * (bassEnv[t + lag] - bassAvg);
      }
      const corr = cov / (len * bassVariance + 1e-6);
      if (corr > maxBeatCorr) maxBeatCorr = corr;
    }
  }
  // Bass must be genuinely strong relative to mid speech + have rhythmic pulse.
  const bassPresence = Math.min(1, Math.max(0, (bassAvg - 0.35) / 0.35));
  const pulseStrength = Math.min(1, bassStd / 0.09);
  const bassBeatScore = Number(
    Math.min(1, bassPresence * (0.45 * pulseStrength + 0.55 * Math.max(0, maxBeatCorr))).toFixed(3),
  );

  // 3. Short-period meme loop score: require a TRUE periodic peak (correlation must dip
  //    mid-cycle and rise back up at the repeat period) so steady ambient/cinematic intros
  //    (e.g. slow dramatic build-ups) never false-positive as repetitive meme loops.
  const meanBand = new Float32Array(NUM_BANDS);
  for (let t = 0; t < n; t++) {
    for (let b = 0; b < NUM_BANDS; b++) meanBand[b] += rawBands[t][b];
  }
  for (let b = 0; b < NUM_BANDS; b++) meanBand[b] /= n;

  const centeredFrames = rawBands.map((v) => {
    const c = new Float32Array(NUM_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) c[b] = v[b] - meanBand[b];
    return l2Normalize(c);
  });

  const maxLag = Math.min(28, Math.floor(n / 2));
  const lagCorrs = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sumSim = 0;
    const count = n - lag;
    for (let t = 0; t < count; t++) {
      sumSim += dotProduct(centeredFrames[t], centeredFrames[t + lag]);
    }
    lagCorrs[lag] = sumSim / count;
  }

  let maxLoopCorr = 0;
  for (let lag = 7; lag <= maxLag; lag++) {
    const corr = lagCorrs[lag];
    if (corr <= maxLoopCorr) continue;
    // Check that correlation dipped meaningfully between lag 2 and lag - 2 (true oscillation/repeat).
    let minBetween = 1;
    for (let k = 2; k <= lag - 2; k++) {
      if (lagCorrs[k] < minBetween) minBetween = lagCorrs[k];
    }
    if (corr - minBetween >= 0.35) {
      maxLoopCorr = corr;
    }
  }
  const loopScore = Number(Math.max(0, Math.min(1, maxLoopCorr)).toFixed(3));

  const isLikelySpeechOnly =
    speechAvg > bassAvg * 1.15 &&
    speechAvg > highAvg * 1.1 &&
    bassBeatScore < 0.35 &&
    loopScore < 0.65;

  const flags: string[] = [];
  if (!isLikelySpeechOnly && bassBeatScore >= 0.82) flags.push('土嗨重鼓点');
  if (!isLikelySpeechOnly && loopScore >= 0.85) flags.push('洗脑重复循环');

  return {
    bassBeatScore,
    loopScore,
    isLikelySpeechOnly,
    hardDisgust: flags.length > 0,
    flags,
  };
}

/**
 * Convert a sequence of FFT dB magnitude frames into a volume-invariant 64-dim
 * L2-normalized BGM acoustic fingerprint.
 */
export function computeBgmFingerprint(
  frames: Float32Array[],
  sampleRate = 48000,
  fftSize = 2048,
): Float32Array {
  const out = new Float32Array(BGM_FINGERPRINT_DIM);
  if (frames.length === 0) return out;

  const { normBands: frameBandEnergies } = extractFrameBands(frames, sampleRate, fftSize);
  const n = frameBandEnergies.length;
  if (n === 0) return out;

  // 1. Dims 0..15: Mean normalized sub-band energy (timbre profile).
  const mean = new Float32Array(NUM_BANDS);
  for (const v of frameBandEnergies) {
    for (let b = 0; b < NUM_BANDS; b++) mean[b] += v[b];
  }
  for (let b = 0; b < NUM_BANDS; b++) {
    mean[b] /= n;
    out[b] = mean[b];
  }

  // 2. Dims 16..31: Sub-band standard deviation (dynamic modulation / rhythm).
  for (let b = 0; b < NUM_BANDS; b++) {
    let varSum = 0;
    for (const v of frameBandEnergies) {
      const diff = v[b] - mean[b];
      varSum += diff * diff;
    }
    out[16 + b] = Math.sqrt(varSum / n) * 1.4;
  }

  // 3. Dims 32..47: Mean positive spectral flux per band (onset/beat texture).
  if (n > 1) {
    for (let t = 1; t < n; t++) {
      const prev = frameBandEnergies[t - 1];
      const curr = frameBandEnergies[t];
      for (let b = 0; b < NUM_BANDS; b++) {
        const flux = curr[b] - prev[b];
        if (flux > 0) out[32 + b] += flux;
      }
    }
    for (let b = 0; b < NUM_BANDS; b++) {
      out[32 + b] = (out[32 + b] / (n - 1)) * 1.6;
    }
  }

  // 4. Dims 48..63: Inter-band spectral contrast (harmonic slope).
  for (let b = 0; b < NUM_BANDS; b++) {
    const next = mean[(b + 1) % NUM_BANDS];
    out[48 + b] = (next - mean[b]) * 1.5;
  }

  return l2Normalize(out);
}

export function matchBgmFingerprint(
  probe: Float32Array,
  bank: BgmFingerprintAnchor[],
  threshold = DEFAULT_BGM_MATCH_THRESHOLD,
  embedder: BgmEmbedderMode = 'dsp',
): BgmMatchResult {
  let bestScore = 0;
  let bestAnchor: BgmFingerprintAnchor | undefined;

  for (const anchor of bank) {
    if ((anchor.embedder ?? 'dsp') !== embedder) continue;
    const sim = dotProduct(probe, anchor.embedding);
    if (sim > bestScore) {
      bestScore = sim;
      bestAnchor = anchor;
    }
  }

  return {
    matched: bestScore >= threshold,
    score: Number(bestScore.toFixed(4)),
    anchor: bestAnchor,
  };
}

interface AttachedAudioTap {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
}

const videoTapMap = new WeakMap<HTMLVideoElement, AttachedAudioTap>();

function getOrCreateAudioTap(video: HTMLVideoElement): AttachedAudioTap | null {
  const existing = videoTapMap.get(video);
  if (existing) {
    if (existing.ctx.state === 'suspended') {
      void existing.ctx.resume();
    }
    return existing;
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const source = ctx.createMediaElementSource(video);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const tap = { ctx, source, analyser };
    videoTapMap.set(video, tap);
    return tap;
  } catch {
    return null;
  }
}

/**
 * Sample live FFT frames (and optionally 3s of 48kHz mono PCM for CLAP) from a playing
 * Bilibili <video> element without interrupting playback or making network requests.
 */
export async function captureVideoAudioSample(
  video: HTMLVideoElement,
  durationMs = 4000,
  onProgress?: (pct: number) => void,
  capturePcm = false,
): Promise<CapturedAudioSample | null> {
  const tap = getOrCreateAudioTap(video);
  if (!tap) return null;
  if (tap.ctx.state === 'suspended') {
    await tap.ctx.resume().catch(() => {});
  }

  // Optional parallel PCM recorder for local CLAP model (capped at 3s @ 48kHz = 144,000 samples).
  const maxPcmSamples = Math.min(144_000, Math.round((durationMs / 1000) * tap.ctx.sampleRate));
  const pcmChunks: Int16Array[] = [];
  let pcmCount = 0;
  let scriptNode: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;

  if (capturePcm && typeof tap.ctx.createScriptProcessor === 'function') {
    try {
      scriptNode = tap.ctx.createScriptProcessor(4096, 1, 1);
      silentGain = tap.ctx.createGain();
      silentGain.gain.value = 0;
      scriptNode.onaudioprocess = (ev) => {
        if (video.paused || video.ended || pcmCount >= maxPcmSamples) return;
        const input = ev.inputBuffer.getChannelData(0);
        const take = Math.min(input.length, maxPcmSamples - pcmCount);
        const q = new Int16Array(take);
        for (let i = 0; i < take; i++) {
          q[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
        }
        pcmChunks.push(q);
        pcmCount += take;
      };
      tap.source.connect(scriptNode);
      scriptNode.connect(silentGain);
      silentGain.connect(tap.ctx.destination);
    } catch {
      scriptNode = null;
    }
  }

  const sampleIntervalMs = 80;
  const totalSteps = Math.max(10, Math.floor(durationMs / sampleIntervalMs));
  const frames: Float32Array[] = [];
  const binCount = tap.analyser.frequencyBinCount;

  try {
    for (let step = 0; step < totalSteps; step++) {
      await new Promise((resolve) => window.setTimeout(resolve, sampleIntervalMs));
      if (!video.paused && !video.ended) {
        const buf = new Float32Array(binCount);
        tap.analyser.getFloatFrequencyData(buf);
        frames.push(buf);
      }
      onProgress?.(Math.min(100, Math.round(((step + 1) / totalSteps) * 100)));
    }
  } finally {
    if (scriptNode) {
      try {
        tap.source.disconnect(scriptNode);
        scriptNode.disconnect();
        silentGain?.disconnect();
      } catch {
        // Ignore disconnect errors if node already detached.
      }
    }
  }

  if (frames.length < 12) return null;
  const fingerprint = computeBgmFingerprint(frames, tap.ctx.sampleRate, tap.analyser.fftSize);
  let normSq = 0;
  for (let i = 0; i < fingerprint.length; i++) normSq += fingerprint[i] * fingerprint[i];
  if (normSq <= 0.01) return null;

  const style = analyzeAudioStyle(frames, tap.ctx.sampleRate, tap.analyser.fftSize);

  let pcmInt16: number[] | undefined;
  if (pcmCount >= 24_000) {
    const merged = new Array<number>(pcmCount);
    let offset = 0;
    for (const chunk of pcmChunks) {
      for (let i = 0; i < chunk.length; i++) {
        merged[offset++] = chunk[i];
      }
    }
    pcmInt16 = merged;
  }

  return { fingerprint, style, pcmInt16 };
}

export async function captureVideoAudioFingerprint(
  video: HTMLVideoElement,
  durationMs = 4000,
  onProgress?: (pct: number) => void,
): Promise<Float32Array | null> {
  const sample = await captureVideoAudioSample(video, durationMs, onProgress);
  return sample?.fingerprint ?? null;
}

/**
 * Fast in-place radix-2 Cooley-Tukey FFT (power-of-2 length) for offline PCM spectral analysis.
 */
function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(angle);
    const wLenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Offline PCM analyzer for hover pre-checking (~12s decoded audio):
 * automatically skips the first 2s intro, selects the highest-energy 5s music window,
 * computes 80ms-hop FFT dB frames, and returns the exact same CapturedAudioSample.
 */
export function analyzeDecodedPcm(
  pcm: Float32Array,
  sampleRate: number,
  capturePcmForClap = false,
): CapturedAudioSample | null {
  if (pcm.length < sampleRate * 1.5) return null;

  const totalSec = pcm.length / sampleRate;
  const skipSamples = totalSec >= 7 ? Math.floor(2 * sampleRate) : 0;
  const windowSamples = Math.min(pcm.length - skipSamples, Math.floor(5 * sampleRate));
  if (windowSamples < sampleRate * 1.2) return null;

  // Slide a 5s window (1s step) after the intro to pick the loudest BGM segment.
  const stepSamples = Math.max(1, Math.floor(sampleRate));
  let bestStart = skipSamples;
  let bestEnergy = -1;
  for (let s = skipSamples; s + windowSamples <= pcm.length; s += stepSamples) {
    let energy = 0;
    for (let i = s; i < s + windowSamples; i += 8) {
      energy += pcm[i] * pcm[i];
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = s;
    }
  }

  const fftSize = 2048;
  const hopSamples = Math.max(256, Math.round(0.08 * sampleRate));
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const frames: Float32Array[] = [];
  const halfBins = fftSize >> 1;

  for (let pos = bestStart; pos + fftSize <= bestStart + windowSamples; pos += hopSamples) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = pcm[pos + i] * hann[i];
      im[i] = 0;
    }
    fftRadix2(re, im);
    const dbFrame = new Float32Array(halfBins);
    for (let k = 0; k < halfBins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (fftSize * 0.5);
      dbFrame[k] = mag > 1e-6 ? Math.max(-100, 20 * Math.log10(mag)) : -100;
    }
    frames.push(dbFrame);
  }

  if (frames.length < 12) return null;
  const fingerprint = computeBgmFingerprint(frames, sampleRate, fftSize);
  let normSq = 0;
  for (let i = 0; i < fingerprint.length; i++) normSq += fingerprint[i] * fingerprint[i];
  if (normSq <= 0.01) return null;

  const style = analyzeAudioStyle(frames, sampleRate, fftSize);

  let pcmInt16: number[] | undefined;
  if (capturePcmForClap) {
    // Extract up to 3s from the peak window, resampled to 48kHz if needed.
    const targetSr = 48000;
    const srcLen = Math.min(windowSamples, Math.floor(3 * sampleRate));
    const dstLen = Math.min(144_000, Math.round((srcLen / sampleRate) * targetSr));
    const out = new Array<number>(dstLen);
    const ratio = srcLen / dstLen;
    for (let i = 0; i < dstLen; i++) {
      const idx = bestStart + Math.min(srcLen - 1, Math.floor(i * ratio));
      out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[idx] * 32767)));
    }
    pcmInt16 = out;
  }

  return { fingerprint, style, pcmInt16 };
}

/**
 * Fetch the first ~12-15s of Bilibili DASH audio for a single hovered BV card,
 * decode it silently offline, and return its audio sample + optional BGM title.
 */
export async function fetchAndAnalyzeBiliHoverAudio(
  bvid: string,
  capturePcmForClap = false,
  signal?: AbortSignal,
): Promise<{ sample: CapturedAudioSample | null; bgmTitle?: string }> {
  try {
    // 1. Get cid (and any official bgm info) from Bilibili's lightweight view API.
    const viewRes = await fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      { credentials: 'include', signal },
    );
    if (!viewRes.ok) return { sample: null };
    const viewJson = (await viewRes.json()) as {
      data?: { cid?: number; pages?: Array<{ cid?: number }> };
    };
    const cid = viewJson.data?.cid ?? viewJson.data?.pages?.[0]?.cid;
    if (!cid) return { sample: null };

    // 2. Request DASH audio stream URLs (pick lowest-bandwidth audio track ~64kbps to save data).
    const playRes = await fetch(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=16&fnval=16`,
      { credentials: 'include', signal },
    );
    if (!playRes.ok) return { sample: null };
    const playJson = (await playRes.json()) as {
      data?: {
        dash?: {
          audio?: Array<{
            bandwidth?: number;
            baseUrl?: string;
            base_url?: string;
            backupUrl?: string[];
          }>;
        };
      };
    };
    const audioTracks = playJson.data?.dash?.audio;
    if (!Array.isArray(audioTracks) || audioTracks.length === 0) return { sample: null };

    const sorted = [...audioTracks].sort((a, b) => (a.bandwidth ?? 0) - (b.bandwidth ?? 0));
    const audioUrl = sorted[0]?.baseUrl ?? sorted[0]?.base_url ?? sorted[0]?.backupUrl?.[0];
    if (!audioUrl) return { sample: null };

    // 3. Fetch first 160 KB (~12-18s of 64kbps AAC) with Range header.
    const audioRes = await fetch(audioUrl, {
      headers: { Range: 'bytes=0-163839' },
      signal,
    });
    if (!audioRes.ok && audioRes.status !== 206) return { sample: null };
    const arrayBuffer = await audioRes.arrayBuffer();
    if (arrayBuffer.byteLength < 8192) return { sample: null };

    // 4. Decode completely silently using OfflineAudioContext / AudioContext.
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return { sample: null };
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const mono = decoded.getChannelData(0);
      const sample = analyzeDecodedPcm(mono, decoded.sampleRate, capturePcmForClap);
      return { sample };
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    return { sample: null };
  }
}
