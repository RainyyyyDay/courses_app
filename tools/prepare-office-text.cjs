// Prepare the local Office ZIP reader; no OCR models or network downloads.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'ocr-trial/node_modules/fflate'),target=path.join(root,'fronted/vendor/office');
if(!fs.existsSync(path.join(source,'umd/index.js'))){console.error('缺少 Word/PPT 读取依赖，请先在 ocr-trial 目录运行 npm install。');process.exit(1);}
fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(path.join(source,'umd/index.js'),path.join(target,'fflate.min.js'));
fs.copyFileSync(path.join(source,'LICENSE'),path.join(target,'LICENSE'));
console.log('Word/PPT 本地文字读取组件已准备好。');
