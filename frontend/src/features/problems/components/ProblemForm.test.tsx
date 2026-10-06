import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ProblemForm } from './ProblemForm';

describe('ProblemForm', () => {
  it('shows required-field errors and does not submit an empty form', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(<ProblemForm onSubmit={onSubmit} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Create problem' }));

    expect(await screen.findAllByText('This field is required.')).toHaveLength(5);
    expect(screen.getByLabelText(/Title/)).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('previews the computed priority from impact × urgency', async () => {
    const { user } = renderWithProviders(<ProblemForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await user.selectOptions(screen.getByLabelText(/^Impact/), '1');
    await user.selectOptions(screen.getByLabelText(/^Urgency/), '3');
    const preview = screen.getByText('Computed by iTop from impact and urgency').parentElement!;
    expect(within(preview).getByText('High')).toBeInTheDocument();
  });

  it('submits ids, never status or priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <ProblemForm
        onSubmit={onSubmit}
        onCancel={() => {}}
        defaultValues={{ org: { id: '2', label: 'Northwind Retail' }, description: '<p>Checkout fails</p>' }}
      />,
    );
    await user.type(screen.getByLabelText(/Title/), 'Checkout 502');
    await user.selectOptions(screen.getByLabelText(/^Impact/), '2');
    await user.selectOptions(screen.getByLabelText(/^Urgency/), '2');

    // pick a CI through the typeahead
    await user.click(screen.getByRole('combobox', { name: 'Configuration items' }));
    await user.click(await screen.findByRole('option', { name: /vpn-gw-01/ }));

    await user.click(screen.getByRole('button', { name: 'Create problem' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]![0];
    expect(input).toMatchObject({
      org_id: '2',
      title: 'Checkout 502',
      impact: '2',
      urgency: '2',
      functionalcis_list: [{ functionalci_id: '12' }],
    });
    expect(input).not.toHaveProperty('status');
    expect(input).not.toHaveProperty('priority');
  });
});
