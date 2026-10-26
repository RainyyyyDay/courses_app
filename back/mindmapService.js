// The upstream editor, media store and generation pipeline run in this website process.
const path = require('node:path');
function mountMindmap(app) {
  const root = path.resolve(__dirname, '../modules/mindmap');
  const data = path.resolve(__dirname, 'data/mindmap');
  process.env.MM_STORAGE_DIR = path.join(data, 'maps');
  process.env.MM_LECTURE_TASK_DIR = path.join(data, 'lecture-tasks');
  process.env.MM_STUDENT_PROFILE_FILE = path.join(data, 'student-profile.json');
  const maps = require(path.join(root, 'js/map-files.cjs'));
  const library = require(path.join(root, 'js/map-library.cjs'));
  const ai = require(path.join(root, 'js/ai-server.cjs')).handle;
  app.use('/mindmap', async (req, res, next) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      || req.headers.origin && req.headers.origin !== 'http://' + req.headers.host
      || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'仅允许本机课程页面访问导图'});
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    const route = new URL(req.url, 'http://local').pathname;
    const port = req.socket.localPort;
    try {
      if (route === '/api/library') return await library.handle(req, res, port);
      if (route === '/api/maps' || route.startsWith('/api/maps/')) return await maps.handle(req, res, port);
      if (route.startsWith('/api/ai/')) return await ai(req, res, port);
      if (route.startsWith('/api/')) return res.status(404).json({error:'导图接口不存在'});
      // Source modules, configuration and stored documents are never static assets.
      if (route.split(/[\\/]/).some(p=>p.startsWith('.')) || /\.(?:cjs|local)$/i.test(route)
        || !/^\/(?:index\.html|course\.html|preview\.html|(?:js|css|vendor|docs)\/)/.test(route) && route !== '/') return res.sendStatus(403);
      return next();
    } catch (error) { if (!res.headersSent) res.status(error.status || 500).json({error:'导图服务处理失败，请保留草稿后重试'}); }
  }, require('express').static(root, {index:'index.html', dotfiles:'deny', setHeaders(res){res.setHeader('Cache-Control','no-store');}}));
  return {dispose:()=>ai.dispose?.()};
}
module.exports={mountMindmap};
