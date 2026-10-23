// Copy the existing PDF reader only; no OCR models, downloads, or model calls.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'ocr-trial/node_modules/pdfjs-dist'),target=path.join(root,'fronted/vendor/ocr/pdfjs');
for(const name of ['pdf.min.js','pdf.worker.min.js']){
 if(!fs.existsSync(path.join(source,'build',name))){console.error('缺少 PDF 阅读依赖，请先在 ocr-trial 目录安装项目依赖，再运行 node tools/prepare-pdf-preview.cjs。');process.exit(1);}
}
fs.mkdirSync(target,{recursive:true});
for(const name of ['pdf.min.js','pdf.worker.min.js'])fs.copyFileSync(path.join(source,'build',name),path.join(target,name));
if(fs.existsSync(path.join(source,'LICENSE')))fs.copyFileSync(path.join(source,'LICENSE'),path.join(target,'LICENSE'));
console.log('PDF 阅读组件已准备好，无需下载 OCR 模型。');
