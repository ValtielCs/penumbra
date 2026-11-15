"""Encode the rendered demo-video frames (docs/_video/vf-NNN.webp from docs/video.html#render) into
docs/penumbra-demo-30s.mp4: H.264, plays in every browser (also straight from GitHub Pages) and uploads to YouTube.

OpenCV can only write MPEG-4 Part 2 ("mp4v") here, which browsers do not play. So the frames go into an mp4v
intermediate, the Windows Media Foundation encoder turns it into H.264 (tools/mp4-h264.ps1, no ffmpeg needed), and the
moov box is moved in front of the media data so playback starts before the whole file has arrived.
Usage: python tools/encode-video.py
"""
import glob
import os
import shutil
import struct
import subprocess
import sys
import tempfile

import cv2
import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FPS = 30
BITRATE = 5_000_000          # bits/s: sharp captions at 1280x720, about 18 MB for 29.5 s


def imread(path):
    # cv2.imread cannot open non-ASCII paths on Windows; decode from bytes instead
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def write_mp4v(frames, out):
    h, w = imread(frames[0]).shape[:2]
    writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h))
    if not writer.isOpened():
        sys.exit("could not open an mp4v writer")
    for f in frames:
        img = imread(f)
        if img is None or img.shape[:2] != (h, w):
            sys.exit(f"bad frame {f}")
        writer.write(img)
    writer.release()


def check(path, frames):
    """Frames read back, and the mean PSNR against the source frames over one frame per second."""
    cap, n, scores = cv2.VideoCapture(path), 0, []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if n % FPS == 15 and n < len(frames):
            scores.append(cv2.PSNR(imread(frames[n]), img))
        n += 1
    cap.release()
    return n, (sum(scores) / len(scores) if scores else float("nan"))


def faststart(path):
    """Move the moov box in front of mdat, shifting every chunk offset by its size (what `qt-faststart` does)."""
    d = open(path, "rb").read()
    top, off = [], 0
    while off + 8 <= len(d):
        size, typ = struct.unpack(">I4s", d[off:off + 8])
        if size == 1:
            size = struct.unpack(">Q", d[off + 8:off + 16])[0]
        elif size == 0:
            size = len(d) - off
        top.append((typ, off, size))
        off += size
    kinds = [t for t, _, _ in top]
    if b"moov" not in kinds or b"mdat" not in kinds or kinds.index(b"moov") < kinds.index(b"mdat"):
        return False
    _, mo, ms = top[kinds.index(b"moov")]
    moov = bytearray(d[mo:mo + ms])

    def shift(o, end):
        while o + 8 <= end:
            size, typ = struct.unpack(">I4s", moov[o:o + 8])
            if typ in (b"trak", b"mdia", b"minf", b"stbl"):
                shift(o + 8, o + size)
            elif typ in (b"stco", b"co64"):
                fmt, step = (">I", 4) if typ == b"stco" else (">Q", 8)
                for k in range(struct.unpack(">I", moov[o + 12:o + 16])[0]):
                    p = o + 16 + k * step
                    struct.pack_into(fmt, moov, p, struct.unpack(fmt, moov[p:p + step])[0] + ms)
            o += size

    shift(8, ms)
    with open(path, "wb") as f:
        for typ, o, s in top:
            if typ == b"mdat":
                f.write(moov)
            if typ != b"moov":
                f.write(d[o:o + s])
    return True


def codec(path):
    d = open(path, "rb").read()
    i = d.find(b"stsd")
    return d[i + 16:i + 20].decode("latin1") if i > 0 else "?"


def main():
    frames = sorted(glob.glob(os.path.join(ROOT, "docs", "_video", "vf-*.webp")))
    if not frames:
        sys.exit("no frames: open http://127.0.0.1:8787/docs/video.html#render first")
    if len(frames) / FPS > 30:
        sys.exit(f"{len(frames)} frames = {len(frames) / FPS:.1f} s: Space Apps allows at most 30 s")
    tmp = tempfile.gettempdir()                          # ASCII paths: OpenCV's FFmpeg cannot open non-ASCII ones
    mid, final = os.path.join(tmp, "penumbra-video-mp4v.mp4"), os.path.join(tmp, "penumbra-video-h264.mp4")
    write_mp4v(frames, mid)
    if sys.platform == "win32":
        subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                        os.path.join(ROOT, "tools", "mp4-h264.ps1"), mid, final, str(BITRATE)], check=True)
        faststart(final)
        os.remove(mid)
    else:
        print("not on Windows: keeping MPEG-4 Part 2 (fine for a YouTube upload, but browsers will not play it)")
        final = mid
    n, psnr = check(final, frames)
    out = os.path.join(ROOT, "docs", "penumbra-demo-30s.mp4")
    shutil.move(final, out)
    print(f"{os.path.relpath(out, ROOT)}: {codec(out)}, {len(frames)} frames, {n} read back, {len(frames) / FPS:.2f} s, "
          f"{os.path.getsize(out) / 1e6:.1f} MB, mean PSNR {psnr:.1f} dB")


if __name__ == "__main__":
    main()
