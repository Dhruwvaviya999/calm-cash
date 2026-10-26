import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { createBackgroundTasks } from './background-tasks';

describe('background tasks', () => {
  it('run after the caller returns and can be drained', async () => {
    const tasks = createBackgroundTasks(pino({ level: 'silent' }));
    const order: string[] = [];

    tasks.run('first', async () => {
      await Promise.resolve();
      order.push('task');
    });
    order.push('caller');
    await tasks.drain();

    expect(order).toEqual(['caller', 'task']);
  });

  it('contain failures so they cannot crash the process', async () => {
    const tasks = createBackgroundTasks(pino({ level: 'silent' }));
    tasks.run('failing', () => Promise.reject(new Error('SMTP down')));

    await expect(tasks.drain()).resolves.toBeUndefined();
  });
});
