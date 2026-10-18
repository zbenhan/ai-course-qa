/**
 * 站点配置。部署时只需要改这一个文件。
 */
window.APP_CONFIG = {
  /**
   * VPS 上后端接口的地址（必须以 https:// 开头，否则 GitHub Pages 会拦截请求）。
   * 例如：'https://qa.your-domain.com'
   */
  API_BASE: 'https://aiqa.valuegu.com',

  /** 每人最多可投的票数（需与后端 MAX_VOTES_PER_DEVICE 保持一致） */
  MAX_VOTES: 3,

  /** 列表自动刷新间隔（毫秒） */
  REFRESH_MS: 5000,

  /** 课程课件列表。文件放在 docs/files/ 目录下，改这里即可增删。 */
  COURSEWARE: [
    { title: 'AI 使用分享 · 课程课件', desc: 'PDF / PPT 均可，放到 docs/files/ 后修改本行路径', url: 'files/ai-course-slides.pdf' },
  ],
};
