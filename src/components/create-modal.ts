import { App, Modal, Setting } from 'obsidian';
import type { BasesPropertyId } from 'obsidian';
import type { TaskMapperConfig } from '../task-mapper';

type CreateFn = (
  name: string,
  processor: (frontmatter: Record<string, unknown>) => void,
) => Promise<void>;

/** Extract the bare property name from a BasesPropertyId (strip type prefix). */
function propName(id: BasesPropertyId): string {
  const dot = id.indexOf('.');
  return dot >= 0 ? id.slice(dot + 1) : id;
}

/**
 * Modal shown when creating a new Gantt task.
 * Renders a form field for every Gantt property currently in use so the user
 * doesn't have to remember them by heart.
 */
export class GanttTaskModal extends Modal {
  private readonly config: TaskMapperConfig;
  private readonly onCreate: CreateFn;
  private readonly initialDate: string;

  constructor(
    app: App,
    config: TaskMapperConfig,
    onCreate: CreateFn,
    initialDate?: string,
  ) {
    super(app);
    this.config = config;
    this.onCreate = onCreate;
    this.initialDate = initialDate ?? todayString();
  }

  onOpen(): void {
    const { config } = this;
    this.titleEl.setText('New task');

    let name = '';
    let startDate = this.initialDate;
    let endDate = '';
    const extra: Record<string, string | number> = {};

    // ── Name ────────────────────────────────────────────────────────
    new Setting(this.contentEl)
      .setName('Name')
      .addText((t) =>
        t
          .setPlaceholder('Task name')
          .onChange((v) => (name = v))
          .inputEl.focus(),
      );

    // ── Start date ──────────────────────────────────────────────────
    if (config.startProperty) {
      const key = propName(config.startProperty);
      new Setting(this.contentEl)
        .setName('Start date')
        .setDesc(key)
        .addText((t) =>
          t
            .setValue(startDate)
            .setPlaceholder('YYYY-MM-DD')
            .onChange((v) => (startDate = v)),
        );
    }

    // ── End date ────────────────────────────────────────────────────
    if (config.endProperty) {
      const key = propName(config.endProperty);
      new Setting(this.contentEl)
        .setName('End date')
        .setDesc(`${key}  (optional — leave blank for single-day task)`)
        .addText((t) =>
          t
            .setPlaceholder('YYYY-MM-DD')
            .onChange((v) => (endDate = v)),
        );
    }

    // ── Color-by property (status, priority …) ──────────────────────
    if (config.colorByProperty) {
      const key = propName(config.colorByProperty);
      new Setting(this.contentEl)
        .setName(key)
        .setDesc('Used to color the bar')
        .addText((t) =>
          t
            .setPlaceholder('e.g. In Progress')
            .onChange((v) => (extra[key] = v)),
        );
    }

    // ── Progress ────────────────────────────────────────────────────
    if (config.showProgress && config.progressProperty) {
      const key = propName(config.progressProperty);
      new Setting(this.contentEl)
        .setName('Progress')
        .setDesc(`${key}  (0 – 100)`)
        .addText((t) =>
          t.setPlaceholder('0').onChange((v) => {
            const n = Number(v);
            if (!Number.isNaN(n)) extra[key] = Math.max(0, Math.min(100, n));
          }),
        );
    }

    // ── Direct color ────────────────────────────────────────────────
    if (config.colorValueProperty) {
      const key = propName(config.colorValueProperty);
      new Setting(this.contentEl)
        .setName('Color')
        .setDesc(`${key}  (CSS color — name, hex, rgb…)`)
        .addText((t) =>
          t.setPlaceholder('#e74c3c').onChange((v) => (extra[key] = v)),
        );
    }

    // ── Buttons ─────────────────────────────────────────────────────
    new Setting(this.contentEl)
      .addButton((b) =>
        b.setButtonText('Cancel').onClick(() => this.close()),
      )
      .addButton((b) =>
        b
          .setButtonText('Create')
          .setCta()
          .onClick(() => void this.submit(name, startDate, endDate, extra)),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(
    name: string,
    startDate: string,
    endDate: string,
    extra: Record<string, string | number>,
  ): Promise<void> {
    const { config } = this;

    await this.onCreate(name || 'New task', (fm) => {
      if (config.startProperty && startDate) {
        fm[propName(config.startProperty)] = startDate;
      }
      if (config.endProperty && endDate.trim()) {
        fm[propName(config.endProperty)] = endDate.trim();
      }
      for (const [k, v] of Object.entries(extra)) {
        if (v !== '' && v !== undefined) fm[k] = v;
      }
    });

    this.close();
  }
}

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
