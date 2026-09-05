import { CodexClientService } from '../app-server/codex-client.service';
import { QuotaService, QuotaView } from './quota.service';

describe('QuotaService', () => {
  let notify: (params: unknown) => void;
  let request: jest.Mock;
  let service: QuotaService;
  let seen: QuotaView[];

  beforeEach(() => {
    request = jest.fn();
    const codex = {
      on: (_method: string, listener: (params: unknown) => void) => {
        notify = listener;
        return () => undefined;
      },
      requestOrUnavailable: request,
    };

    service = new QuotaService(codex as unknown as CodexClientService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    service.onModuleInit();

    seen = [];
    service.onQuotaChanged((view) => seen.push(view));
  });

  const full = () =>
    request.mockResolvedValue({
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_700_000 },
        secondary: { usedPercent: 5, windowDurationMins: 10_080, resetsAt: 1_800_000 },
        credits: { hasCredits: true, unlimited: false, balance: '12.50' },
        planType: 'plus',
        rateLimitReachedType: null,
      },
    });

  it('starts empty rather than pretending to know', () => {
    expect(service.getSnapshot()).toMatchObject({ primary: null, planType: null });
  });

  it('reads the authoritative figures on refresh', async () => {
    full();

    const view = await service.refresh();

    expect(view.primary).toEqual({ usedPercent: 20, windowDurationMins: 300, resetsAt: 1_700_000 });
    expect(view.planType).toBe('plus');
    expect(view.credits?.balance).toBe('12.50');
  });

  it('merges a sparse update instead of replacing the snapshot', async () => {
    full();
    await service.refresh();

    // A rolling update carries only what moved. Nulls mean "unchanged", so
    // replacing wholesale would blank the plan and the balance every time a
    // usage figure ticked.
    notify({
      rateLimits: {
        primary: { usedPercent: 41, windowDurationMins: 300, resetsAt: 1_700_000 },
        secondary: null,
        credits: null,
        planType: null,
        rateLimitReachedType: null,
      },
    });

    const view = service.getSnapshot();
    expect(view.primary?.usedPercent).toBe(41);
    expect(view.secondary?.usedPercent).toBe(5);
    expect(view.planType).toBe('plus');
    expect(view.credits?.balance).toBe('12.50');
  });

  it('keeps a limit that a sparse update does not mention', async () => {
    full();
    await service.refresh();

    notify({
      rateLimits: {
        primary: null,
        secondary: null,
        credits: null,
        planType: null,
        rateLimitReachedType: 'rate_limit_reached',
      },
    });
    notify({
      rateLimits: {
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1_700_000 },
        secondary: null,
        credits: null,
        planType: null,
        rateLimitReachedType: null,
      },
    });

    // Still throttled: the second update simply did not carry the field.
    expect(service.getSnapshot().limitReached).toBe('rate_limit_reached');
  });

  it('clears the limit when a full read no longer reports one', async () => {
    notify({
      rateLimits: {
        primary: null,
        secondary: null,
        credits: null,
        planType: null,
        rateLimitReachedType: 'rate_limit_reached',
      },
    });
    expect(service.getSnapshot().limitReached).toBe('rate_limit_reached');

    // An authoritative read is different: silence there means it is over.
    full();
    await service.refresh();

    expect(service.getSnapshot().limitReached).toBeNull();
  });

  it('tells subscribers about every change', async () => {
    full();
    await service.refresh();
    notify({
      rateLimits: {
        primary: { usedPercent: 60, windowDurationMins: 300, resetsAt: 1_700_000 },
        secondary: null,
        credits: null,
        planType: null,
        rateLimitReachedType: null,
      },
    });

    expect(seen).toHaveLength(2);
    expect(seen[1].primary?.usedPercent).toBe(60);
  });

  it('survives a failed read without losing what it already knew', async () => {
    full();
    await service.refresh();

    request.mockRejectedValue(new Error('app-server is down'));
    const view = await service.refresh();

    expect(view.planType).toBe('plus');
  });
});
