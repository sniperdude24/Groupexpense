import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, setGroupOrigin, getGroup } from '../src/repo/groups.js';

beforeEach(resetDb);

describe('group provenance', () => {
  it('the creating device stamps its group as the master copy', async () => {
    const crew = await createGroup('Crew');
    expect(crew.origin).toBe('created');
    expect((await getGroup(crew.id)).origin).toBe('created');
  });

  it('setGroupOrigin claims and demotes, and rejects nonsense', async () => {
    const crew = await createGroup('Crew');

    await setGroupOrigin(crew.id, 'received');
    expect((await getGroup(crew.id)).origin).toBe('received');

    await setGroupOrigin(crew.id, 'created');
    expect((await getGroup(crew.id)).origin).toBe('created');

    await expect(setGroupOrigin(crew.id, 'primary')).rejects.toThrow(/Unknown group origin/);
  });
});
