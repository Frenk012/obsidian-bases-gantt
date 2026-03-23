import type { BasesAllOptions, BasesViewConfig } from 'obsidian';

/**
 * Return the view options for the Bases config sidebar.
 */
export function getGanttViewOptions(
  config: BasesViewConfig,
): BasesAllOptions[] {
  return [
    {
      type: 'group',
      displayName: 'Properties',
      items: [
        {
          type: 'property',
          key: 'startDate',
          displayName: 'Start date',
          placeholder: 'Select property...',
        },
        {
          type: 'property',
          key: 'endDate',
          displayName: 'End date',
          placeholder: 'Select property...',
        },
        {
          type: 'property',
          key: 'label',
          displayName: 'Label',
          placeholder: 'File name (default)',
        },
        {
          type: 'property',
          key: 'dependencies',
          displayName: 'Dependencies',
          placeholder: 'Select property...',
        },
        {
          type: 'property',
          key: 'colorBy',
          displayName: 'Color by',
          placeholder: 'Select property...',
        },
        {
          type: 'property',
          key: 'progress',
          displayName: 'Progress',
          placeholder: 'Select property...',
          shouldHide: () => !(config.get('showProgress') as boolean),
        },
      ],
    },
    {
      type: 'group',
      displayName: 'Display',
      items: [
        {
          type: 'dropdown',
          key: 'viewMode',
          displayName: 'View mode',
          default: 'Day',
          options: {
            'Quarter day': 'Quarter day',
            'Half day': 'Half day',
            Day: 'Day',
            Week: 'Week',
            Month: 'Month',
            Year: 'Year',
          },
        },
        {
          type: 'slider',
          key: 'barHeight',
          displayName: 'Bar height',
          default: 30,
          min: 16,
          max: 60,
          step: 2,
        },
        {
          type: 'toggle',
          key: 'showProgress',
          displayName: 'Show progress',
          default: false,
        },
        {
          type: 'toggle',
          key: 'showExpectedProgress',
          displayName: 'Show expected progress',
          default: false,
          shouldHide: () => !(config.get('showProgress') as boolean),
        },
      ],
    },
  ];
}
