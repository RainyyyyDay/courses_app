"""Windows local AI runner: restart only the owned worker without console signals."""
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent

def revision():
    return tuple((str(p),p.stat().st_mtime_ns) for p in sorted((ROOT/'src').glob('*.py')))

def stop(child):
    if child is not None and child.poll() is None:
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait()

def main():
    child=None
    def start():
        return subprocess.Popen([sys.executable,'-B','-m','uvicorn','test_app:app','--host','127.0.0.1','--port','3002','--no-proxy-headers'],
                                cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    try:
        version=revision();child=start()
        while True:
            time.sleep(1)
            if child.poll() is not None:return child.returncode or 1
            changed=revision()
            if changed!=version:
                stop(child);child=start();version=changed
    except KeyboardInterrupt:return 0
    finally:stop(child)

if __name__=='__main__':sys.exit(main())
