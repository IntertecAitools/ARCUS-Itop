import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { serviceLevels } from '@/mocks/handlers/service-levels';
import { ServiceLevelsPage, describeTarget } from './ServiceLevelsPage';

// The mock store lives for the whole file, so tests build on each other's writes.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));
// Sections remember whether they are open; every test starts with all folded.
beforeEach(() => window.localStorage.clear());

type User = ReturnType<typeof userEvent.setup>;
const openSection = async (user: User, title: RegExp) =>
  user.click(await screen.findByRole('button', { name: title, expanded: false }));

describe('ServiceLevelsPage', () => {
  it('starts folded, with a summary of each section', async () => {
    renderWithProviders(<ServiceLevelsPage />);
    expect(await screen.findByRole('button', { name: /1\. Targets 3 targets · 1 not in any SLA/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /2\. SLAs 2 SLAs: Gold, Standard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3\. Customer contracts 1 contract · 2 services · 1 without SLA/ })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Targets' })).not.toBeInTheDocument();
  });

  it('shows targets, SLAs with their targets, and each contract service with its SLA', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ServiceLevelsPage />);
    await openSection(user, /1\. Targets/);
    await openSection(user, /2\. SLAs/);
    await openSection(user, /3\. Customer contracts/);
    const targets = screen.getByRole('table', { name: 'Targets' });
    expect(within(targets).getByText('P1 incident: resolve within 4 hours')).toBeInTheDocument();
    const slas = screen.getByRole('list', { name: 'SLAs' });
    expect(within(slas).getByText('Gold')).toBeInTheDocument();
    expect(within(slas).getByText('No targets: tickets get no deadline')).toBeInTheDocument();
    // The only contract opens by itself.
    expect(screen.getByLabelText('SLA for Acme support 2026: Email')).toHaveValue('4');
    expect(screen.getByLabelText('SLA for Acme support 2026: VPN')).toHaveValue('');
  });

  it('remembers an opened section', async () => {
    const user = userEvent.setup({ delay: null });
    const { unmount } = renderWithProviders(<ServiceLevelsPage />);
    await openSection(user, /2\. SLAs/);
    unmount();
    renderWithProviders(<ServiceLevelsPage />);
    expect(await screen.findByRole('list', { name: 'SLAs' })).toBeInTheDocument();
  });

  it('attaches an SLA to a contract service, and adds a service with its SLA', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ServiceLevelsPage />);
    await openSection(user, /3\. Customer contracts/);
    await user.selectOptions(screen.getByLabelText('SLA for Acme support 2026: VPN'), 'Gold');
    await openSection(user, /2\. SLAs/);
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
    // "New target" opens the folded section with the form.
    await user.click(await screen.findByRole('button', { name: /New target/ }));
    const form = screen.getByRole('form', { name: 'New target' });
    await user.selectOptions(within(form).getByLabelText('Priority'), 'P2 High');
    await user.clear(within(form).getByLabelText('Within'));
    await user.type(within(form).getByLabelText('Within'), '8');
    await user.click(within(form).getByRole('button', { name: 'Add target' }));
    const targets = await screen.findByRole('table', { name: 'Targets' });
    expect(await within(targets).findByText('P2 High incident: resolve within 8 hours')).toBeInTheDocument();

    await openSection(user, /2\. SLAs/);
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
    // With two contracts, each starts folded and opens on a click.
    const header = within(contract).getByRole('button', { expanded: false });
    expect(header).toHaveTextContent('0 services');
    await user.click(header);
    expect(within(contract).getByText(/No services yet/)).toBeInTheDocument();
  });

  it('finds a contract by customer or service, and expands all', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ServiceLevelsPage />);
    await openSection(user, /3\. Customer contracts/);
    expect(serviceLevels.contracts.length).toBeGreaterThan(1);
    const find = screen.getByLabelText('Find a contract');
    await user.type(find, 'laptops');
    // Only Acme has Laptops; alone in the list, it opens by itself.
    expect(screen.getByRole('region', { name: 'Contract Acme support 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Contract Intertec internal' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('SLA for Acme support 2026: Laptops')).toBeInTheDocument();
    await user.clear(find);
    await user.type(find, 'nothing like this');
    expect(screen.getByText(/No contract matches/)).toBeInTheDocument();
    await user.clear(find);
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByLabelText('SLA for Acme support 2026: Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
  });

  it('warns before deleting an SLA that contract services use', async () => {
    const user = userEvent.setup({ delay: null });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithProviders(<ServiceLevelsPage />);
    await openSection(user, /2\. SLAs/);
    await user.click(screen.getByRole('button', { name: 'Delete Gold' }));
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
