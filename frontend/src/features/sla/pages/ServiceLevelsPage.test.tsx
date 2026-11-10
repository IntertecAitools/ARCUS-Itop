import { beforeAll, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { ServiceLevelsPage, describeTarget } from './ServiceLevelsPage';

// The mock store lives for the whole file, so tests build on each other's writes.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('ServiceLevelsPage', () => {
  it('shows targets, SLAs with their targets, and each contract service with its SLA', async () => {
    renderWithProviders(<ServiceLevelsPage />);
    const targets = await screen.findByRole('table', { name: 'Targets' });
    expect(within(targets).getByText('P1 incident: resolve within 4 hours')).toBeInTheDocument();
    const slas = screen.getByRole('list', { name: 'SLAs' });
    expect(within(slas).getByText('Gold')).toBeInTheDocument();
    expect(within(slas).getByText('No targets: tickets get no deadline')).toBeInTheDocument();
    expect(screen.getByLabelText('SLA for Acme support 2026: Email')).toHaveValue('4');
    expect(screen.getByLabelText('SLA for Acme support 2026: VPN')).toHaveValue('');
  });

  it('attaches an SLA to a contract service, and adds a service with its SLA', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ServiceLevelsPage />);
    await user.selectOptions(await screen.findByLabelText('SLA for Acme support 2026: VPN'), 'Gold');
    expect(await screen.findByText('2 contract services', { exact: false })).toBeInTheDocument();

    const add = screen.getByRole('form', { name: 'Add a service to Acme support 2026' });
    await user.selectOptions(within(add).getByLabelText('Service'), 'Laptops');
    await user.selectOptions(within(add).getByLabelText('SLA'), 'Standard');
    await user.click(within(add).getByRole('button', { name: /Add service/ }));
    expect(await screen.findByLabelText('SLA for Acme support 2026: Laptops')).toHaveValue('5');
    // Every service is on the contract now: nothing left to add.
    expect(screen.queryByRole('form', { name: 'Add a service to Acme support 2026' })).not.toBeInTheDocument();
  });

  it('creates a target and puts it in an SLA', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ServiceLevelsPage />);
    await user.click(await screen.findByRole('button', { name: /New target/ }));
    const form = screen.getByRole('form', { name: 'New target' });
    await user.selectOptions(within(form).getByLabelText('Priority'), 'P2 High');
    await user.clear(within(form).getByLabelText('Within'));
    await user.type(within(form).getByLabelText('Within'), '8');
    await user.click(within(form).getByRole('button', { name: 'Add target' }));
    const targets = await screen.findByRole('table', { name: 'Targets' });
    expect(await within(targets).findByText('P2 High incident: resolve within 8 hours')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Standard' }));
    const sla = screen.getByRole('form', { name: 'Edit SLA Standard' });
    await user.click(within(sla).getByLabelText('P2 High incident: resolve within 8 hours'));
    await user.click(within(sla).getByRole('button', { name: 'Save SLA' }));
    const slas = await screen.findByRole('list', { name: 'SLAs' });
    expect(await within(slas).findByText('P2 High incident: resolve within 8 hours')).toBeInTheDocument();
  });

  it('creates a customer contract only with a customer and provider', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ServiceLevelsPage />);
    await user.click(await screen.findByRole('button', { name: /New contract/ }));
    const form = screen.getByRole('form', { name: 'New contract' });
    await user.type(within(form).getByLabelText('Contract name'), 'Intertec internal');
    const create = within(form).getByRole('button', { name: 'Create contract' });
    expect(create).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText('Customer'), 'Intertec');
    await user.selectOptions(within(form).getByLabelText('Provider'), 'Intertec');
    await user.click(create);
    const contract = await screen.findByRole('region', { name: 'Contract Intertec internal' });
    expect(within(contract).getByText(/No services yet/)).toBeInTheDocument();
  });

  it('warns before deleting an SLA that contract services use', async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<ServiceLevelsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete Gold' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/contract services will have no SLA/));
    confirm.mockRestore();
  });
});

describe('describeTarget', () => {
  it('reads as a sentence', () => {
    expect(describeTarget({ requestType: 'service_request', priority: '4', metric: 'tto', value: 1, unit: 'hours' })).toBe(
      'P4 Low service request: own within 1 hour',
    );
  });
});
