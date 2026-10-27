import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { CabQueuePage } from './CabQueuePage';
import { ChangeRulesPage } from './ChangeRulesPage';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('CabQueuePage', () => {
  it('lists the changes awaiting the CAB, each linked to its record', async () => {
    renderWithProviders(<CabQueuePage />);
    const link = await screen.findByRole('link', { name: 'C-000012' });
    expect(link).toHaveAttribute('href', '/records/NormalChange/12');
    expect(screen.getByRole('link', { name: 'C-000013' })).toBeInTheDocument();
    expect(screen.getAllByText('Not reviewed').length).toBeGreaterThan(0);
  });
});

describe('ChangeRulesPage', () => {
  it('edits which plans a change type needs, and can go back to the defaults', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangeRulesPage />);

    const routineTest = await screen.findByLabelText('Routine: Test plan');
    expect(routineTest).toHaveValue('optional');
    expect(screen.getByText('The platform’s defaults apply.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled();

    await user.selectOptions(routineTest, 'implement');
    await user.click(screen.getByRole('button', { name: 'Save rules' }));

    expect(await screen.findByText(/Rules saved/)).toBeInTheDocument();
    expect(screen.getByText(/Last changed by admin/)).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByLabelText('Routine: Test plan')).toHaveValue('implement');
    await user.click(screen.getByRole('button', { name: 'Use the defaults' }));
    expect(within(table).getByLabelText('Routine: Test plan')).toHaveValue('optional');
  });
});
