import type { PopupContext } from 'frappe-gantt';
import { MarkdownRenderer } from 'obsidian';
import type { GanttChartView } from '../gantt-view';
import { escapeHtml, getDeps } from '../helpers/utils';
import type { GanttTask } from '../task-mapper';
import { GROUP_HEADER_PREFIX } from '../task-mapper';

/** Format a date for display in popups (shorter, human-friendly). */
function formatDisplayDate(date: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Render content inside Frappe Gantt's hover popup. */
export function renderPopup(
  view: GanttChartView,
  ctx: PopupContext,
  showProgress: boolean,
  findTask: (id: string) => GanttTask | undefined,
): void {
  const ganttTask = findTask(ctx.task.id);

  // Group headers: just show the label
  if (!ganttTask || ganttTask.id.startsWith(GROUP_HEADER_PREFIX)) {
    ctx.set_title(`<strong>${escapeHtml(ctx.task.name)}</strong>`);
    return;
  }

  // Title
  ctx.set_title(escapeHtml(ctx.task.name));

  // Subtitle: date range + duration
  const start = ctx.task._start;
  const end = ctx.task._end;
  if (start && end) {
    const days = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );
    ctx.set_subtitle(
      `${formatDisplayDate(start)} &rarr; ${formatDisplayDate(end)} &middot; ${days} day${days !== 1 ? 's' : ''}`,
    );
  }

  // Details: progress bar + dependencies + hint
  const parts: string[] = [];

  if (showProgress && ctx.task.progress != null) {
    const pct = Math.round(ctx.task.progress);
    parts.push(
      `<div class="gantt-popup-progress-row">` +
        `<div class="gantt-popup-progress"><div class="gantt-popup-progress-bar" style="width:${pct}%"></div></div>` +
        `<span class="gantt-popup-progress-label">${pct}%</span>` +
        `</div>`,
    );
  }

  if (ctx.task.dependencies) {
    const deps = getDeps(ctx.task.dependencies);
    const depNames = deps.map((depId) => {
      const depTask = findTask(depId);
      return depTask ? escapeHtml(depTask.name) : depId;
    });
    if (depNames.length > 0) {
      parts.push(
        `<div class="gantt-popup-deps">Depends on: ${depNames.join(', ')}</div>`,
      );
    }
  }

  parts.push(
    `<div class="gantt-popup-hint">Click to open &middot; Right-click for options</div>`,
  );
  ctx.set_details(parts.join(''));

  // Async: render a markdown preview of the note body
  void renderPopupPreview(view, ganttTask);
}

/** Asynchronously render a truncated markdown preview in the popup. */
async function renderPopupPreview(
  view: GanttChartView,
  ganttTask: GanttTask,
): Promise<void> {
  const file = view.app.vault.getFileByPath(ganttTask.filePath);
  if (!file) return;

  const content = await view.app.vault.cachedRead(file);

  // Strip frontmatter
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)/);
  const body = bodyMatch ? bodyMatch[1].trim() : content.trim();
  if (!body) return;

  const preview = body.length > 300 ? `${body.substring(0, 300)}...` : body;

  // Check popup is still visible
  const popupEl = view.ganttEl.querySelector('.popup-wrapper');
  if (!popupEl || popupEl.querySelector('.gantt-popup-preview')) return;

  const previewDiv = document.createElement('div');
  previewDiv.className = 'gantt-popup-preview';
  popupEl.appendChild(previewDiv);

  await MarkdownRenderer.render(
    view.app,
    preview,
    previewDiv,
    ganttTask.filePath,
    view,
  );
}
