"""Development-only comparison; reference tools are never npm runtime dependencies."""
import argparse, json, os, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def measure(command):
    started = time.monotonic()
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    peak = 0
    while proc.poll() is None:
        todo = [proc.pid]
        rss = 0
        while todo:
            pid = todo.pop()
            try:
                status = Path(f'/proc/{pid}/status').read_text()
                rss += int(next(line.split()[1] for line in status.splitlines() if line.startswith('VmRSS:'))) * 1024
                todo.extend(int(x) for x in Path(f'/proc/{pid}/task/{pid}/children').read_text().split())
            except (OSError, StopIteration):
                pass
        peak = max(peak, rss)
        time.sleep(.005)
    stdout, stderr = proc.communicate()
    return {'ms': round((time.monotonic()-started)*1000), 'peakTreeRssBytes': peak, 'exit':proc.returncode, **({'error':stderr.decode(errors='replace')[-500:]} if proc.returncode else {})}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--compare', action='store_true', help='Use installed Ghostscript/MuPDF as development controls')
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    rows=[]
    for source in sorted(args.corpus.glob('*.pdf')):
        row={'name':source.name,'inputBytes':source.stat().st_size,'operations':[]}
        for mode,preset in [('lossless','/prepress'),('balanced','/ebook'),('strong','/screen')]:
            output=args.output/f'{source.stem}-{mode}.pdf'
            result=measure(['node',str(ROOT/'scripts/benchmark-worker.js'),str(source.resolve()),str(output.resolve()),mode])
            result.update(engine='pdfcraft',mode=mode)
            if result['exit']==0:
                result['bytes']=output.stat().st_size
                # Independent read/text check, optional development acceptance.
                if args.compare:
                    original=subprocess.check_output(['pdftotext',str(source),'-'])
                    rewritten=subprocess.check_output(['pdftotext',str(output),'-'])
                    result['textEqual']=original==rewritten
            row['operations'].append(result)
            if args.compare:
                control=args.output/f'{source.stem}-gs-{mode}.pdf'
                result=measure(['gs','-q','-dBATCH','-dNOPAUSE','-sDEVICE=pdfwrite',f'-dPDFSETTINGS={preset}',f'-sOutputFile={control}',str(source)])
                result.update(engine='ghostscript-control',mode=mode)
                if result['exit']==0: result['bytes']=control.stat().st_size
                row['operations'].append(result)
        image=args.output/f'{source.stem}-pdfcraft.png'
        result=measure(['node',str(ROOT/'scripts/benchmark-worker.js'),str(source.resolve()),str(image.resolve()),'render'])
        result.update(engine='pdfcraft',mode='render-72dpi')
        row['operations'].append(result)
        if args.compare:
            control=args.output/f'{source.stem}-mupdf.png'
            result=measure(['mutool','draw','-q','-r','72','-o',str(control),str(source),'1'])
            result.update(engine='mupdf-control',mode='render-72dpi')
            row['operations'].append(result)
        rows.append(row)
    (args.output/'results.json').write_text(json.dumps(rows,indent=2)+'\n')
    print(args.output/'results.json')

if __name__=='__main__': main()
