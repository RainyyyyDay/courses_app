"""Local harness. Existing routes remain mock; explicit test endpoint uses a temporary Key."""
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from src.ai_mistake import Config, register
from src.ai_deepseek_test import register as register_deepseek_test
from src.ai_answer_draft import register as register_answer_draft
from src.ai_review_suggestion import register as register_review_suggestion
from src.ai_creation_review import register as register_creation_review
from src.ai_material_draft import register as register_material_draft
from src.ai_review_feedback import register as register_review_feedback
from src.ai_outline import register as register_outline
from src.ai_assessment_chart import register as register_assessment_chart

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
register_deepseek_test(app, dependencies=[Depends(local_only)])
register_answer_draft(app, dependencies=[Depends(local_only)])
register_review_suggestion(app, dependencies=[Depends(local_only)])
register_creation_review(app, dependencies=[Depends(local_only)])
register_material_draft(app, dependencies=[Depends(local_only)])
register_review_feedback(app, dependencies=[Depends(local_only)])
register_outline(app, dependencies=[Depends(local_only)])
register_assessment_chart(app, dependencies=[Depends(local_only)])
from src.ai_platform import register as register_platform
register_platform(app, dependencies=[Depends(local_only)])

# Serve only public frontend assets, never the repository, .env or database.
FRONTEND = Path(__file__).resolve().parents[1] / "fronted"


class DevelopmentStaticFiles(StaticFiles):
    """Only this local harness: never keep an old JS/CSS generation in cache."""
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if Path(path).suffix in {'.js', '.css'}:
            response.headers['Cache-Control'] = 'no-store'
        return response


@app.get('/ai-test', response_class=HTMLResponse, dependencies=[Depends(local_only)])
async def ai_test():
    return HTMLResponse(Path(__file__).with_name('deepseek-test.html').read_text(encoding='utf-8'),
                        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                                 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"})


@app.get('/deepseek-test.js', dependencies=[Depends(local_only)])
async def ai_test_script():
    from fastapi.responses import Response
    return Response(Path(__file__).with_name('deepseek-test.js').read_text(encoding='utf-8'),
                    media_type='application/javascript', headers={'Cache-Control': 'no-store'})


@app.get("/", response_class=HTMLResponse, dependencies=[Depends(local_only)])
@app.get("/index.html", response_class=HTMLResponse, dependencies=[Depends(local_only)])
async def frontend():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    html = html.replace("<head>", '<head><script>window.COURSES_AI_API_BASE="/api";window.COURSES_AI_LOCAL_MOCK=true;</script>', 1)
    return HTMLResponse(html, headers={'Cache-Control': 'no-store'})


@app.get("/demo", response_class=HTMLResponse, dependencies=[Depends(local_only)])
async def demo():
    html = (await frontend()).body.decode('utf-8')
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


app.mount("/", DevelopmentStaticFiles(directory=FRONTEND), name="frontend")
