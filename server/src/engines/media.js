import { config } from '../config.js';
import { tools } from '../tools.js';
import { run } from './run.js';

const AUDIO_ONLY = new Set(['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'aiff', 'amr', 'weba', 'wma']);
const REMUXABLE = new Set(['mp4', 'mkv', 'mov', 'm4v']);

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

// Each heavy job gets a fair share of the CPU instead of all of it.
const threads = String(Math.max(1, Math.floor(config.cpus / config.heavyConcurrency)));

function parseTime(s) {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function videoQuality(q) {
  // crf per quality preset: lower = better
  return { high: 20, medium: 25, low: 30, tiny: 35 }[q] ?? 23;
}

function scaleFilter(height) {
  const h = num(height);
  return h ? `scale=-2:'min(${h},ih)'` : null;
}

function audioArgs(to, o) {
  const br = `${num(o.audioBitrate) || 192}k`;
  const args = [];
  if (num(o.sampleRate)) args.push('-ar', String(num(o.sampleRate)));
  if (o.channels === 'mono') args.push('-ac', '1');
  if (o.channels === 'stereo') args.push('-ac', '2');
  if (num(o.volume) && num(o.volume) !== 100) args.push('-af', `volume=${num(o.volume) / 100}`);
  switch (to) {
    case 'mp3': return [...args, '-c:a', 'libmp3lame', '-b:a', br];
    case 'wav': return [...args, '-c:a', 'pcm_s16le'];
    case 'aiff': return [...args, '-c:a', 'pcm_s16be'];
    case 'flac': return [...args, '-c:a', 'flac'];
    case 'aac':
    case 'm4a': return [...args, '-c:a', 'aac', '-b:a', br];
    case 'ogg': return [...args, '-c:a', 'libvorbis', '-b:a', br];
    case 'opus': return [...args, '-c:a', 'libopus', '-b:a', `${Math.min(num(o.audioBitrate) || 128, 256)}k`];
    default: return args;
  }
}

function videoArgs(to, o) {
  const crf = videoQuality(o.quality);
  const filters = [];
  const sf = scaleFilter(o.resolution);
  if (sf) filters.push(sf);
  // H.264 / 4:2:0 needs even dimensions; phone and screen recordings are often odd.
  else if (to !== 'gif') filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  if (num(o.fps)) filters.push(`fps=${num(o.fps)}`);
  const vf = filters.length ? ['-vf', filters.join(',')] : [];
  const mute = o.mute ? ['-an'] : null;
  switch (to) {
    case 'mp4':
    case 'mov':
    case 'mkv':
    case 'm4v':
      return [
        ...vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
        ...(mute || ['-c:a', 'aac', '-b:a', '160k']),
        ...(to === 'mp4' || to === 'mov' || to === 'm4v' ? ['-movflags', '+faststart'] : []),
      ];
    case 'webm':
      return [
        ...vf, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf + 8), '-deadline', 'realtime',
        '-cpu-used', '8', '-row-mt', '1', ...(mute || ['-c:a', 'libopus', '-b:a', '128k']),
      ];
    case 'avi':
      return [...vf, '-c:v', 'mpeg4', '-q:v', String(Math.round(crf / 5)), ...(mute || ['-c:a', 'libmp3lame', '-b:a', '192k'])];
    case 'gif': {
      const fps = num(o.fps) || 12;
      const w = num(o.gifWidth) || 480;
      return [
        '-filter_complex',
        `fps=${fps},scale='min(${w},iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
        '-loop', '0',
      ];
    }
    default:
      return vf;
  }
}

function hasTransforms(o) {
  return Boolean(o.resolution || o.fps || o.mute || o.quality || num(o.trimStart) || num(o.trimEnd));
}

/**
 * Converts audio/video with ffmpeg. Reports progress 0..1.
 */
export async function convertMedia({ input, output, from, to, options = {}, signal, onProgress }) {
  if (!tools.ffmpeg) throw new Error('Media conversion is not available on this server');
  const start = num(options.trimStart);
  const end = num(options.trimEnd);
  const pre = ['-hide_banner', '-nostdin', '-y'];
  const seek = start ? ['-ss', String(start)] : [];
  const dur = end && end > (start || 0) ? ['-t', String(end - (start || 0))] : [];

  let duration = null;
  const onStderr = (s) => {
    if (duration === null) {
      const m = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(s);
      if (m) {
        duration = parseTime(m[1]);
        if (end && end > (start || 0)) duration = Math.min(duration, end - (start || 0));
        else if (start) duration = Math.max(0.1, duration - start);
      }
    }
  };
  const onStdout = (s) => {
    const m = /out_time_(?:us|ms)=(\d+)/.exec(s);
    if (m && duration) onProgress?.(Math.min(0.99, Number(m[1]) / 1e6 / duration));
  };
  const common = { signal, onStderr, onStdout };
  const progress = ['-progress', 'pipe:1', '-nostats', '-threads', threads];

  // Fast path: container swap without re-encoding (near-zero CPU).
  if (REMUXABLE.has(from) && REMUXABLE.has(to) && from !== to && !hasTransforms(options)) {
    try {
      await run(tools.ffmpeg, [...pre, '-i', input, ...progress, '-map', '0', '-c', 'copy', ...(to === 'mkv' ? [] : ['-movflags', '+faststart']), output], common);
      return;
    } catch (e) {
      if (signal?.aborted) throw e;
      // fall through to a full re-encode
    }
  }

  const toAudio = AUDIO_ONLY.has(to);
  const codecArgs = toAudio ? ['-vn', ...audioArgs(to, options)] : videoArgs(to, options);
  await run(tools.ffmpeg, [...pre, ...seek, '-i', input, ...dur, ...progress, ...codecArgs, output], common);
}

/** Decode a single image with ffmpeg (used for BMP input). */
export async function decodeImageToPng(input, output, signal) {
  await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', input, '-frames:v', '1', output], { signal });
}
