"""Export reviewed captures. Usage: python3 export.py STILL_TAKE VIDEO_TAKE"""
import json
from pathlib import Path
import subprocess
import sys

repo = Path(__file__).resolve().parents[3]
still, video = (Path(p).resolve() for p in sys.argv[1:])
out = repo / 'docs/media/v0.13.1'
qa = video / 'qa'
out.mkdir(parents=True, exist_ok=True)
qa.mkdir(exist_ok=True)

def run(*args):
    subprocess.run([str(a) for a in args], check=True)

for name in ('workspace', 'project', 'channel'):
    run('magick', still / f'{name}.png', '-strip', '-define', 'png:compression-level=9', out / f'{name}.png')

meta = json.loads((video / 'capture.json').read_text())
# Remove only the page-load lead-in; preserve the continuous interaction at normal speed.
trim = meta['readyOffset'] + 0.15
run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', trim, '-i', video / 'walkthrough.webm',
    '-an', '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', out / 'walkthrough.mp4')
# The README teaser contains the same sequence at 2x speed, labelled in the demo notes.
run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', out / 'walkthrough.mp4',
    '-vf', 'setpts=PTS/2,fps=10,scale=1008:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', out / 'walkthrough.gif')
for stamp in (0, 5, 10, 15, 20, 24, 29, 34):
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', stamp, '-i', out / 'walkthrough.mp4',
        '-frames:v', '1', qa / f'frame-{stamp:02d}.png')
# Build a contact sheet without depending on system font configuration.
frames = sorted(qa.glob('frame-*.png'))
rows = []
for i in range(0, len(frames), 2):
    row = qa / f'row-{i}.png'
    run('magick', *frames[i:i+2], '-resize', '720x500', '+append', row)
    rows.append(row)
run('magick', *rows, '-append', qa / 'contact-sheet.png')
probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(out/'walkthrough.mp4')]))
assert not any(s['codec_type'] == 'audio' for s in probe['streams'])
assert all(p.stat().st_size < 10_000_000 for p in out.iterdir())
(qa / 'probe.json').write_text(json.dumps(probe, indent=2))
print(json.dumps({'output': str(out), 'duration': probe['format']['duration'],
                  'files': {p.name: p.stat().st_size for p in out.iterdir()}}, indent=2))
