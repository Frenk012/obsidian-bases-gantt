import { Menu } from 'obsidian';
import type { GanttChartView } from '../gantt-view';
import type { GanttTask } from '../task-mapper';
import { GROUP_HEADER_PREFIX } from '../task-mapper';

/** Register right-click context menu on the Gantt chart element. */
export function registerContextMenu(view: GanttChartView): void {
  view.ganttEl.addEventListener('contextmenu', (evt: MouseEvent) => {
    evt.preventDefault();

    const target = evt.target as Element;
    const barWrapper = target.closest('.bar-wrapper');

    if (barWrapper) {
      const taskId = barWrapper.getAttribute('data-id');
      if (taskId) {
        const ganttTask = view.findTask(taskId);
        if (ganttTask && !ganttTask.id.startsWith(GROUP_HEADER_PREFIX)) {
          showTaskContextMenu(view, evt, ganttTask);
          return;
        }
      }
    }

    showEmptyContextMenu(view, evt);
  });
}

/** Context menu for a specific task bar. */
function showTaskContextMenu(
  view: GanttChartView,
  evt: MouseEvent,
  task: GanttTask,
): void {
  const menu = new Menu();

  menu.addItem((item) => {
    item
      .setTitle('Open note')
      .setIcon('file-text')
      .onClick(() => {
        void view.app.workspace.openLinkText(task.filePath, '', false);
      });
  });

  menu.addItem((item) => {
    item
      .setTitle('Open in new tab')
      .setIcon('file-plus')
      .onClick(() => {
        void view.app.workspace.openLinkText(task.filePath, '', true);
      });
  });

  menu.addSeparator();

  const showProgress = (view.config.get('showProgress') as boolean) ?? false;
  if (showProgress) {
    for (const pct of [0, 25, 50, 75, 100]) {
      menu.addItem((item) => {
        item
          .setTitle(`Set progress: ${pct}%`)
          .setChecked(Math.round(task.progress ?? 0) === pct)
          .onClick(() => {
            view.updateTaskProgress(task, pct);
          });
      });
    }
    menu.addSeparator();
  }

  menu.addItem((item) => {
    item
      .setTitle('Scroll to today')
      .setIcon('calendar')
      .onClick(() => view.scrollToToday());
  });

  menu.showAtMouseEvent(evt);
}

/** Context menu for empty chart space. */
function showEmptyContextMenu(view: GanttChartView, evt: MouseEvent): void {
  const menu = new Menu();

  menu.addItem((item) => {
    item
      .setTitle('Create new task')
      .setIcon('plus')
      .onClick(() => view.createTaskAtToday());
  });

  menu.addSeparator();

  menu.addItem((item) => {
    item
      .setTitle('Scroll to today')
      .setIcon('calendar')
      .onClick(() => view.scrollToToday());
  });

  menu.showAtMouseEvent(evt);
}
