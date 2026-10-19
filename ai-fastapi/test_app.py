"""Development harness only; no database/login. Always mock, loopback clients only."""
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from src.ai_mistake import Config, register

app = FastAPI()


async def local_only(request: Request):
    host = request.headers.get("host", "").split(":", 1)[0]
    if (request.client is None or request.client.host not in {"127.0.0.1", "::1"} or
            host not in {"127.0.0.1", "localhost"} or
            request.headers.get("origin") not in {None, f"http://{request.headers.get('host')}"} or
            request.headers.get("x-forwarded-for")):
        raise HTTPException(status_code=403, detail="LOCAL_ONLY")


# Explicit Config() ignores all process model settings and keys in this harness.
register(app, dependencies=[Depends(local_only)], config=Config())

# Serve only public frontend assets, never the repository, .env or database.
FRONTEND = Path(__file__).resolve().parents[1] / "fronted"


@app.get("/", response_class=HTMLResponse, dependencies=[Depends(local_only)])
@app.get("/index.html", response_class=HTMLResponse, dependencies=[Depends(local_only)])
async def frontend():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    return html.replace("<head>", '<head><script>window.COURSES_AI_API_BASE="/api";window.COURSES_AI_LOCAL_MOCK=true;</script>', 1)


@app.get("/demo", response_class=HTMLResponse, dependencies=[Depends(local_only)])
async def demo():
    html = await frontend()
    # Existing detail UI with fictional data; no course API or SQLite is needed.
    script = """<script>
window.addEventListener('load', () => {
  currentCourseId = 42; currentView = {type:'mistake', id:11};
  const row = {id:11, course_id:42, title:'本机 Mock 联调（虚构题目）',
    content:'1+1=?', answer_content:'2', mistake_type:'knowledge',
    review_status:'unreviewed', knowledge:[], review_revision:1};
  mistakeDetailState = {id:11, courseId:42, review:false, row};
  showPageOnly('mistakeDetailPage'); renderMistakeDetail(row, false);
  toggleMistakeAi();
  mistakeAiElement('StudentAnswer').value = '3';
  mistakeAiElement('ErrorType').value = 'careless';
});
</script>"""
    return html.replace('<script src="app.js"></script>', '').replace('</body>', script + '</body>')


app.mount("/", StaticFiles(directory=FRONTEND), name="frontend")
