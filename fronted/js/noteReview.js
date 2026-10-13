// 笔记复用阅读复习控制器；使用独立接口、存储键与队列。
const noteReadingReview = createReadingReview('notes','笔记','noteReviewResume');
function openNoteReviewPicker() { return noteReadingReview.open(); }
function renderNoteReviewResume() { noteReadingReview.renderResume(); }
function resumeNoteReview() { return noteReadingReview.resume(); }
function restoreNoteReviewLocation(courseId) { return noteReadingReview.restore(courseId); }
