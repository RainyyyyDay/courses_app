/* Optional image transcription using the current shared AI settings; local OCR stays the default. */
const VISION_OCR = { busy: false, maxPages: 600, maxImageBytes: 4 * 1024 * 1024 };

function visionOcrAvailability() {
  const status = coursesAiSettings.status();
  if (!coursesAiSettings.realReady()) return { ready: false, message: '请先在“AI 设置”配置服务、模型和 Key。' };
  let official = status.provider === 'deepseek';
  try { official ||= new URL(status.baseUrl).hostname === 'api.deepseek.com'; } catch {}
  if (official && !['deepseek-flash', 'deepseek-v4-flash-vision-exp'].includes(status.model)) {
    return { ready: false, message: '当前 DeepSeek 模型不支持图片输入，请在 AI 设置中切换为 deepseek-flash。' };
  }
  return { ready: true, message: '复用 ' + coursesAiSettings.label() + '。模型需支持图片输入；页面图片将发送到该服务，可能计费。整份所选文档统一提交，公式输出为 LaTeX，请核对。' };
}

function recognitionOptionsHtml(id, buttonId) {
  return `<div class="recognition-options" data-recognition-options data-recognition-button="${buttonId}">
    <div class="recognition-options-row"><label for="${id}">识别方式</label><select id="${id}" onchange="refreshVisionOcrOptions()"><option value="local">本地 OCR / 文字提取（免费）</option><option value="vision">共用大模型（公式 / LaTeX）</option></select><button type="button" class="edit-mini-btn" onclick="coursesAiSettings.open()">AI 设置</button></div>
    <p data-recognition-hint class="resource-field-hint" role="note"></p></div>`;
}

function refreshVisionOcrOptions() {
  for (const host of document.querySelectorAll('[data-recognition-options]')) {
    const select = host.querySelector('select'), vision = select.value === 'vision';
    const availability = vision ? visionOcrAvailability() : { ready: true, message: '本地读取附件；图片及扫描页使用 Paddle OCR，公式较多时可切换为共用大模型。' };
    host.querySelector('[data-recognition-hint]').textContent = availability.message;
    const button = document.getElementById(host.dataset.recognitionButton);
    const busy = host.dataset.recognitionButton === 'resourceTextScan' ? !!resourceTextEditor?.busy : !!recognizePickerResourceFile.request;
    select.disabled = busy;
    if (button) {
      button.disabled = busy || !availability.ready;
      if (!busy) button.textContent = vision ? 'AI 识别（可能计费）' : '从附件识别文字';
    }
  }
}

async function requestVisionOcrDocument(images,signal,onProgress){
 const credentials=coursesAiSettings.read(),controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 const release=coursesAiSettings.track(credentials,abort),started=Date.now();let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;abort()},15*60*1000);
 const heartbeat=setInterval(()=>onProgress?.(`正在提交文档并等待模型返回… 已等待 ${Math.floor((Date.now()-started)/1000)} 秒；服务未提供处理百分比，可取消。`),1000);
 try{
  ocrCheckCancelled(controller.signal);
  const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/vision-ocr',location.href);
  if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  const body=JSON.stringify({provider:credentials.provider||'deepseek',model:credentials.model,confirm_cost:credentials.confirmCost,...(credentials.provider==='platform'?{}:{api_key:credentials.apiKey}),...(credentials.provider==='compatible'?{base_url:credentials.baseUrl,...(credentials.workspaceId?{workspace_id:credentials.workspaceId}:{})}:{}),output_tokens:coursesAiSettings.status().outputTokens||32768,input:{images}});credentials.apiKey='';
  if(new Blob([body]).size>48*1024*1024)throw Error('整份文档超出当前图像接口的 48 MiB 请求容量；尚未发送，请缩小范围或使用支持原生 PDF 的服务。');
  onProgress?.('正在提交整份文档并等待模型返回；服务未提供处理百分比…');
  const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,cache:'no-store'}),data=await response.json().catch(()=>null);
  if(!coursesAiSettings.valid(credentials))throw new DOMException('AI 设置已改变','AbortError');
  if(!response.ok){const error=mistakeAiError(data?.error,response.status);if(data?.upstream_status)error.message+=' 上游 HTTP '+data.upstream_status;throw error;}
  if(data?.provider!=='vision'||data.model!==credentials.model||typeof data.result?.text!=='string'||!Array.isArray(data.result.warnings)||data.result.needs_review!==true)throw mistakeAiError('INVALID_RESPONSE');
  return data.result;
 }catch(error){if(timedOut)throw Error('整份文档处理超过 15 分钟，已停止等待；原正文保留，未自动重试。');throw error;}
 finally{credentials.apiKey='';release();clearTimeout(timer);clearInterval(heartbeat);signal?.removeEventListener('abort',abort);}
}
async function visionCanvasData(canvas){let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob?.size>VISION_OCR.maxImageBytes)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob||blob.size>VISION_OCR.maxImageBytes)throw mistakeAiError('AI_OCR_IMAGE_TOO_LARGE');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(blob);});}
function visionOcrCheckPageBudget(count){if(count>VISION_OCR.maxPages)throw Error('当前图像接口每次最多接收 600 张页面图片，请缩小范围。');}
async function recognizeVisionText(file,onProgress,options={}){
 if(VISION_OCR.busy)throw Error('另一个文档正在处理，请等待或取消后再试');const availability=visionOcrAvailability();if(!availability.ready)throw Error(availability.message);
 const isPdf=ocrWebIsPdf(file);if(!isPdf&&!/^image\//i.test(file.type||''))throw Error('当前图像接口支持图片和 PDF；Word/PPT 请先导出 PDF。');
 if(file.size>50*1024*1024)throw Error('附件超过 50 MB，请缩小文件后提交');if(isPdf&&OCR_WEB_PDF.busy)throw Error('另一个 PDF 正在处理');
 const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();
 VISION_OCR.busy=true;if(isPdf)OCR_WEB_PDF.busy=true;const started=performance.now(),model=coursesAiSettings.status().model,epoch=coursesAiSettings.status().epoch;
 let pdf,loading,ui,bitmap,pages=[1],totalPages=1;const images=[];let encodedBytes=0;
 try{
  ocrCheckCancelled(controller.signal);
  if(isPdf){if(options.interactive!==false)ui=createPdfOcrDialog(controller,{label:'整份 PDF',startText:'提交整份所选文档（可能计费）',hint:'默认处理整个文件；当前图像接口会在本机准备页面图片，一起提交给模型，不逐页调用。至少支持 50 页，实际取决于文件容量及模型输出空间。'});
   const library=await loadPdfJs();loading=library.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});pdf=await loading.promise;totalPages=pdf.numPages;
   pages=ui?await ui.select(totalPages):options.pages?parsePdfPageRange(options.pages,totalPages):Array.from({length:totalPages},(_,i)=>i+1);
  }
  visionOcrCheckPageBudget(pages.length);
  for(const [index,pageNumber]of pages.entries()){
   ocrCheckCancelled(controller.signal);if(coursesAiSettings.status().epoch!==epoch)throw new DOMException('AI 设置已改变','AbortError');
   const message=`准备文档：${index+1}/${pages.length} 页（尚未调用模型）`;onProgress?.(message);ui?.progress(message,index,pages.length);
   const canvas=document.createElement('canvas');let page;
   try{if(isPdf){page=await pdf.getPage(pageNumber);const base=page.getViewport({scale:1}),scale=Math.min(2.5,2400/Math.max(base.width,base.height),Math.sqrt(5000000/(base.width*base.height))),view=page.getViewport({scale});canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);await page.render({canvasContext:canvas.getContext('2d'),viewport:view,background:'white'}).promise;}else{bitmap=await createImageBitmap(file);const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;}
    ocrCheckCancelled(controller.signal);const image=await visionCanvasData(canvas);encodedBytes+=image.length;if(encodedBytes>47*1024*1024)throw Error('文档图片总容量超出当前接口限制，尚未发送模型请求。请缩小范围。');images.push({image,page:pageNumber});
   }finally{canvas.width=canvas.height=0;page?.cleanup();}
  }
  ocrCheckCancelled(controller.signal);if(coursesAiSettings.status().epoch!==epoch)throw new DOMException('AI 设置已改变','AbortError');
  const result=await requestVisionOcrDocument(images,controller.signal,message=>{onProgress?.(message);ui?.stage(message);});ocrCheckCancelled(controller.signal);
  onProgress?.('正在整理整份文档的返回结果…');if(!result.text.trim())throw Error('没有识别到文字，原正文保留');
  if(pages.length>1){const found=new Set([...result.text.matchAll(/【第\s*(\d+)\s*页】/g)].map(m=>Number(m[1])));if(pages.some(page=>!found.has(page)))throw Error('模型返回未包含全部所选页，可能省略了内容；本次未作为完整识别结果填入。请提高输出容量或缩小范围。');}
  return {provider:'vision',model,text:result.text,lines:[{text:result.text,confidence:null}],confidence:null,pages:pages.length,totalPages,selectedPages:pages,warnings:[`整份文档识别 / ${model}；公式以 LaTeX 保留，请人工校对。`,...result.warnings],elapsedMs:Math.round(performance.now()-started)};
 }finally{bitmap?.close();try{await(pdf||loading)?.destroy()}catch{}ui?.close();options.signal?.removeEventListener('abort',abort);VISION_OCR.busy=false;if(isPdf)OCR_WEB_PDF.busy=false;}
}

