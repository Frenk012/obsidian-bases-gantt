import type { GanttOptions, PopupContext } from 'frappe-gantt';
import Gantt from 'frappe-gantt';
import {
  type BasesPropertyId,
  BasesView,
  DateValue,
  Notice,
  NumberValue,
  type QueryController,
} from 'obsidian';
import { getGanttViewOptions } from './components/config';
import { registerContextMenu } from './components/menu';
import { renderPopup } from './components/popup';
import {
  formatDateForFrontmatter,
  parseObsidianDate,
} from './helpers/date-utils';
import {
  createGroupHeaderTask,
  type GanttTask,
  GROUP_HEADER_PREFIX,
  mapEntriesToTasks,
  type TaskMapperConfig,
} from './task-mapper';

export { getGanttViewOptions };

export class GanttChartView extends BasesView {
  type = 'gantt';

  /** Static registry of active instances for command palette integration. */
  static instances: Set<GanttChartView> = new Set();

  containerEl: HTMLElement;
  ganttEl!: HTMLElement;
  gantt: Gantt | null = null;

  private configSnapshot = '';
  private taskMap: Map<string, GanttTask> = new Map();
  /** Flag to suppress on_click after a drag operation. */
  private justDragged = false;
  /** Scroll to today only on first render. */
  private firstRender = true;
  /** Pending internal writes — skip that many refreshes (echo from drag/progress). */
  private pendingWrites = 0;
  /** Global mouseup handlers Frappe Gantt registers on document (for cleanup). */
  private capturedGlobalHandlers: EventListener[] = [];

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.containerEl = containerEl;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  onload(): void {
    GanttChartView.instances.add(this);
    this.containerEl.addClass('bases-gantt-view');
    this.ganttEl = this.containerEl.createDiv({ cls: 'gantt-wrapper' });
    registerContextMenu(this);

    // Clear justDragged on next frame after mouseup — after Frappe's on_click fires.
    this.ganttEl.addEventListener('mouseup', () => {
      if (this.justDragged) {
        requestAnimationFrame(() => {
          this.justDragged = false;
        });
      }
    });
  }

  onunload(): void {
    GanttChartView.instances.delete(this);
    if (this.gantt) {
      this.gantt.clear();
      this.gantt.$container?.remove();
      this.gantt = null;
    }
    for (const handler of this.capturedGlobalHandlers) {
      document.removeEventListener('mouseup', handler);
    }
    this.capturedGlobalHandlers = [];
    this.taskMap.clear();
  }

  onResize(): void {
    // Frappe Gantt auto-fills width via SVG 100%, so no special handling needed
  }

  // ── Public API (command palette + context menu) ──────────────────

  isInActiveLeaf(): boolean {
    return this.containerEl.closest('.workspace-leaf.mod-active') != null;
  }

  scrollToToday(): void {
    this.gantt?.scroll_current();
  }

  setViewMode(mode: string): void {
    if (this.gantt) {
      this.gantt.change_view_mode(mode, true);
    }
  }

  createTaskAtToday(): void {
    const config = this.getTaskMapperConfig();
    if (!config.startProperty) {
      new Notice('Configure a start date property first.');
      return;
    }
    const today = formatDateForFrontmatter(new Date());
    const propName = this.extractPropertyName(config.startProperty);
    void this.createFileForView('New task', (frontmatter) => {
      frontmatter[propName] = today;
      if (config.endProperty) {
        const endPropName = this.extractPropertyName(config.endProperty);
        frontmatter[endPropName] = today;
      }
    });
  }

  createTaskAtDate(dateStr: string): void {
    const config = this.getTaskMapperConfig();
    if (!config.startProperty) {
      new Notice('Configure a start date property first.');
      return;
    }
    const parsed = parseObsidianDate(dateStr);
    const formattedDate = parsed ? formatDateForFrontmatter(parsed) : dateStr;
    const propName = this.extractPropertyName(config.startProperty);
    void this.createFileForView('New task', (frontmatter) => {
      frontmatter[propName] = formattedDate;
      if (config.endProperty) {
        const endPropName = this.extractPropertyName(config.endProperty);
        frontmatter[endPropName] = formattedDate;
      }
    });
  }

  findTask(id: string): GanttTask | undefined {
    return this.taskMap.get(id);
  }

  updateTaskProgress(task: GanttTask, pct: number): void {
    const mapperConfig = this.getTaskMapperConfig();
    if (mapperConfig.progressProperty) {
      const propName = this.extractPropertyName(mapperConfig.progressProperty);
      void this.writeFrontmatter(task.filePath, { [propName]: pct });
      this.gantt?.update_task(task.id, { progress: pct });
    }
  }

  // ── Data pipeline ────────────────────────────────────────────────

  onDataUpdated(): void {
    if (!this.data?.data || !this.ganttEl) return;

    const config = this.getTaskMapperConfig();
    const newSnapshot = `${JSON.stringify(config)}|${this.getDisplayConfigSnapshot()}`;

    // Previous tasks for order preservation (sort only on first render)
    const prev = this.gantt?.tasks as GanttTask[] | undefined;

    // Build tasks (potentially from grouped data)
    let tasks: GanttTask[];
    const groups = this.data.groupedData;
    const hasGroups =
      groups.length > 1 || (groups.length === 1 && groups[0].hasKey());
    if (hasGroups) {
      tasks = [];
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupTasks = mapEntriesToTasks(group.entries, config, prev);
        if (groupTasks.length === 0) continue;
        const label = group.hasKey() ? String(group.key) : 'Ungrouped';
        const header = createGroupHeaderTask(label, i, groupTasks);
        if (header) tasks.push(header);
        tasks.push(...groupTasks);
      }
    } else {
      tasks = mapEntriesToTasks(this.data.data, config, prev);
    }

    this.taskMap.clear();
    for (const t of tasks) this.taskMap.set(t.id, t);

    if (tasks.length === 0) {
      this.renderEmptyState(config);
      return;
    }

    // Clear empty state if it was showing
    const emptyEl = this.containerEl.querySelector('.gantt-empty-state');
    if (emptyEl) emptyEl.remove();

    if (this.gantt && this.configSnapshot === newSnapshot) {
      // Skip refresh when this is echo from our own drag/progress write
      if (this.pendingWrites > 0) {
        this.pendingWrites--;
        return;
      }
      this.gantt.refresh(tasks);
    } else {
      // Config changed or first render — recreate
      this.configSnapshot = newSnapshot;
      this.initGantt(tasks);
    }
  }

  // ── Gantt init ───────────────────────────────────────────────────

  private initGantt(tasks: GanttTask[]): void {
    if (this.gantt) {
      this.gantt.clear();
      this.gantt = null;
    }
    this.ganttEl.empty();

    const VIEW_MODE_MAP: Record<string, string> = {
      'Quarter day': 'Quarter Day',
      'Half day': 'Half Day',
    };
    const rawViewMode = (this.config.get('viewMode') as string) || 'Day';
    const viewMode = VIEW_MODE_MAP[rawViewMode] ?? rawViewMode;
    const barHeight = (this.config.get('barHeight') as number) || 30;
    const showProgress = (this.config.get('showProgress') as boolean) ?? false;
    const showExpectedProgress =
      (this.config.get('showExpectedProgress') as boolean) ?? false;

    const scrollTo = this.firstRender ? 'today' : null;
    this.firstRender = false;

    const options: GanttOptions = {
      view_mode: viewMode,
      bar_height: barHeight,
      today_button: true,
      scroll_to: scrollTo,
      readonly: false,
      readonly_dates: false,
      readonly_progress: !showProgress,
      infinite_padding: false,
      view_mode_select: false,

      arrow_curve: 15,
      auto_move_label: true,
      move_dependencies: true,
      show_expected_progress: showExpectedProgress && showProgress,
      hover_on_date: true,
      popup_on: 'hover',

      popup: (ctx: PopupContext) => {
        renderPopup(this, ctx, showProgress, (id) => this.findTask(id));
      },

      on_click: (task) => {
        if (this.justDragged) return;
        if (task.id.startsWith(GROUP_HEADER_PREFIX)) return;
        const ganttTask = this.findTask(task.id);
        if (ganttTask) {
          void this.app.workspace.openLinkText(ganttTask.filePath, '', false);
        }
      },

      on_date_change: (task, start, end) => {
        this.justDragged = true;
        if (task.id.startsWith(GROUP_HEADER_PREFIX)) return;
        const ganttTask = this.findTask(task.id);
        if (!ganttTask) return;

        const mapperConfig = this.getTaskMapperConfig();
        const updates: Record<string, string> = {};
        if (mapperConfig.startProperty) {
          updates[this.extractPropertyName(mapperConfig.startProperty)] =
            formatDateForFrontmatter(start);
        }
        if (mapperConfig.endProperty) {
          updates[this.extractPropertyName(mapperConfig.endProperty)] =
            formatDateForFrontmatter(end);
        }
        void this.writeFrontmatter(ganttTask.filePath, updates);
      },

      on_progress_change: (task, progress) => {
        this.justDragged = true;
        if (!showProgress) return;
        const ganttTask = this.findTask(task.id);
        if (!ganttTask) return;

        const mapperConfig = this.getTaskMapperConfig();
        if (mapperConfig.progressProperty) {
          const propName = this.extractPropertyName(
            mapperConfig.progressProperty,
          );
          void this.writeFrontmatter(ganttTask.filePath, {
            [propName]: Math.round(progress),
          });
        }
      },

      on_date_click: (dateStr: string) => {
        this.createTaskAtDate(dateStr);
      },
    };

    // Capture global mouseup handlers Frappe Gantt registers on document
    // so we can remove them on cleanup (Frappe never removes them itself).
    const captured: EventListener[] = [];
    const origAdd = document.addEventListener.bind(document);
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'mouseup') captured.push(listener as EventListener);
      return origAdd(type, listener, opts);
    }) as typeof document.addEventListener;

    try {
      this.gantt = new Gantt(this.ganttEl, tasks, options);
    } catch (e) {
      console.error('Bases Gantt: failed to initialize chart', e);
      this.ganttEl.empty();
      this.renderEmptyState(this.getTaskMapperConfig());
      return;
    } finally {
      document.addEventListener = origAdd;
    }
    this.capturedGlobalHandlers = captured;

    // Apply milestone class (can't combine with color class in custom_class)
    for (const task of tasks) {
      if (task.isMilestone) {
        const wrapper = this.ganttEl.querySelector(
          `.bar-wrapper[data-id="${task.id}"]`,
        );
        if (wrapper) wrapper.classList.add('gantt-milestone');
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getTaskMapperConfig(): TaskMapperConfig {
    let startProperty = this.config.getAsPropertyId('startDate');
    let endProperty = this.config.getAsPropertyId('endDate');
    const labelProperty = this.config.getAsPropertyId('label');
    let dependenciesProperty = this.config.getAsPropertyId('dependencies');
    let colorByProperty = this.config.getAsPropertyId('colorBy');
    let progressProperty = this.config.getAsPropertyId('progress');

    if (!startProperty && this.data?.data?.length > 0) {
      const detected = this.autoDetectProperties();
      startProperty = detected.start ?? startProperty;
      endProperty = detected.end ?? endProperty;
      dependenciesProperty = detected.dependencies ?? dependenciesProperty;
      progressProperty = detected.progress ?? progressProperty;
      colorByProperty = detected.colorBy ?? colorByProperty;
    }

    return {
      startProperty,
      endProperty,
      labelProperty,
      dependenciesProperty,
      colorByProperty,
      progressProperty,
      showProgress:
        (this.config.get('showProgress') as boolean) ??
        progressProperty != null,
    };
  }

  private autoDetectProperties(): {
    start: BasesPropertyId | null;
    end: BasesPropertyId | null;
    dependencies: BasesPropertyId | null;
    progress: BasesPropertyId | null;
    colorBy: BasesPropertyId | null;
  } {
    const entries = this.data?.data;
    if (!entries || entries.length === 0) {
      return {
        start: null,
        end: null,
        dependencies: null,
        progress: null,
        colorBy: null,
      };
    }

    const firstEntry = entries[0];
    const dateProps: BasesPropertyId[] = [];
    const numberProps: BasesPropertyId[] = [];
    const stringProps: BasesPropertyId[] = [];

    for (const propId of this.allProperties) {
      const val = firstEntry.getValue(propId);
      if (val == null) continue;
      if (val instanceof DateValue) dateProps.push(propId);
      else if (val instanceof NumberValue) numberProps.push(propId);
      else stringProps.push(propId);
    }

    const getName = (id: BasesPropertyId): string => {
      const dot = id.indexOf('.');
      return (dot >= 0 ? id.slice(dot + 1) : id)
        .toLowerCase()
        .replace(/[-_]/g, '');
    };

    const findByKeywords = (
      props: BasesPropertyId[],
      keywords: string[],
    ): BasesPropertyId | null => {
      for (const propId of props) {
        if (keywords.some((k) => getName(propId).includes(k))) return propId;
      }
      return null;
    };

    let start = findByKeywords(dateProps, [
      'start',
      'begin',
      'from',
      'created',
    ]);
    let end = findByKeywords(dateProps, [
      'end',
      'due',
      'finish',
      'deadline',
      'until',
    ]);
    if (!start && dateProps.length > 0) start = dateProps[0];
    if (!end && dateProps.length > 1)
      end = dateProps.find((p) => p !== start) ?? null;

    const dependencies = findByKeywords(stringProps, [
      'depend',
      'block',
      'after',
      'prerequisite',
      'requires',
    ]);
    const progress = findByKeywords(numberProps, [
      'progress',
      'percent',
      'completion',
      'complete',
      'done',
    ]);
    const colorBy = findByKeywords(stringProps, [
      'status',
      'priority',
      'type',
      'category',
      'phase',
      'stage',
    ]);

    return { start, end, dependencies, progress, colorBy };
  }

  private getDisplayConfigSnapshot(): string {
    return JSON.stringify({
      viewMode: this.config.get('viewMode'),
      barHeight: this.config.get('barHeight'),
      showProgress: this.config.get('showProgress'),
      showExpectedProgress: this.config.get('showExpectedProgress'),
    });
  }

  private extractPropertyName(propertyId: BasesPropertyId): string {
    const dotIndex = propertyId.indexOf('.');
    return dotIndex >= 0 ? propertyId.slice(dotIndex + 1) : propertyId;
  }

  private async writeFrontmatter(
    filePath: string,
    updates: Record<string, string | number>,
  ): Promise<void> {
    this.pendingWrites++;
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(updates)) {
        frontmatter[key] = value;
      }
    });
  }

  private renderEmptyState(config: TaskMapperConfig): void {
    if (this.gantt) {
      this.gantt.clear();
      this.gantt = null;
    }
    this.ganttEl.empty();

    const existing = this.containerEl.querySelector('.gantt-empty-state');
    if (existing) existing.remove();

    const el = this.containerEl.createDiv({ cls: 'gantt-empty-state' });

    if (!config.startProperty) {
      el.createEl('p', {
        text: 'Configure a start date property in the view options to display the chart.',
      });
      el.createEl('p', {
        cls: 'gantt-empty-hint',
        text: 'Open view options (gear icon) and select a date property for "start date".',
      });
    } else {
      el.createEl('p', { text: 'No tasks with valid dates found.' });
      el.createEl('p', {
        cls: 'gantt-empty-hint',
        text: 'Ensure your notes have a date value in the configured start date property.',
      });
    }
  }
}
