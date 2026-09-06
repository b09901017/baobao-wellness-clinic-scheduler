// 路由註冊。導覽列上的五個分頁現在都接上真的模組，沒有骨架了。

import { register } from './router.js';
import * as settings from './views/settings.js';
import * as masterList from './views/masterList.js';
import * as trash from './views/trash.js';
import * as preferences from './views/preferences.js';
import * as templates from './views/templates.js';
import * as home from './views/home.js';
import * as schedule from './views/schedule.js';
import * as customers from './views/customers.js';
import * as customersBulk from './views/customersBulk.js';
import * as customerDetail from './views/customerDetail.js';
import * as bought from './views/bought.js';
import * as naming from './views/naming.js';
import * as progress from './views/progress.js';
import * as visitEditor from './views/visitEditor.js';
import * as eventEditor from './views/eventEditor.js';
import * as health from './views/health.js';
import * as audit from './views/audit.js';
import * as backfill from './views/backfill.js';
import * as calendar from './views/calendar.js';
import * as report from './views/report.js';
import * as mergeImport from './views/mergeImport.js';
import * as playbook from './views/playbook.js';
import { MASTER_LABELS } from '../domain/masterData.js';

register('/', { title: '待辦', icon: 'todo', render: home.render });

register('/customers', { title: '客戶', icon: 'people', render: customers.render });

register('/schedule', { title: '壓表', icon: 'book', render: schedule.render });

register('/calendar', { title: '日曆', icon: 'calendar', render: calendar.render });

register('/settings', { title: '設定', icon: 'gear', render: settings.render });

// 子頁，不進導覽列
register('/todo/:group', {
  title: '待辦', nav: false,
  render: (el, group) => home.renderGroup(el, group),
  titleFor: (group) => home.groupTitle(group),
});

register('/customers/new', { title: '新增客戶', nav: false, render: customers.renderNew });
register('/customers/bulk', {
  title: '快速建立一群', nav: false, render: customersBulk.render,
});
// 註冊在 /customers/:id 前面。router 先試完全相符再試樣板，所以順序其實不影響，
// 但擺在一起看得出「progress 不是某位客戶的 id」。
register('/customers/progress', { title: '進度追蹤', nav: false, render: progress.render });
register('/customers/:id', {
  title: '客戶詳情', nav: false,
  render: (el, id) => customerDetail.render(el, id),
});
// 「買過什麼」。三段路徑，所以不會跟 `/customers/:id` 撞（`router.js` 的
// `match()` 先比段數）。唯讀，只有購買日期改得動。
register('/customers/:id/bought', {
  title: '買過什麼', nav: false,
  render: (el, id) => bought.render(el, id),
});
register('/visits/new/:customerId', {
  title: '記錄來訪', nav: false,
  render: (el, customerId) => visitEditor.renderNew(el, customerId),
});
// 從日曆上點某一天新增時，把那一天帶進去
register('/visits/new/:customerId/:date', {
  title: '記錄來訪', nav: false,
  render: (el, customerId, date) => visitEditor.renderNew(el, customerId, date),
});

register('/events/new/:date', {
  title: '新增行事備註', nav: false,
  render: (el, date) => eventEditor.renderNew(el, date),
});
register('/events/:id', {
  title: '行事備註', nav: false,
  render: (el, id) => eventEditor.renderEdit(el, id),
});
register('/visits/:id', {
  title: '來訪', nav: false,
  render: (el, id) => visitEditor.renderEdit(el, id),
});
register('/schedule/backfill', { title: '時段反查', nav: false, render: backfill.render });

// 備忘錄／SOP。**不進導覽列**（ADR-0067）：入口在待辦那一頁的右上角，
// 跟客戶頁的「看這個月的進度」同一顆。五格變六格會讓每一格從 20% 掉到 16.6%，
// 而她九成的時間在前四格上。
register('/playbook', { title: '備忘錄', nav: false, render: playbook.render });
// `:id` 不是另一頁，是「這一疊，開在那一張」（ADR-0069）——
// 日曆卡片上的「看整份」指著它。少一頁就少一個回不去的地方。
register('/playbook/:id', {
  title: '備忘錄', nav: false,
  render: (el, id) => playbook.render(el, id),
});

register('/settings/naming', {
  title: '名稱怎麼寫', nav: false, render: naming.render,
});
register('/settings/trash', { title: '已刪除項目', nav: false, render: trash.render });
register('/settings/health', { title: '資料健檢', nav: false, render: health.render });
register('/settings/report', { title: '試算表報表', nav: false, render: report.render });
register('/settings/audit', { title: '稽核紀錄', nav: false, render: audit.render });
register('/settings/merge', { title: '舊資料匯入', nav: false, render: mergeImport.render });
register('/settings/preferences', { title: '排序權重', nav: false, render: preferences.render });
register('/settings/templates', { title: 'LINE 回覆模板', nav: false, render: templates.render });
register('/settings/:type', {
  title: '主檔', nav: false,
  render: (el, type) => masterList.render(el, type),
  titleFor: (type) => MASTER_LABELS[type] ?? '主檔',
});
