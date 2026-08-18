// 路由註冊。導覽列上的五個分頁現在都接上真的模組，沒有骨架了。

import { register } from './router.js';
import * as settings from './views/settings.js';
import * as masterList from './views/masterList.js';
import * as trash from './views/trash.js';
import * as preferences from './views/preferences.js';
import * as home from './views/home.js';
import * as schedule from './views/schedule.js';
import * as customers from './views/customers.js';
import * as customerDetail from './views/customerDetail.js';
import * as visitEditor from './views/visitEditor.js';
import * as health from './views/health.js';
import * as audit from './views/audit.js';
import * as backfill from './views/backfill.js';
import * as calendar from './views/calendar.js';
import * as report from './views/report.js';
import { MASTER_LABELS } from '../domain/masterData.js';

register('/', { title: '待辦', icon: '✅', render: home.render });

register('/customers', { title: '客戶', icon: '👥', render: customers.render });

register('/schedule', { title: '壓表', icon: '📋', render: schedule.render });

register('/calendar', { title: '日曆', icon: '📅', render: calendar.render });

register('/settings', { title: '設定', icon: '⚙️', render: settings.render });

// 子頁，不進導覽列
register('/customers/new', { title: '新增客戶', nav: false, render: customers.renderNew });
register('/customers/:id', {
  title: '客戶詳情', nav: false,
  render: (el, id) => customerDetail.render(el, id),
});
register('/visits/new/:customerId', {
  title: '記錄來訪', nav: false,
  render: (el, customerId) => visitEditor.renderNew(el, customerId),
});
register('/visits/:id', {
  title: '來訪', nav: false,
  render: (el, id) => visitEditor.renderEdit(el, id),
});
register('/schedule/backfill', { title: '時段反查', nav: false, render: backfill.render });

register('/settings/trash', { title: '已刪除項目', nav: false, render: trash.render });
register('/settings/health', { title: '資料健檢', nav: false, render: health.render });
register('/settings/report', { title: '試算表報表', nav: false, render: report.render });
register('/settings/audit', { title: '稽核紀錄', nav: false, render: audit.render });
register('/settings/preferences', { title: '排序權重', nav: false, render: preferences.render });
register('/settings/:type', {
  title: '主檔', nav: false,
  render: (el, type) => masterList.render(el, type),
  titleFor: (type) => MASTER_LABELS[type] ?? '主檔',
});
