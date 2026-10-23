/* Runs ZIP decompression off the UI thread. Extract XML only; never execute Office content. */
importScripts('../vendor/office/fflate.min.js');
self.onmessage = event => {
  try {
    const { buffer, kind } = event.data;
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('文档可能已加密或属于旧版格式，请去除密码并另存为 .docx / .pptx 后重试');
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('文档格式不正确或已损坏，请重新另存为 .docx / .pptx 后重试');
    let count = 0, size = 0;
    const entries = fflate.unzipSync(bytes, { filter(entry) {
      if (++count > 5000) throw new Error('文档内部文件过多，请拆分后重试');
      const wanted = kind === 'docx' ? entry.name === 'word/document.xml' :
        ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].includes(entry.name) || /^ppt\/slides\/[^/]+\.xml$/.test(entry.name);
      if (!wanted) return false;
      size += entry.originalSize;
      if (entry.originalSize > 8 * 1024 * 1024 || size > 32 * 1024 * 1024) throw new Error('文档文字内容过大，请拆分后重试');
      return true;
    } });
    const files = Object.create(null), decoder = new TextDecoder('utf-8', { fatal: true });
    for (const [name, value] of Object.entries(entries)) {
      // XML from WPS/Office can be UTF-16 with a BOM as well as UTF-8.
      const utf16 = value[0] === 0xff && value[1] === 0xfe ? 'utf-16le' : value[0] === 0xfe && value[1] === 0xff ? 'utf-16be' : null;
      files[name] = utf16 ? new TextDecoder(utf16, { fatal: true }).decode(value) : decoder.decode(value);
    }
    self.postMessage({ files });
  } catch (error) {
    const known = /文档|密码|另存|拆分/.test(error.message || '');
    self.postMessage({ error: known ? error.message : '文档无法解压或内容损坏，请去除密码并重新另存为 .docx / .pptx 后重试' });
  }
};
